'use client';

import { t } from '@pospay/i18n';
import { notFound, useParams, useRouter } from 'next/navigation';
import { useEffect, useMemo } from 'react';

import { useLocale } from '@/shared/locale/locale-context';
import { UnderDevelopmentPage } from '@/workspace/pages/under-development-page';

import { useMenuContext } from './menu/use-menu-context';
import { resolveSoonTarget } from './menu/soon-target';

/**
 * عنوان /soon/<صفحة>: صفحة قيد التطوير باسم المدخل، أو تحويل إلى عنوان المدخل الذي صار مبنيًا، أو «غير موجود».
 * القرار يُعاد حسابه حين تتغير مساحة العمل، فمدخل مطعم يصير غير موجود إذا تحوّل المستخدم إلى صالون.
 */
export function SoonRoute() {
  const locale = useLocale();
  const { page = '' } = useParams<{ page?: string }>();
  const ctx = useMenuContext();
  const router = useRouter();
  const target = useMemo(() => resolveSoonTarget(page, ctx), [page, ctx]);
  const forwardHref = target.kind === 'forward' ? target.href : undefined;
  useEffect(() => {
    if (forwardHref !== undefined) router.replace(forwardHref);
  }, [forwardHref, router]);
  if (target.kind === 'not-found') notFound();
  if (target.kind === 'under-development') {
    return <UnderDevelopmentPage name={target.name} homeHref={target.homeHref} />;
  }
  return <p role="status">{t(locale, 'admin.loading')}</p>;
}
