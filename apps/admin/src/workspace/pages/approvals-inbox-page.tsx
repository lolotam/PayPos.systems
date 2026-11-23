'use client';

import { t } from '@pospay/i18n';
import { EmptyState, Inbox, PageHeader, PageShell, shellNavLinkClass } from '@pospay/ui';

import { useLocale } from '@/shared/locale/locale-context';

export interface ApprovalKind {
  id: string;
  label: string;
  href: string;
}

/**
 * صندوق الاعتمادات تحت الرئيسية: أنواع الاعتماد الموجودة، كل نوع رابط إلى صفحته (NAV-Q17).
 * الأنواع تصل مفلترة من المستضيف بنفس شرط ظهور صفحاتها، فمن لا يرى صفحة لا يرى نوعها.
 * العدّادات خارج هذا الإصدار لأن القراءات الحالية لا تعطيها بلا طلب إضافي (FR-026).
 * أثناء التحقق من الصلاحيات يظهر «جارٍ التحميل» ولو ظهرت بعض الأنواع، فلا تبدو القائمة مكتملة؛ وإن فشل التحقق قيل ذلك؛ نص الفراغ لا يُعرض إلا بعد
 * اكتمال التحقق، وهو يقول إن لا قائمة متاحة لا إن لا شيء ينتظر القرار (الصندوق لا يعرف عدد ما ينتظر).
 */
export function ApprovalsInboxPage({
  kinds,
  state = 'settled',
}: {
  kinds: readonly ApprovalKind[];
  state?: 'loading' | 'failed' | 'settled';
}) {
  const locale = useLocale();
  return (
    <PageShell layout="form" className="flex flex-col gap-6">
      <PageHeader
        title={t(locale, 'adminNavPages.approvalsInbox')}
        description={t(locale, 'adminNav.approvalsInboxLead')}
      />
      {state === 'failed' ? <p role="alert">{t(locale, 'adminNav.approvalsInboxFailed')}</p> : null}
      {state === 'loading' ? <p role="status">{t(locale, 'admin.loading')}</p> : null}
      {kinds.length === 0 && state === 'settled' ? (
        <EmptyState icon={<Inbox />} title={t(locale, 'adminNav.approvalsInboxEmpty')} />
      ) : null}
      {kinds.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {kinds.map((kind) => (
            <li key={kind.id}>
              <a
                href={kind.href}
                className={`${shellNavLinkClass} w-full rounded-card border border-border bg-card px-4`}
              >
                {kind.label}
              </a>
            </li>
          ))}
        </ul>
      ) : null}
    </PageShell>
  );
}
