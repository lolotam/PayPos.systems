'use client';

import { t } from '@pospay/i18n';
import { Badge, Bell, Button } from '@pospay/ui';
import { useId, useRef, useState } from 'react';
import { useLocale } from '@/shared/locale/locale-context';
import { useNotifications } from '../api/use-notifications';
import { NotificationPanel } from './notification-panel';
import { useOutsideDismiss } from '../model/use-outside-dismiss';

export function NotificationBell({ companyId }: { companyId: string | undefined }) {
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const { count, list, read } = useNotifications(companyId, open);
  const unread = count.data?.count ?? 0;
  useOutsideDismiss(root, open, () => setOpen(false));
  return (
    <div
      ref={root}
      className="relative"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          setOpen(false);
          button.current?.focus();
        }
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <Button
        ref={button}
        variant="ghost"
        disabled={companyId === undefined}
        aria-label={t(locale, 'inApp.title')}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen(!open)}
      >
        <Bell aria-hidden="true" className="size-5" />
        {unread > 0 ? (
          <Badge aria-label={`${t(locale, 'inApp.unread')}: ${unread}`} aria-live="polite">
            {unread}
          </Badge>
        ) : null}
      </Button>
      {open ? (
        <NotificationPanel
          id={panelId}
          locale={locale}
          items={list.data?.items ?? []}
          loading={list.isPending}
          error={list.isError || count.isError || read.isError}
          pending={read.isPending}
          unread={unread}
          onRead={(id) => read.mutate(id)}
          onReadAll={() => read.mutate(undefined)}
        />
      ) : null}
    </div>
  );
}
