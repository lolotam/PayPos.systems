import type { ClaimedEvent, Database } from '@pospay/db';
import { COMMISSION_INPUT_EVENT_TYPES } from '@pospay/domain';
import type { Logger } from '@pospay/observability';

type TenantTransaction = Parameters<Parameters<Database['withTenant']>[1]>[0];

/** ما يُسلَّم للمالك عن الحدث الموقوف: الشركة وهوية الحدث ونوعه فقط، بلا أي حمولة (ADR-0012 §3). */
export interface ParkedEventAlertRequest {
  readonly companyId: string;
  readonly eventId: string;
  readonly eventType: string;
}

/** مستقبِل طلب التنبيه، ينفّذه 53-2 عبر حدث outbox وقالب إشعار على حدّ notifications. */
export interface ParkedEventAlertSink {
  /**
   * يسجّل طلب تنبيه المالك داخل معاملة الشركة، وهو idempotent على هوية الحدث: التكرار لا ينشئ طلبًا ثانيًا.
   *
   * @param tx معاملة الشركة المفتوحة لهذا التنبيه وحده، لا معاملة اعتماد
   * @param request الشركة وهوية الحدث ونوعه
   * @returns true إن أُنشئ طلب جديد، false إن كان الحدث قد نُبّه عنه من قبل
   */
  request(tx: TenantTransaction, request: ParkedEventAlertRequest): Promise<boolean>;
}

/** نتيجة محاولة التنبيه؛ لا شيء منها يغيّر نتيجة التوصيل أو الإيقاف. */
export type ParkedEventAlertOutcome = 'RAISED' | 'DUPLICATE' | 'IGNORED' | 'FAILED';

/** تبعيات التنبيه: معاملة الشركة والمستقبِل والسجل. */
export interface ParkedEventAlertDeps {
  readonly app: Pick<Database, 'withTenant'>;
  readonly sink: ParkedEventAlertSink;
  readonly logger: Pick<Logger, 'error'>;
}

const COUNTED_TYPES: ReadonlySet<string> = new Set(COMMISSION_INPUT_EVENT_TYPES);

/**
 * يرفع تنبيه المالك حين يُوقَف حدث عمولة محسوب (parked)، لأن الحدث الموقوف يمنع الاعتماد ولا يُحسب منجزًا أبدًا (ADR-0012 §3).
 * يُستدعى من موضعي الإيقاف اليوم: فشل التوصيل الأخير في `deliver.ts`، والحجز المنتهي في `dispatch-loop.ts` عبر onExhausted.
 * يعمل في معاملة شركة خاصة به، فلا يتأثر بتراجع معاملة اعتماد، ولا يقرأ حمولة الحدث ولا يمرّرها.
 * أي فشل يُسجَّل ويُبتلع هنا ولا يغيّر نتيجة التوصيل ولا الإيقاف، والحدث الموقوف يبقى معلّقًا في العدّ.
 * تنبيه المسار الأول قد يسبق كتابة `parked_at`: الـ dispatcher يكتبها بعد عودة `deliver`، فإن فشلت تلك الكتابة صار التنبيه مبكرًا؛
 * هل يُنقل إلى خطّاف بعد الإيقاف في `packages/db` نقطة تصميم تُحسم في 53-2.
 *
 * @param deps معاملة الشركة والمستقبِل والسجل
 * @param event الحدث الموقوف كما يصل إلى موضعي الإيقاف
 * @returns RAISED عند إنشاء طلب جديد، DUPLICATE عند تكرار الحدث، IGNORED لنوع غير محسوب، FAILED عند أي فشل
 */
export async function raiseParkedEventAlert(
  deps: ParkedEventAlertDeps,
  event: Pick<ClaimedEvent, 'companyId' | 'id' | 'eventType'>,
): Promise<ParkedEventAlertOutcome> {
  if (!COUNTED_TYPES.has(event.eventType)) return 'IGNORED';
  const request: ParkedEventAlertRequest = {
    companyId: event.companyId,
    eventId: event.id,
    eventType: event.eventType,
  };
  try {
    const created = await deps.app.withTenant(event.companyId, (tx) => deps.sink.request(tx, request));
    return created ? 'RAISED' : 'DUPLICATE';
  } catch (error) {
    deps.logger.error({ event: request, err: error }, 'parked event owner alert failed');
    return 'FAILED';
  }
}
