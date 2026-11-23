'use client';

import { t } from '@pospay/i18n';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useMemo } from 'react';

import { useLocale } from '@/shared/locale/locale-context';
import { GroupOverviewPage } from '@/workspace/pages/group-overview-page';

import { useMenuContext } from './menu/use-menu-context';
import { resolveOverviewTarget } from './menu/overview-target';
import { useVisibilitySettled } from './menu/use-visibility-settled';
import { useNavStyle } from './nav-style/nav-style-context';

/**
 * نظرة المجموعة العامة لعنوان /overview/<مجموعة>. القرار (عرض أو استبدال العنوان) لا يُتخذ إلا بعد أن تستقر
 * مساحة العمل وكل قراءة خلف شرط ظهور؛ قبل ذلك يظهر «جارٍ التحميل»، وإلا استُبدل العنوان بأول صفحة مرئية
 * في تلك اللحظة (غير مبنية مثلًا) ثم ظهرت الصفحة الحقيقية بعد وصول القراءة. الاستبدال نفسه يجري في تأثير.
 */
export function OverviewRoute() {
  const locale = useLocale();
  const { group = '' } = useParams<{ group?: string }>();
  const { style } = useNavStyle();
  const ctx = useMenuContext();
  const router = useRouter();
  const settled = useVisibilitySettled();
  const target = useMemo(
    () => (settled ? resolveOverviewTarget(style, group, ctx) : undefined),
    [settled, style, group, ctx],
  );
  const replaceHref = target?.kind === 'replace' ? target.href : undefined;
  useEffect(() => {
    if (replaceHref !== undefined) router.replace(replaceHref);
  }, [replaceHref, router]);
  if (target?.kind === 'overview') return <GroupOverviewPage overview={target.overview} />;
  return <p role="status">{t(locale, 'admin.loading')}</p>;
}
