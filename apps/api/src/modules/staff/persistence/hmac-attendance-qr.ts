import { createHmac, timingSafeEqual } from 'node:crypto';

import type { AttendanceQrSigner } from '../ports/attendance-qr.port.ts';

function digest(companyId: string, branchId: string, window: number, secret: string): Buffer {
  const message = JSON.stringify(['pospay.attendance-qr.v1', companyId, branchId, window]);
  return createHmac('sha256', Buffer.from(secret, 'hex')).update(message).digest();
}

export const hmacAttendanceQr: AttendanceQrSigner = {
  sign: (companyId, branchId, window, secret) =>
    digest(companyId, branchId, window, secret).toString('hex'),
  verify(companyId, branchId, window, secret, signature) {
    if (typeof signature !== 'string' || !/^[a-f0-9]{64}$/.test(signature)) return false;
    return timingSafeEqual(
      digest(companyId, branchId, window, secret),
      Buffer.from(signature, 'hex'),
    );
  },
};
