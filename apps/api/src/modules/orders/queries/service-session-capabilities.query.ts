import { serviceSessionCapabilities, type ServiceSessionCapabilities } from '@pospay/contracts';
import type { TenantWrappers, Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
import {
  SessionDayReadError,
  type SessionDayAccess,
  type SessionDayScope,
} from './branch-day-service-sessions.query.ts';

export interface SessionCancelFacts {
  denied: boolean;
  feature: boolean;
  eligible: readonly unknown[];
}
export interface SessionCapabilityAccess extends SessionDayAccess {
  /** قرار الإلغاء نفسه من غير قفل الشركة حتى لا تنتظر قائمة اليوم صف companies. */
  cancel(tx: Tx, scope: SessionDayScope, at: Date): Promise<SessionCancelFacts>;
}

// شاشة يوم الفرع تقرأ ظهور زر إلغاء السطر من غير أقفال الكتابة.
export function serviceSessionCapabilityClockStatement() {
  return sql`SELECT clock_timestamp() AS at`;
}

export class ServiceSessionCapabilitiesQuery {
  constructor(
    private readonly db: TenantWrappers,
    private readonly access: SessionCapabilityAccess,
  ) {}
  async execute(scope: SessionDayScope): Promise<ServiceSessionCapabilities> {
    return this.db.withTenant(
      scope.companyId,
      async (tx) => {
        if (!(await this.access.place(tx, scope))) throw new SessionDayReadError('FORBIDDEN');
        const read = await this.access.read(tx, scope);
        if (read !== 'ALLOWED') {
          throw new SessionDayReadError(read === 'DENIED' ? 'FORBIDDEN' : 'FEATURE_DISABLED');
        }
        const [clock] = await tx.execute<{ at: Date | string }>(
          serviceSessionCapabilityClockStatement(),
        );
        if (!clock) throw new SessionDayReadError('NOT_READY');
        const facts = await this.access.cancel(tx, scope, new Date(clock.at));
        // فرع بلا عضوية مؤهلة قراره false؛ feature هنا بتبقى false كمان وممنوع تتحوّل لـ FEATURE_DISABLED.
        if (facts.denied || facts.eligible.length === 0) {
          return serviceSessionCapabilities.parse({ can_cancel_lines: false });
        }
        if (!facts.feature) throw new SessionDayReadError('FEATURE_DISABLED');
        return serviceSessionCapabilities.parse({ can_cancel_lines: true });
      },
      { userId: scope.userId },
    );
  }
}
