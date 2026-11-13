import { SessionError } from './session-error.ts';
import type { ClosedSessionService, SessionDraft, SessionService } from './session-types.ts';

/** مسودات الزيارة كما فرزها sessionDrafts: البنود المدفوعة وحدها، فسطر الباقة مسموح على خدمة مقفولة. */
export interface ClosedServiceDrafts {
  paid: readonly SessionDraft[];
}

/**
 * يفحص بنود الزيارة على الخدمات المغلقة ويصدّر خدمات الكتالوج للتجهيز.
 * القاعدة: الخدمة المغلقة تُقبل في سطر الباقة وحده، لأن العميلة دفعت رصيدها قبل القفل؛
 * وأي سطر مدفوع على خدمة مغلقة يُرفض بـ SERVICE_CLOSED قبل أي قفل أو كتابة.
 * وأول سطر مدفوع على خدمة مغلقة هو المرفوض، بترتيب بنود الطلب.
 *
 * @param services خدمات الكتالوج المقروءة مع علامة إغلاق كل واحدة
 * @param drafts البنود المدفوعة من مسودات الزيارة كما فرزها sessionDrafts
 * @returns خدمات الكتالوج بلا علامة الإغلاق، وقد رُفضت الزيارة لو سطر مدفوع على خدمة مغلقة
 */
export function resolveClosedServiceRedemption(
  services: readonly ClosedSessionService[],
  drafts: ClosedServiceDrafts,
): SessionService[] {
  const closed = new Set(services.filter((service) => service.closed).map((service) => service.id));
  const offender = drafts.paid.find((draft) => closed.has(draft.service_id));
  if (offender !== undefined) throw new SessionError('SERVICE_CLOSED', { service_id: offender.service_id });
  return services.map(({ id, name_en, name_ar, price, rule, counts, revision }) =>
    ({ id, name_en, name_ar, price, rule, counts, revision }));
}
