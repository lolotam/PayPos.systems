import { useEffect, useRef, useState } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import type { LeaveRequest, RequestLeaveInput } from '@pospay/contracts';
import { leaveIdentity, type LeaveContext } from '../model/context';
import { leaveReadRefused } from '../model/read-error';
import { leaveCalls } from './leave-calls';
import { useForgetRefusedRead, forgetRefusedLeaveData } from './use-forget-refused-read';
import { refreshCancelledLeave } from './refresh-cancelled-leave';

type LeaveReads = { started: number; completed: number; notify: (read: number) => void };

export function useMyLeave(
  context: LeaveContext,
  branch: string,
  sessionRefused?: ((error: unknown) => void) | undefined,
) {
  const cache = useQueryClient();
  const [refusal, setRefusal] = useState<unknown>(null);
  const identity = leaveIdentity(context);
  const queryKey = ['my-leave', identity, branch];
  const controller = useLeaveLifetime(identity, branch);
  const reads = useLeaveReadProgress();
  const query = useInfiniteQuery({
    queryKey,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      trackedLeavePage(
        { mode: context.mode, branch, cursor: pageParam, signal },
        setRefusal,
        reads,
      ),
    getNextPageParam: (page) => page.next_cursor ?? undefined,
    enabled: branch !== '' && !refusal,
    gcTime: 0,
    retry: false,
    staleTime: 0,
    refetchInterval: 15_000,
  });
  useForgetRefusedRead(query.error, identity, branch, sessionRefused);
  const { write, busy, error, success, lastRequest, clearError } = useLeaveWrite(
    controller,
    (confirmed) => refreshCancelledLeave(cache, queryKey, confirmed),
    reads,
    (failure) => {
      if (leaveReadRefused(failure)) setRefusal(failure);
      forgetRefusedLeaveData(cache, failure, { identity, branch, sessionRefused });
    },
  );
  return {
    query,
    refusal,
    busy,
    error,
    success,
    lastRequest,
    retry: () => retryLeaveRead(query.refetch, setRefusal, clearError),
    create: (input: RequestLeaveInput) =>
      write(
        JSON.stringify(input),
        (key, signal) => leaveCalls.create(context.mode, branch, input, key, signal),
        'saved',
      ),
    cancel: (id: string, revision: number) =>
      write(
        `${id}:${revision}`,
        (key, signal) => leaveCalls.cancel(context.mode, branch, id, revision, key, signal),
        'cancelled',
      ),
  };
}

export function useLeaveBranches(
  context: LeaveContext,
  active = true,
  sessionRefused?: ((error: unknown) => void) | undefined,
) {
  const [refusal, setRefusal] = useState<unknown>(null);
  const query = useQuery({
    queryKey: ['my-leave', leaveIdentity(context), 'branches'],
    queryFn: ({ signal }) => readLeaveBranches(signal, setRefusal),
    enabled: context.mode === 'personal' && active && !refusal,
    retry: false,
    gcTime: 0,
    staleTime: 0,
  });
  useForgetRefusedRead(refusal ?? query.error, leaveIdentity(context), 'branches', sessionRefused);
  return {
    ...query,
    refusal,
    clearRefusalAfterRecovery: () => setRefusal(null),
    retry: async () => {
      if ((await query.refetch()).isSuccess) setRefusal(null);
    },
  };
}

function useLeaveWrite(
  controller: React.RefObject<AbortController>,
  refresh: (confirmed: LeaveRequest) => Promise<void>,
  reads: React.RefObject<LeaveReads>,
  refused: (error: unknown) => void,
) {
  const locked = useRef(false);
  const attempts = useRef(new Map<string, string>());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [success, setSuccess] = useState<'saved' | 'cancelled' | null>(null);
  const [lastRequest, setLastRequest] = useState<LeaveRequest | null>(null);
  // تغيير الكاش المحلي مش قراءة جديدة؛ الكارت ينتظر قراءة بدأت بعد تأكيد الإنشاء ونجحت.
  const creationRead = useRef(0);
  const completedRead = reads.current.completed;
  useEffect(() => {
    if (completedRead > creationRead.current) setLastRequest(null);
  }, [completedRead]);
  const write = async (
    fingerprint: string,
    operation: (key: string, signal: AbortSignal) => Promise<LeaveRequest>,
    message: 'saved' | 'cancelled',
  ) => {
    const signal = controller.current.signal;
    if (locked.current || signal.aborted || !navigator.onLine) return;
    locked.current = true;
    const key = attempts.current.get(fingerprint) ?? crypto.randomUUID();
    attempts.current.set(fingerprint, key);
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const result = await operation(key, signal);
      if (signal.aborted) return;
      attempts.current.delete(fingerprint);
      setSuccess(message);
      if (message === 'saved') {
        creationRead.current = reads.current.started;
        setLastRequest(result);
      } else await refresh(result);
    } catch (failure) {
      if (!signal.aborted) {
        setError(failure);
        refused(failure);
      }
    } finally {
      locked.current = false;
      if (!signal.aborted) setBusy(false);
    }
  };
  return { write, busy, error, success, lastRequest, clearError: () => setError(null) };
}

function useLeaveLifetime(identity: string, branch: string) {
  const cache = useQueryClient();
  const controller = useRef(new AbortController());
  useEffect(() => {
    const active = new AbortController();
    controller.current = active;
    return () => {
      active.abort();
      void cache.cancelQueries({ queryKey: ['my-leave', identity, branch], exact: true });
      cache.removeQueries({ queryKey: ['my-leave', identity, branch], exact: true });
    };
  }, [cache, identity, branch]);
  return controller;
}

async function readLeavePage(
  request: {
    mode: LeaveContext['mode'];
    branch: string;
    cursor: string | undefined;
    signal: AbortSignal;
  },
  refuse: (error: unknown) => void,
) {
  try {
    return await leaveCalls.list(request.mode, request.branch, request.cursor, request.signal);
  } catch (failure) {
    if (leaveReadRefused(failure) && !request.signal.aborted) refuse(failure);
    throw failure;
  }
}

async function readLeaveBranches(signal: AbortSignal, refuse: (error: unknown) => void) {
  try {
    return await leaveCalls.branches(signal);
  } catch (failure) {
    if (leaveReadRefused(failure) && !signal.aborted) refuse(failure);
    throw failure;
  }
}

async function trackedLeavePage(
  request: Parameters<typeof readLeavePage>[0],
  refuse: (error: unknown) => void,
  reads: React.RefObject<LeaveReads>,
) {
  const read = ++reads.current.started;
  const page = await readLeavePage(request, refuse);
  if (!request.signal.aborted) {
    reads.current.completed = read;
    reads.current.notify(read);
  }
  return page;
}

async function retryLeaveRead(
  read: () => Promise<{ isSuccess: boolean }>,
  setRefusal: (error: unknown) => void,
  clearError: () => void,
) {
  if (!(await read()).isSuccess) return;
  setRefusal(null);
  clearError();
}

function useLeaveReadProgress() {
  const [, notify] = useState(0);
  return useRef<LeaveReads>({ started: 0, completed: 0, notify });
}
