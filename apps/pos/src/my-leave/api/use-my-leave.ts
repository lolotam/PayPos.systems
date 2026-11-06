import { useEffect, useRef, useState } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import type { LeaveRequest, RequestLeaveInput } from '@pospay/contracts';
import { leaveIdentity, type LeaveContext } from '../model/context';
import { leaveCalls } from './leave-calls';
import { useForgetRefusedRead } from './use-forget-refused-read';

export function useMyLeave(context: LeaveContext, branch: string) {
  const cache = useQueryClient();
  const identity = leaveIdentity(context);
  const queryKey = ['my-leave', identity, branch];
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
  const query = useInfiniteQuery({
    queryKey,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => leaveCalls.list(context.mode, branch, pageParam, signal),
    getNextPageParam: (page) => page.next_cursor ?? undefined,
    enabled: branch !== '',
    gcTime: 0,
    retry: false,
    staleTime: 0,
    refetchInterval: 15_000,
  });
  useForgetRefusedRead(query.error, identity, branch);
  const { write, busy, error, success, lastRequest } = useLeaveWrite(
    controller,
    () => cache.invalidateQueries({ queryKey }),
    query.dataUpdatedAt,
  );
  return {
    query,
    busy,
    error,
    success,
    lastRequest,
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

export function useLeaveBranches(context: LeaveContext) {
  const query = useQuery({
    queryKey: ['my-leave', leaveIdentity(context), 'branches'],
    queryFn: ({ signal }) => leaveCalls.branches(signal),
    enabled: context.mode === 'personal',
    retry: false,
    gcTime: 0,
    staleTime: 0,
  });
  useForgetRefusedRead(query.error, leaveIdentity(context), 'branches');
  return query;
}

function useLeaveWrite(
  controller: React.RefObject<AbortController>,
  refresh: () => Promise<void>,
  updatedAt: number,
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
      if (!signal.aborted) setError(failure);
    } finally {
      locked.current = false;
      if (!signal.aborted) setBusy(false);
    }
  };
  return { write, busy, error, success, lastRequest };
}
