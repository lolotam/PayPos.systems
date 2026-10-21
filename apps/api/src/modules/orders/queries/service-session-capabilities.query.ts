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
  /** قرار تغيير المنفّذين بنفس شكل الإلغاء ومن غير أقفال، عشان الزرار يختفي عند اللي معندوش الصلاحية (PP-19.2). */
  performers(tx: Tx, scope: SessionDayScope, at: Date): Promise<SessionCancelFacts>;
}

// فرع بلا عضوية مؤهلة قراره false؛ feature هنا بتبقى false كمان وممنوع تتحوّل لـ FEATURE_DISABLED.
function capabilityFlag(facts: SessionCancelFacts): boolean {
  if (facts.denied || facts.eligible.length === 0) return false;
  if (!facts.feature) throw new SessionDayReadError('FEATURE_DISABLED');
  return true;
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
        const at = new Date(clock.at);
        const cancel = capabilityFlag(await this.access.cancel(tx, scope, at));
        const performers = capabilityFlag(await this.access.performers(tx, scope, at));
        return serviceSessionCapabilities.parse({
          can_cancel_lines: cancel,
          can_change_performers: performers,
        });
      },
      { userId: scope.userId },
    );
  }
}
