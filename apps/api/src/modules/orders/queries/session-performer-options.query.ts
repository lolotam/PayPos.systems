import { sessionPerformerOptionPage, sessionPerformerOptionsQuery, type SessionPerformerOptionPage,
  type SessionPerformerOptionsQuery } from '@pospay/contracts';
import type { TenantWrappers, Tx } from '@pospay/db';
import { RecordingContextReadError, type RecordingContextReads, type RecordingScope } from './recording-context.query.ts';

export interface SessionPerformerOptionsReads extends Pick<RecordingContextReads, 'place' | 'access'> {
  /** يطبق نافذة POST ويطبع فرق ساعة الجهاز قبل قراءة حقائق الحضور والإجازة. */
  time(occurredAt: string, at: Date, timezone: string): string;
  /** يعيد الموظفات المؤهلات في تاريخ الجلسة وتنبيهين فقط كي لا يكشف نموذج التسجيل ملفات الموارد البشرية. */
  options(tx: Tx, scope: RecordingScope, query: SessionPerformerOptionsQuery,
    normalizeTime: (instant: string) => string): Promise<SessionPerformerOptionPage>;
}

// نموذج التسجيل يستهلك حقائق الموظفات من staff بعد إثبات إذن الفرع في معاملة الشركة نفسها.
export class SessionPerformerOptionsQueryHandler {
  constructor(private readonly db: TenantWrappers, private readonly reads: SessionPerformerOptionsReads,
    private readonly clock: { now(): Date }) {}
  async execute(scope: RecordingScope, input: SessionPerformerOptionsQuery): Promise<SessionPerformerOptionPage> {
    const query = sessionPerformerOptionsQuery.parse(input);
    return this.db.withTenant(scope.companyId, async (tx) => {
      const place = await this.reads.place(tx, scope);
      if (place === null) throw new RecordingContextReadError('FORBIDDEN');
      const at = this.clock.now();
      const access = await this.reads.access(tx, scope, at);
      if (!access.record || access.denied || access.membership_ids.length === 0) throw new RecordingContextReadError('FORBIDDEN');
      if (!access.feature) throw new RecordingContextReadError('FEATURE_DISABLED');
      return sessionPerformerOptionPage.parse(await this.reads.options(tx, scope, query,
        (instant) => this.reads.time(instant, at, place.timezone)));
    }, { userId: scope.userId });
  }
}
