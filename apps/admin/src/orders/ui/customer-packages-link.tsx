'use client';
import { t } from '@pospay/i18n';
import { useLocale } from '@/shared/locale/locale-context';

/**
 * رابط باقات العميلة: العنوان عام بمعرف العميلة بس، من غير اسم ولا تليفون (FR-A08).
 * من قائمة اليوم بيتفتح في نفس التبويب، ومن الكروت جوه النماذج بيتفتح في تبويب جديد
 * عشان النموذج الغير محفوظ ما يضيعش. الوالد هو اللي يقرر إظهار الرابط لما يكون عنده نطاق النشاط والفرع.
 */
export function CustomerPackagesLink({
  customerId,
  newTab = false,
}: {
  customerId: string;
  newTab?: boolean;
}) {
  const locale = useLocale();
  return (
    <a
      href={`/orders/customers/${customerId}/packages`}
      {...(newTab ? { target: '_blank', rel: 'noopener' } : {})}
      className="text-start underline decoration-dotted"
    >
      {t(locale, 'customerPackages.open')}
    </a>
  );
}
