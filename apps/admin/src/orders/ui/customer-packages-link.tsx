'use client';
import { t } from '@pospay/i18n';
import { useLocale } from '@/shared/locale/locale-context';

/**
 * رابط باقات العميلة: العنوان عام بمعرف العميلة بس، من غير اسم ولا تليفون (FR-A08).
 * من قائمة اليوم بيتفتح في نفس التبويب، ومن الكروت جوه النماذج بيتفتح في تبويب جديد
 * مع تلميحات نطاق ids-only بيتحقق منها الطرف التاني ضد خيارات الـ workspace بتاعة الجلسة
 * — الرابط لا يمنح أي صلاحية والخادم بيجدد الترخيص على كل طلب.
 */
export function CustomerPackagesLink({
  customerId,
  newTab = false,
  hints,
}: {
  customerId: string;
  newTab?: boolean;
  hints?: { companyId: string; businessId: string; branchId: string } | undefined;
}) {
  const locale = useLocale();
  const search = new URLSearchParams();
  if (hints !== undefined) {
    search.set('scope_company', hints.companyId);
    search.set('scope_business', hints.businessId);
    search.set('scope_branch', hints.branchId);
  }
  const query = search.toString();
  return (
    <a
      href={`/orders/customers/${customerId}/packages${query === '' ? '' : `?${query}`}`}
      {...(newTab ? { target: '_blank', rel: 'noopener' } : {})}
      className="text-start underline decoration-dotted"
    >
      {t(locale, 'customerPackages.open')}
    </a>
  );
}
