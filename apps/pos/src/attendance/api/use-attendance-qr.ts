import { queryOptions, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useState } from 'react';

import { qrPayload, qrRefreshDelay, qrServerTime } from '../model/qr-timing';
import { QrRequestError, readAttendanceQr } from './read-attendance-qr';

function useScreenTime() {
  const [time, setTime] = useState(() => ({
    mono: performance.now(),
    wall: Date.now(),
    online: navigator.onLine,
    connectedAt: 0,
  }));
  useEffect(() => {
    const update = () => {
      const mono = performance.now();
      const wall = Date.now();
      const online = navigator.onLine;
      setTime((previous) => ({
        mono,
        wall,
        online,
        connectedAt: !previous.online && online ? mono : previous.connectedAt,
      }));
    };
    const timer = window.setInterval(update, 1000);
    window.addEventListener('offline', update);
    window.addEventListener('online', update);
    document.addEventListener('visibilitychange', update);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('offline', update);
      window.removeEventListener('online', update);
      document.removeEventListener('visibilitychange', update);
    };
  }, []);
  return time;
}

function attendanceQrOptions(branchId: string, instance: string, online: boolean) {
  return queryOptions({
    // كل mount مرتبط بالهوية اللي فتحت الشاشة؛ مفيش QR cache يتنقل لجهاز أو tenant جديد.
    queryKey: ['attendance-qr', branchId, instance],
    queryFn: ({ signal }) => readAttendanceQr(signal),
    enabled: online,
    gcTime: 0,
    staleTime: 0,
    retry: false,
    networkMode: 'always',
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: 'always',
    refetchInterval: (state) =>
      state.state.data === undefined || state.state.status === 'error'
        ? 5000
        : Math.max(1000, qrRefreshDelay(state.state.data, performance.now(), Date.now())),
  });
}

export function useAttendanceQr(branchId: string, onRejected: () => Promise<void>) {
  const instance = useId();
  const client = useQueryClient();
  const time = useScreenTime();
  const query = useQuery(attendanceQrOptions(branchId, instance, time.online));
  const { refetch, error } = query;
  useEffect(() => {
    if (!time.online)
      void client.cancelQueries({ queryKey: ['attendance-qr', branchId, instance], exact: true });
  }, [time.online, client, branchId, instance]);
  useEffect(() => {
    if (error instanceof QrRequestError && error.rejected) void onRejected();
  }, [error, onRejected]);
  useEffect(() => {
    const refresh = () => {
      if (navigator.onLine && document.visibilityState === 'visible') void refetch();
    };
    window.addEventListener('online', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.removeEventListener('online', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [refetch]);
  return {
    branch: query.data?.issue.branch,
    payload:
      !time.online || query.isError || (query.data?.requestedMono ?? -1) < time.connectedAt
        ? null
        : qrPayload(query.data, branchId, time.mono, time.wall),
    now: query.data === undefined ? null : new Date(qrServerTime(query.data, time.mono, time.wall)),
    notice: !time.online
      ? ('offline' as const)
      : query.isError
        ? ('unavailable' as const)
        : ('loading' as const),
    retry: () => {
      if (navigator.onLine) void refetch();
    },
  };
}
