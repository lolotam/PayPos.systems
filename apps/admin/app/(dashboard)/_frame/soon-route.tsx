'use client';

import { t } from '@pospay/i18n';
import { notFound, useParams, useRouter } from 'next/navigation';
import { useEffect, useMemo } from 'react';

import { useLocale } from '@/shared/locale/locale-context';
import { UnderDevelopmentPage } from '@/workspace/pages/under-development-page';

import { useMenuContext } from './menu/use-menu-context';
import { resolveSoonTarget } from './menu/soon-target';
import { useVisibilitySettled } from './menu/use-visibility-settled';

/**
 * عنوان /soon/<صفحة>: صفحة قيد التطوير باسم المدخل، أو تحويل إلى عنوان المدخل الذي صار مبنيًا، أو «غير موجود».
 * لا يُقرَّر شيء قبل أن تستقر مساحة العمل وقراءات الظهور (يظهر «جارٍ التحميل»)، فلا يظهر «غير موجود» لمدخل
 * ستكشفه قراءة لم تصل بعد. القرار يُعاد حسابه حين تتغير مساحة العمل، فمدخل مطعم يصير غير موجود إذا تحوّل
 * المستخدم إلى صالون.
 */
export function SoonRoute() {
  const locale = useLocale();
  const { page = '' } = useParams<{ page?: string }>();
  const ctx = useMenuContext();
  const router = useRouter();
  const settled = useVisibilitySettled();
  const target = useMemo(() => (settled ? resolveSoonTarget(page, ctx) : undefined), [settled, page, ctx]);
  const forwardHref = target?.kind === 'forward' ? target.href : undefined;
  useEffect(() => {
    if (forwardHref !== undefined) router.replace(forwardHref);
  }, [forwardHref, router]);
  if (target?.kind === 'not-found') notFound();
  if (target?.kind === 'under-development') {
    return <UnderDevelopmentPage name={target.name} homeHref={target.homeHref} />;
  }
  return <p role="status">{t(locale, 'admin.loading')}</p>;
}
