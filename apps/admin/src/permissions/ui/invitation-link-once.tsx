'use client';

import { t } from '@pospay/i18n';
import { useEffect, useState } from 'react';

import { useLocale } from '@/shared/locale/locale-context';

type Props = {
  link: string;
  onDismiss: () => void;
};

/**
 * الرابط بيظهر مرة واحدة: الحالة معلقة على هذا المكوّن فقط (useState) — مش في كاش
 * TanStack ولا في أي مخزن، وبينمسح من الذاكرة أول ما المكوّن يختفي.
 */
export function InvitationLinkOnce({ link, onDismiss }: Props) {
  const locale = useLocale();
  const [copied, setCopied] = useState(false);
  useEffect(() => () => setCopied(false), []);
  return (
    <section
      className="flex flex-col gap-2 rounded-card border border-border bg-secondary/30 p-4 text-start"
      aria-live="polite"
      aria-label={t(locale, 'invitations.linkOnceTitle')}
    >
      <h3 className="text-base font-semibold">{t(locale, 'invitations.linkOnceTitle')}</h3>
      <p className="text-sm text-muted-foreground">{t(locale, 'invitations.linkOnceLead')}</p>
      <code className="overflow-x-auto rounded-md border bg-background p-2 text-xs">{link}</code>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard.writeText(link).then(() => setCopied(true));
          }}
          className="rounded-md bg-primary px-4 py-2 text-primary-foreground"
        >
          {t(locale, 'invitations.copy')}
        </button>
        {copied ? (
          <span role="status" className="text-sm text-success">
            {t(locale, 'invitations.copied')}
          </span>
        ) : null}
        <button
          type="button"
          onClick={onDismiss}
          className="rounded-md border border-border px-4 py-2"
        >
          {t(locale, 'invitations.dismiss')}
        </button>
      </div>
    </section>
  );
}
