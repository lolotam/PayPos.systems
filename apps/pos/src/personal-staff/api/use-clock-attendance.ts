import { useCallback, useEffect, useRef, useState } from 'react';
import { attendanceQrToken, type ClockAttendanceResult } from '@pospay/contracts';
import { attendanceCalls, attendancePosition } from './attendance-calls';

export function useClockAttendance() {
  const [scanning, setScanning] = useState(false);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [result, setResult] = useState<ClockAttendanceResult | null>(null);
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => active.current?.abort(), []);
  const scanned = useCallback(async (value: string) => {
    if (active.current !== null) return;
    setScanning(false);
    // الحضور online-only؛ المسح وقت انقطاع الشبكة يظهر رسالة بدل كاميرا متوقفة بلا نتيجة.
    if (!navigator.onLine) {
      setResult(null);
      setFailure('OFFLINE');
      return;
    }
    setFailure(null);
    setResult(null);
    setPending(true);
    const request = new AbortController();
    active.current = request;
    try {
      const token = attendanceQrToken.parse(JSON.parse(value));
      const location = await attendancePosition();
      if (request.signal.aborted) return;
      const accepted = await attendanceCalls.clock(
        { token, ...(location === undefined ? {} : { location }) },
        request.signal,
      );
      if (!request.signal.aborted) setResult(accepted);
    } catch (cause) {
      if (!request.signal.aborted) {
        setFailure(cause instanceof Error ? cause.message : 'UNKNOWN');
      }
    } finally {
      if (!request.signal.aborted) {
        active.current = null;
        setPending(false);
      }
    }
  }, []);
  return {
    scanning,
    pending,
    error: failure !== null,
    errorCode: failure,
    result,
    scanned,
    start: () => {
      setResult(null);
      setFailure(null);
      setScanning(true);
    },
    stop: () => setScanning(false),
    failed: () => {
      setScanning(false);
      setFailure('CAMERA');
    },
  };
}
