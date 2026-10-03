import type { AttendanceQrIssue } from '@pospay/contracts';

import type { Clock } from '../../../../shared/ports/clock.port.ts';
import {
  AttendanceQrBranchMissingError,
  attendanceQrSecretScope,
  attendanceQrTiming,
} from '../../domain/attendance-qr.ts';
import type {
  AttendanceBranchReader,
  AttendanceQrSecrets,
  AttendanceQrSigner,
} from '../../ports/attendance-qr.port.ts';

/** بيصدر إثبات الفرع للجهاز الموثق؛ مابيعملش جلسة حضور أو يغيّر حالة موظف. */
export class IssueAttendanceQr {
  constructor(
    private readonly branches: AttendanceBranchReader,
    private readonly secrets: AttendanceQrSecrets,
    private readonly signer: AttendanceQrSigner,
    private readonly clock: Clock,
  ) {}

  async execute(input: { companyId: string; branchId: string }): Promise<AttendanceQrIssue> {
    const branch = await this.branches.read(input.companyId, input.branchId);
    if (branch === null) throw new AttendanceQrBranchMissingError();
    const timing = attendanceQrTiming(this.clock.now().getTime());
    const scope = attendanceQrSecretScope(
      input.companyId,
      input.branchId,
      timing.window,
      branch.effective_timezone,
    );
    const secret = await this.secrets.getOrCreate(scope);
    return {
      branch,
      token: {
        branch_id: input.branchId,
        window: timing.window,
        sig: this.signer.sign(input.companyId, input.branchId, timing.window, secret),
      },
      server_time: timing.server_time,
      refresh_at: timing.refresh_at,
      expires_at: timing.expires_at,
    };
  }
}

export {
  AttendanceQrBranchMissingError,
  AttendanceQrUnavailableError,
} from '../../domain/attendance-qr.ts';
