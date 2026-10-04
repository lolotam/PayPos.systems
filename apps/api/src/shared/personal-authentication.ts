import type {
  PersonalSession,
  PersonalSessions,
  PersonalWorkspace,
  StaffOtpApiOptions,
} from '@pospay/auth';
import type { createStaffOtpApi } from '@pospay/auth';

export const PERSONAL_AUTHENTICATION = Symbol('PERSONAL_AUTHENTICATION');
export const PERSONAL_ROUTE = Symbol('PERSONAL_ROUTE');

export interface PersonalAuthentication {
  readonly origin: string | null;
  readonly sessions: PersonalSessions;
  readonly otp: ReturnType<typeof createStaffOtpApi<PersonalWorkspace, PersonalSession>> | null;
  readonly eligibility: StaffOtpApiOptions<PersonalWorkspace, PersonalSession>['eligibility'] & {
    employee(userId: string, workspace: PersonalWorkspace): Promise<string | null>;
  };
}

declare module 'fastify' {
  interface FastifyRequest {
    personalSession?: PersonalSession;
    personalEmployeeId?: string;
  }
}
