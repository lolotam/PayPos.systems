'use client';

import { t, type Locale } from '@pospay/i18n';
import { Bell, Button } from '@pospay/ui';
import type { RefObject } from 'react';

import { UnreadBadge } from './notification-unread-badge';

/**
 * زرّ الجرس في الشريط العلوي: هدفه 44px زي باقي أزرار الرأس وأيقونته 16px، وفيه غير
 * مقروء يتوسّع بعرض الشارة من غير ما ينقص الارتفاع تحت 44px.
 */
export function NotificationBellButton({
  buttonRef,
  locale,
  open,
  panelId,
  unread,
  disabled,
  onToggle,
}: {
  buttonRef: RefObject<HTMLButtonElement | null>;
  locale: Locale;
  open: boolean;
  panelId: string;
  unread: number;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <Button
      ref={buttonRef}
      variant="ghost"
      size="icon"
      disabled={disabled}
      aria-label={t(locale, 'inApp.title')}
      aria-expanded={open}
      aria-controls={panelId}
      onClick={onToggle}
      className={unread > 0 ? 'w-auto min-w-11 shrink-0 px-2.5' : 'shrink-0'}
    >
      <Bell aria-hidden="true" className="size-4" />
      <UnreadBadge unread={unread} locale={locale} />
    </Button>
  );
}
