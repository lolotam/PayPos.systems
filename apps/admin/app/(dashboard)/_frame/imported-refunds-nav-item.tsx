'use client';

import { t } from '@pospay/i18n';
import { AppSidebarItem, ArrowCounterClockwise } from '@pospay/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSessionUser } from '@/session/api/use-session';
import { useMounted } from '@/shared/browser/use-mounted';
import { useLocale } from '@/shared/locale/locale-context';
import { useWorkspace } from '@/workspace/model/workspace-provider';
import { readAccessProof } from '@/shared/api/read-access-proof';
import { useImportedRefunds } from '@/settings/imported-refunds/api/use-imported-refunds';

export function ImportedRefundsNavItem() {
  const locale = useLocale();
  const pathname = usePathname();
  const userId = useSessionUser(useMounted());
  const workspace = useWorkspace();
  const ready = workspace.status === 'ready' ? workspace : null;
  const access = useImportedRefunds(ready?.company.id, userId, ready?.business?.id);
  // Ø¥Ø«Ø¨Ø§Øª Ù‚Ø±Ø§Ø¡Ø© Ø­Ø§Ù„ÙŠ Ù„ÙƒÙ„ Ù†Ø·Ø§Ù‚ Ù‚Ø¨Ù„ Ø¥Ø¸Ù‡Ø§Ø± Ø§Ù„Ø¹Ù†ØµØ±: Ø§Ù„ÙƒØ§Ø´ Ø§Ù„Ù…ØªØ®Ø²Ù† Ù„Ø§ ÙŠÙØ¸Ù‡Ø± Ø±Ø§Ø¨Ø·Ù‹Ø§ØŒ ÙˆØ§Ù„Ø±ÙØ¶ ÙŠØ®ÙÙŠÙ‡ØŒ
  // ÙˆÙ†ØªÙŠØ¬Ø© Ù†Ø·Ø§Ù‚ Ù‚Ø¯ÙŠÙ… Ù…ØªØ£Ø®Ø±Ø© Ø¨ØªØªØ¬Ø§Ù‡Ù„ Ø¹Ø´Ø§Ù† Ø§Ù„Ø±Ø§Ø¨Ø· Ù…Ø§ ÙŠØ¸Ù‡Ø±Ø´ Ù…Ù† ØªÙÙˆÙŠØ¶ Ù…Ø´ Ø­ÙŠ.
  const proof = readAccessProof(access);
  if (!ready?.business || userId === null) return null;
  if (proof !== 'granted') return null;
  return (
    <AppSidebarItem
      asChild
      icon={<ArrowCounterClockwise />}
      label={t(locale, 'importedRefunds.title')}
      active={pathname === '/imported-refunds'}
    >
      <Link href="/imported-refunds" />
    </AppSidebarItem>
  );
}
