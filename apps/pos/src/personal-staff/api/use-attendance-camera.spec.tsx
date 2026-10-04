import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import jsQR from 'jsqr';
import { useAttendanceCamera } from './use-attendance-camera';
vi.mock('jsqr', () => ({ default: vi.fn() }));
const stop = vi.fn(),
  play = vi.fn(async () => undefined),
  draw = vi.fn();
const frames: FrameRequestCallback[] = [];
const stream = { getTracks: () => [{ stop }] } as unknown as MediaStream;
beforeEach(() => {
  vi.clearAllMocks();
  frames.length = 0;
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn((callback) => {
      frames.push(callback);
      return frames.length;
    }),
  );
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage: draw,
    getImageData: () => ({ data: new Uint8ClampedArray(16), width: 2, height: 2 }),
  } as unknown as CanvasRenderingContext2D);
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn(async () => stream) } });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it('decodes locally and stops all camera tracks before delivering one QR scan', async () => {
  const scanned = vi.fn(async () => undefined),
    failed = vi.fn();
  vi.mocked(jsQR).mockReturnValue({ data: 'synthetic QR' } as ReturnType<typeof jsQR>);
  const hook = renderHook(() => useAttendanceCamera(scanned, failed));
  hook.result.current.current = {
    play,
    readyState: 2,
    videoWidth: 2,
    videoHeight: 2,
  } as unknown as HTMLVideoElement;
  await waitFor(() => expect(frames).toHaveLength(1));
  frames[0]?.(0);
  expect(stop).toHaveBeenCalledTimes(1);
  expect(scanned).toHaveBeenCalledWith('synthetic QR');
  expect(stop.mock.invocationCallOrder[0]).toBeLessThan(scanned.mock.invocationCallOrder[0] ?? 0);
  expect(draw).toHaveBeenCalledTimes(1);
  expect(failed).not.toHaveBeenCalled();
  hook.unmount();
});
it('unmount stops the camera even if permission resolves after the screen closes', async () => {
  let release: ((value: MediaStream) => void) | undefined;
  vi.stubGlobal('navigator', {
    mediaDevices: {
      getUserMedia: () =>
        new Promise<MediaStream>((resolve) => {
          release = resolve;
        }),
    },
  });
  const scanned = vi.fn(async () => undefined),
    failed = vi.fn();
  const hook = renderHook(() => useAttendanceCamera(scanned, failed));
  hook.unmount();
  release?.(stream);
  await waitFor(() => expect(stop).toHaveBeenCalledTimes(1));
  expect(scanned).not.toHaveBeenCalled();
});
it('missing camera capability fails without starting a passkey ceremony', async () => {
  vi.stubGlobal('navigator', {});
  const scanned = vi.fn(async () => undefined),
    failed = vi.fn();
  const hook = renderHook(() => useAttendanceCamera(scanned, failed));
  await waitFor(() => expect(failed).toHaveBeenCalledTimes(1));
  expect(scanned).not.toHaveBeenCalled();
  hook.unmount();
});
