import type { Readable } from 'node:stream';
import { ApiError } from '../../../shared/errors.ts';

export const RESEND_BODY_LIMIT = 65_536;

/** بيجمع الجسم الخام بحده 64KiB قبل أي تحليل — التوقيع على البايتات الأصلية. */
export async function readResendBody(payload: Readable, remainingMs: number): Promise<Buffer> {
  const parts: Buffer[] = [];
  let size = 0;
  // An unfinished upload closes at the deadline: no unbounded drain after sending a response.
  // Destroy wakes the pending iterator; finally releases every chunk already collected.
  const timer = setTimeout(
    () => payload.destroy(new ApiError('NOT_READY')),
    Math.max(0, remainingMs),
  );
  try {
    for await (const chunk of payload) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
      size += bytes.length;
      if (size > RESEND_BODY_LIMIT) throw new ApiError('PAYLOAD_TOO_LARGE');
      parts.push(bytes);
    }
    return Buffer.concat(parts, size);
  } finally {
    clearTimeout(timer);
    parts.length = 0;
  }
}
