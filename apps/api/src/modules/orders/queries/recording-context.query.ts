import { recordingContext, recordingContextQuery, type RecordingContext, type RecordingContextQuery,
  type RecordingDiscountLimit } from '@pospay/contracts';
import type { TenantWrappers, Tx } from '@pospay/db';

export interface RecordingScope { companyId: string; userId: string; businessId: string; branchId: string }
export interface RecordingContextReads {
  /** يثبت الفرع النشط ويعيد منطقة النشاط لنموذج التسجيل فقط. */
  place(tx: Tx, scope: RecordingScope): Promise<{ timezone: string } | null>;
  /**
   * يعيد إذن التسجيل وعضويات المتصلة بالفرع دون كشف حدود غيرها، و`change` لما الإذن جاي من تغيير المنفّذين
   * (قايمة المحرر، PP-19.1) بعد منعه هو؛ قراءة الخدمات بتسيبه فاضي فبتفضل للتسجيل بس.
   */
  access(tx: Tx, scope: RecordingScope, at: Date): Promise<RecordingAccessFacts>;
  /** يقرأ حد العضوية المتحقق منها بنفس معاملة الشركة وأقفال settings. */
  limit(tx: Tx, scope: RecordingScope, membershipId: string): Promise<RecordingDiscountLimit | null>;
}
export interface RecordingAccessFacts {
  record: boolean;
  denied: boolean;
  feature: boolean;
  membership_ids: string[];
  change?: boolean;
}
// القايمة بتظهر لصلاحية التسجيل أو تغيير المنفّذين (PP-19.1)؛ منع التسجيل ما يقفلش اللي معاه تغيير مسموح.
export function pickerAllowed(access: RecordingAccessFacts): boolean {
  return (access.record && !access.denied) || access.change === true;
}
export class RecordingContextReadError extends Error {
  constructor(readonly code: 'FORBIDDEN' | 'FEATURE_DISABLED') { super(code); }
}
function authorize(access: Awaited<ReturnType<RecordingContextReads['access']>>, selected?: string) {
  if (!pickerAllowed(access) || access.membership_ids.length === 0 ||
    (selected !== undefined && !access.membership_ids.includes(selected))) throw new RecordingContextReadError('FORBIDDEN');
  if (!access.feature) throw new RecordingContextReadError('FEATURE_DISABLED');
}

// نموذج تسجيل الزيارة يستهلك قراءات المالكين عبر callbacks؛ لا يقرأ جداولهم مباشرة ولا يكتب.
export class RecordingContextQueryHandler {
  constructor(private readonly db: TenantWrappers, private readonly reads: RecordingContextReads,
    private readonly clock: { now(): Date }) {}
  async execute(scope: RecordingScope, input: RecordingContextQuery): Promise<RecordingContext> {
    const query = recordingContextQuery.parse(input);
    return this.db.withTenant(scope.companyId, async (tx) => {
      const initialPlace = await this.reads.place(tx, scope);
      if (initialPlace === null) throw new RecordingContextReadError('FORBIDDEN');
      const initialAt = this.clock.now();
      const access = await this.reads.access(tx, scope, initialAt);
      authorize(access, query.recorder_membership_id);
      const selected = query.recorder_membership_id ?? (access.membership_ids.length === 1 ? access.membership_ids[0] : undefined);
      if (selected === undefined) return recordingContext.parse({ generated_at: initialAt.toISOString(),
        business_timezone: initialPlace.timezone, recorder_membership_ids: access.membership_ids,
        recorder_membership_id: null, discount_limit: null });
      const limit = await this.reads.limit(tx, scope, selected);
      if (limit === null) throw new RecordingContextReadError('FORBIDDEN');
      const at = this.clock.now();
      const fresh = await this.reads.access(tx, scope, at);
      authorize(fresh, selected);
      const place = await this.reads.place(tx, scope);
      if (place === null) throw new RecordingContextReadError('FORBIDDEN');
      return recordingContext.parse({ generated_at: at.toISOString(), business_timezone: place.timezone,
        recorder_membership_ids: fresh.membership_ids, recorder_membership_id: selected ?? null, discount_limit: limit });
    }, { userId: scope.userId });
  }
}
