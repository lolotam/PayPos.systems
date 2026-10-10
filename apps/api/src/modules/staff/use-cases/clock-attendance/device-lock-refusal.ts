import { DeviceLockRefusal } from '../../domain/passkey-device-lock.ts';
import { AttendanceError } from '../../domain/clock-attendance.ts';
import { PasskeyBindingError } from '../../domain/passkey-binding.ts';
import type {
  AttendanceDeviceRefusals,
  AttendanceDeviceRefusalInput,
} from '../../ports/attendance-device-refusals.port.ts';

/** يحفظ الرفض بعد rollback ثم يعيد نفس السبب للموظف دون تفاصيل صاحب الهاتف. */
export async function rethrowDeviceLockRefusal(
  error: unknown,
  refusals: AttendanceDeviceRefusals,
  input: Omit<AttendanceDeviceRefusalInput, 'reason' | 'holderEmployeeId' | 'at'>,
): Promise<never> {
  if (!(error instanceof DeviceLockRefusal)) throw error;
  await refusals.record({ ...input, ...error.decision, at: error.at });
  switch (error.decision.reason) {
    case 'DEVICE_LOCKED':
      throw new AttendanceError('ATTENDANCE_DEVICE_LOCKED');
    case 'NOT_ENROLLED':
      throw new AttendanceError('ATTENDANCE_DEVICE_NOT_ENROLLED');
    case 'DEVICE_TAKEN':
      throw new PasskeyBindingError('PASSKEY_DEVICE_TAKEN');
    case 'OTHER_DEVICE':
      throw new PasskeyBindingError('PASSKEY_OTHER_DEVICE');
  }
}
