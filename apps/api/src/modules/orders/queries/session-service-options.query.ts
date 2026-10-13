import { sessionServiceOptionPage, sessionServiceOptionsQuery, type SessionServiceOptionPage,
  type SessionServiceOptionsQuery } from '@pospay/contracts';
import type { TenantWrappers, Tx } from '@pospay/db';
import { RecordingContextReadError, type RecordingContextReads, type RecordingScope } from './recording-context.query.ts';

export interface SessionServiceOptionsReads extends Pick<RecordingContextReads, 'place' | 'access'> {
  /** يعيد الصفحة المحدودة من كتالوج النشاط لتعبئة السعر دون كشف قواعد العمولة. */
  options(tx: Tx, scope: RecordingScope, query: SessionServiceOptionsQuery): Promise<SessionServiceOptionPage>;
}

// نموذج التسجيل يستهلك صفحة الكتالوج بعد إثبات إذن الفرع في معاملة الشركة نفسها، ولا يكتب.
export class SessionServiceOptionsQueryHandler {
  constructor(private readonly db: TenantWrappers, private readonly reads: SessionServiceOptionsReads,
    private readonly clock: { now(): Date }) {}
  async execute(scope: RecordingScope, input: SessionServiceOptionsQuery): Promise<SessionServiceOptionPage> {
    const query = sessionServiceOptionsQuery.parse(input);
    return this.db.withTenant(scope.companyId, async (tx) => {
      if (await this.reads.place(tx, scope) === null) throw new RecordingContextReadError('FORBIDDEN');
      const access = await this.reads.access(tx, scope, this.clock.now());
      if (!access.record || access.denied || access.membership_ids.length === 0) throw new RecordingContextReadError('FORBIDDEN');
      if (!access.feature) throw new RecordingContextReadError('FEATURE_DISABLED');
      return sessionServiceOptionPage.parse(await this.reads.options(tx, scope, query));
    }, { userId: scope.userId });
  }
}
