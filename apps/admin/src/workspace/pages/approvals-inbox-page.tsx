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
 */
export function ApprovalsInboxPage({ kinds }: { kinds: readonly ApprovalKind[] }) {
  const locale = useLocale();
  return (
    <PageShell layout="form" className="flex flex-col gap-6">
      <PageHeader
        title={t(locale, 'adminNavPages.approvalsInbox')}
        description={t(locale, 'adminNav.approvalsInboxLead')}
      />
      {kinds.length === 0 ? (
        <EmptyState icon={<Inbox />} title={t(locale, 'adminNav.approvalsInboxEmpty')} />
      ) : (
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
      )}
    </PageShell>
  );
}
