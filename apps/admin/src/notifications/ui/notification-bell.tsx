'use client';

import { useId, useRef, useState } from 'react';
import { useLocale } from '@/shared/locale/locale-context';
import { useNotifications } from '../api/use-notifications';
import { useDocumentNumbers } from '../api/use-document-numbers';
import { NotificationBellButton } from './notification-bell-button';
import { NotificationPanel } from './notification-panel';
import { useOutsideDismiss } from '../model/use-outside-dismiss';

interface NotificationBellProps {
  companyId: string | undefined;
  userId: string | null;
  businessId?: string | undefined;
}

export function NotificationBell({ companyId, userId, businessId }: NotificationBellProps) {
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const { count, list, read } = useNotifications(companyId, open, userId);
  const documentNumbers = useDocumentNumbers({
    companyId,
    userId,
    businessId,
    inboxRead: open && list.isSuccess && list.fetchStatus === 'idle' ? list.dataUpdatedAt : null,
    items: list.data?.items ?? [],
  });
  const unread = count.data?.count ?? 0;
  const close = () => setOpen(false);
  useOutsideDismiss(root, open, close);
  return (
    <div
      ref={root}
      className="relative"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          close();
          button.current?.focus();
        }
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) close();
      }}
    >
      <NotificationBellButton
        buttonRef={button}
        locale={locale}
        open={open}
        panelId={panelId}
        unread={unread}
        disabled={companyId === undefined || userId === null}
        onToggle={() => setOpen(!open)}
      />
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
