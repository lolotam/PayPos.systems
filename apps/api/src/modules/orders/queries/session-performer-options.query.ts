import { sessionPerformerOptionPage, sessionPerformerOptionsQuery, type SessionPerformerOptionPage,
  type SessionPerformerOptionsQuery } from '@pospay/contracts';
import type { TenantWrappers, Tx } from '@pospay/db';
import { RecordingContextReadError, type RecordingContextReads, type RecordingScope } from './recording-context.query.ts';

export interface SessionPerformerOptionsReads extends Pick<RecordingContextReads, 'place' | 'access'> {
  /** يعيد الموظفات المؤهلات في تاريخ الجلسة وتنبيهين فقط كي لا يكشف نموذج التسجيل ملفات الموارد البشرية. */
  options(tx: Tx, scope: RecordingScope, query: SessionPerformerOptionsQuery): Promise<SessionPerformerOptionPage>;
}

// نموذج التسجيل يستهلك حقائق الموظفات من staff بعد إثبات إذن الفرع في معاملة الشركة نفسها.
export class SessionPerformerOptionsQueryHandler {
  constructor(private readonly db: TenantWrappers, private readonly reads: SessionPerformerOptionsReads,
    private readonly clock: { now(): Date }) {}
  async execute(scope: RecordingScope, input: SessionPerformerOptionsQuery): Promise<SessionPerformerOptionPage> {
    const query = sessionPerformerOptionsQuery.parse(input);
    return this.db.withTenant(scope.companyId, async (tx) => {
      if (await this.reads.place(tx, scope) === null) throw new RecordingContextReadError('FORBIDDEN');
      const access = await this.reads.access(tx, scope, this.clock.now());
      if (!access.record || access.denied || access.membership_ids.length === 0) throw new RecordingContextReadError('FORBIDDEN');
      if (!access.feature) throw new RecordingContextReadError('FEATURE_DISABLED');
      return sessionPerformerOptionPage.parse(await this.reads.options(tx, scope, query));
    }, { userId: scope.userId });
  }
}
