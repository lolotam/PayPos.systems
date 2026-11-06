import { useEffect, useRef, useState } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import type { LeaveRequest, RequestLeaveInput } from '@pospay/contracts';
import { leaveIdentity, type LeaveContext } from '../model/context';
import { leaveReadRefused } from '../model/read-error';
import { leaveCalls } from './leave-calls';
import { useForgetRefusedRead, forgetRefusedLeaveData } from './use-forget-refused-read';

export function useMyLeave(
  context: LeaveContext,
  branch: string,
  sessionRefused?: ((error: unknown) => void) | undefined,
) {
  const cache = useQueryClient();
  const [writeRefused, setWriteRefused] = useState(false);
  const identity = leaveIdentity(context);
  const queryKey = ['my-leave', identity, branch];
  const controller = useLeaveLifetime(identity, branch);
  const query = useInfiniteQuery({
    queryKey,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => leaveCalls.list(context.mode, branch, pageParam, signal),
    getNextPageParam: (page) => page.next_cursor ?? undefined,
    enabled: branch !== '' && !writeRefused,
    gcTime: 0,
    retry: false,
    staleTime: 0,
    refetchInterval: 15_000,
  });
  useForgetRefusedRead(query.error, identity, branch, sessionRefused);
  const { write, busy, error, success, lastRequest, clearError } = useLeaveWrite(
    controller,
    () => cache.invalidateQueries({ queryKey }),
    query.dataUpdatedAt,
    (failure) => {
      if (leaveReadRefused(failure)) setWriteRefused(true);
      forgetRefusedLeaveData(cache, failure, { identity, branch, sessionRefused });
    },
  );
  return {
    query,
    busy,
    error,
    success,
    lastRequest,
    retry: async () => {
      if ((await query.refetch()).isSuccess) {
        setWriteRefused(false);
        clearError();
      }
    },
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
  const query = useQuery({
    queryKey: ['my-leave', leaveIdentity(context), 'branches'],
    queryFn: ({ signal }) => leaveCalls.branches(signal),
    enabled: context.mode === 'personal' && active,
    retry: false,
    gcTime: 0,
    staleTime: 0,
  });
  useForgetRefusedRead(query.error, leaveIdentity(context), 'branches', sessionRefused);
  return query;
}

function useLeaveWrite(
  controller: React.RefObject<AbortController>,
  refresh: () => Promise<void>,
  updatedAt: number,
  refused: (error: unknown) => void,
) {
  const locked = useRef(false);
  const attempts = useRef(new Map<string, string>());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [success, setSuccess] = useState<'saved' | 'cancelled' | null>(null);
  const [lastRequest, setLastRequest] = useState<LeaveRequest | null>(null);
  useEffect(() => {
    setLastRequest(null);
  }, [updatedAt]);
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
      if (message === 'saved') setLastRequest(result);
      else await refresh();
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
