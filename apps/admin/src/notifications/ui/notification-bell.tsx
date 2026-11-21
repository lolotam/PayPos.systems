'use client';

import { t } from '@pospay/i18n';
import { Badge, Bell, Button } from '@pospay/ui';import { useId, useRef, useState } from 'react';
import { useLocale } from '@/shared/locale/locale-context';
import { useNotifications } from '../api/use-notifications';
import { useDocumentNumbers } from '../api/use-document-numbers';
import { NotificationPanel } from './notification-panel';
import { useOutsideDismiss } from '../model/use-outside-dismiss';

interface NotificationBellProps {
  companyId: string | undefined;
  userId: string | null;
}

/** شارة عدد غير المقروء؛ استُخرجت لإبقاء الجرس تحت سقف طول الدالة. */
function UnreadBadge({ unread, locale }: { unread: number; locale: 'ar' | 'en' | undefined }) {
  if (unread <= 0) return null;
  return (
    <Badge
      variant="brand"
      className="tabular-nums"
      aria-live="polite"
      aria-label={`${t(locale ?? 'en', 'inApp.unread')}: ${unread}`}
    >
      {unread}
    </Badge>
  );
}

export function NotificationBell({ companyId, userId }: NotificationBellProps) {
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const { count, list, read } = useNotifications(companyId, open, userId);
  const documentNumbers = useDocumentNumbers(companyId, userId, open, list.data?.items ?? []);
  const unread = count.data?.count ?? 0;
  const close = () => setOpen(false);
  useOutsideDismiss(root, open, close);
  const focusBack = () => button.current?.focus();
  return (
    <div
      ref={root}
      className="relative"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          close();
          focusBack();
        }
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) close();
      }}
    >
      <Button
        ref={button}
        variant="ghost"
        disabled={companyId === undefined || userId === null}
        aria-label={t(locale, 'inApp.title')}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen(!open)}
      >
        <Bell aria-hidden="true" className="size-5" />
        <UnreadBadge unread={unread} locale={locale} />
      </Button>
      {open ? (
        <NotificationPanel
          id={panelId}
          locale={locale}
          items={list.data?.items ?? []}
          documentNumbers={documentNumbers}
          loading={list.isPending}
          error={list.isError || count.isError || read.isError}
          pending={read.isPending}
          unread={unread}
          onRead={(id) => read.mutate(id)}
          onReadAll={() => read.mutate(undefined)}
        />
      ) : null}{' '}
    </div>
  );
}
