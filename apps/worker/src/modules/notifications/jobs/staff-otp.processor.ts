import { staffOtpJob } from '@pospay/contracts';
import type { Job } from 'bullmq';
import type { SendStaffOtp } from '../use-cases/send-staff-otp/send-staff-otp.ts';

export function staffOtpProcessor(send: SendStaffOtp) {
  return async (job: Pick<Job, 'name' | 'data'>): Promise<void> => {
    const input = staffOtpJob.safeParse(job.data);
    if (job.name !== 'staff-otp' || !input.success) throw new Error('OTP_JOB_INVALID');
    try {
      await send.execute(input.data.challenge_id, input.data.attempt_id);
    } catch {
      throw new Error('OTP_EXECUTION_FAILED');
    }
  };
}
