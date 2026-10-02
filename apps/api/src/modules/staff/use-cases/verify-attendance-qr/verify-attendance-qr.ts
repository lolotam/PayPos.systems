import type { AttendanceQrToken } from '@pospay/contracts';

import type { Clock } from '../../../../shared/ports/clock.port.ts';
import { acceptsAttendanceQrWindow, attendanceQrSecretScope } from '../../domain/attendance-qr.ts';
import type {
  AttendanceBranchReader,
  AttendanceQrSecrets,
  AttendanceQrSigner,
} from '../../ports/attendance-qr.port.ts';

/** بيفحص إثبات QR فقط؛ PR 22 لازم يتحقق من هوية الموظف وباقي شروط الحضور بشكل مستقل. */
export class VerifyAttendanceQr {
  constructor(
    private readonly branches: AttendanceBranchReader,
    private readonly secrets: AttendanceQrSecrets,
    private readonly signer: AttendanceQrSigner,
    private readonly clock: Clock,
  ) {}

  async execute(input: {
    companyId: string;
    branchId: string;
    token: AttendanceQrToken;
  }): Promise<boolean> {
    if (!acceptsAttendanceQrWindow(input.branchId, input.token, this.clock.now().getTime()))
      return false;
    const branch = await this.branches.read(input.companyId, input.branchId);
    if (branch === null) return false;
    const scope = attendanceQrSecretScope(
      input.companyId,
      input.branchId,
      input.token.window,
      branch.effective_timezone,
    );
    const secret = await this.secrets.read(scope);
    // انتظار القراءات ممكن يخلّي الرمز خارج النافذة؛ وقت بداية الطلب مش كفاية لقبوله.
    return (
      secret !== null &&
      this.signer.verify(
        input.companyId,
        input.branchId,
        input.token.window,
        secret,
        input.token.sig,
      ) &&
      acceptsAttendanceQrWindow(input.branchId, input.token, this.clock.now().getTime())
    );
  }
}
