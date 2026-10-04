import { useEffect, useRef } from 'react';
import jsQR from 'jsqr';

export function useAttendanceCamera(scanned: (value: string) => Promise<void>, failed: () => void) {
  const video = useRef<HTMLVideoElement>(null);
  const onScan = useRef(scanned);
  onScan.current = scanned;
  const onFailure = useRef(failed);
  onFailure.current = failed;
  useEffect(() => {
    let cancelled = false,
      frame = 0;
    let stream: MediaStream | null = null;
    const stop = () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      stream?.getTracks().forEach((track) => track.stop());
    };
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d', { willReadFrequently: true });
    const read = () => {
      const element = video.current;
      if (cancelled || element === null || context === null) return;
      if (element.readyState >= 2 && element.videoWidth > 0) {
        canvas.width = element.videoWidth;
        canvas.height = element.videoHeight;
        context.drawImage(element, 0, 0);
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
        const qr = jsQR(pixels.data, pixels.width, pixels.height, {
          inversionAttempts: 'dontInvert',
        });
        if (qr !== null) {
          stop();
          void onScan.current(qr.data);
          return;
        }
      }
      frame = requestAnimationFrame(read);
    };
    void (async () => {
      try {
        if (context === null || navigator.mediaDevices?.getUserMedia === undefined)
          throw new Error('CAMERA_UNAVAILABLE');
        stream = await navigator.mediaDevices.getUserMedia(cameraConstraints);
        if (cancelled || video.current === null) {
          stop();
          return;
        }
        video.current.srcObject = stream;
        await video.current.play();
        if (!cancelled) frame = requestAnimationFrame(read);
      } catch {
        if (cancelled) return;
        stop();
        onFailure.current();
      }
    })();
    return stop;
  }, []);
  return video;
}

const cameraConstraints = {
  audio: false,
  video: { facingMode: { ideal: 'environment' }, width: { ideal: 640 }, height: { ideal: 480 } },
};
