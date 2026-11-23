'use client';

import { t } from '@pospay/i18n';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useMemo } from 'react';

import { useLocale } from '@/shared/locale/locale-context';
import { GroupOverviewPage } from '@/workspace/pages/group-overview-page';

import { useMenuContext } from './menu/use-menu-context';
import { resolveOverviewTarget } from './menu/overview-target';
import { useNavStyle } from './nav-style/nav-style-context';

/**
 * نظرة المجموعة العامة لعنوان /overview/<مجموعة>. الاستبدال (مجموعة نمط آخر أو مجموعة بلا صفحة مرئية)
 * يجري بعد الرسم الأول في تأثير، ويظهر «جارٍ التحميل» لحظته فلا تومض صفحة خطأ. مساحة العمل تُحمَّل خارج هذا
 * المسار (بوابة الإطار تعرض التحميل قبله)، فهو لا يرى إلا مساحة جاهزة.
 */
export function OverviewRoute() {
  const locale = useLocale();
  const { group = '' } = useParams<{ group?: string }>();
  const { style } = useNavStyle();
  const ctx = useMenuContext();
  const router = useRouter();
  const target = useMemo(() => resolveOverviewTarget(style, group, ctx), [style, group, ctx]);
  const replaceHref = target.kind === 'replace' ? target.href : undefined;
  useEffect(() => {
    if (replaceHref !== undefined) router.replace(replaceHref);
  }, [replaceHref, router]);
  if (target.kind === 'overview') return <GroupOverviewPage overview={target.overview} />;
  return <p role="status">{t(locale, 'admin.loading')}</p>;
}
