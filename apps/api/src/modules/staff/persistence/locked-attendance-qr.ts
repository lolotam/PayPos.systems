import { acceptsAttendanceQrWindow, attendanceQrSecretScope } from '../domain/attendance-qr.ts';
import type { AttendanceQrSecrets, AttendanceQrSigner } from '../ports/attendance-qr.port.ts';
import type { AttendanceScanVerifier } from '../ports/clock-attendance.port.ts';

// الفرع وتوقيته موثقان تحت قفل المعاملة؛ اتصال tenant ثانٍ قد يستنفد الـ pool عند الزحام.
export function createLockedAttendanceQrVerifier(
  secrets: AttendanceQrSecrets,
  signer: AttendanceQrSigner,
): AttendanceScanVerifier {
  return {
    verify: async (companyId, branchId, token, at, timezone) => {
      if (!acceptsAttendanceQrWindow(branchId, token, at.getTime())) return false;
      const secret = await secrets.read(
        attendanceQrSecretScope(companyId, branchId, token.window, timezone),
      );
      return secret !== null && signer.verify(companyId, branchId, token.window, secret, token.sig);
    },
  };
}
