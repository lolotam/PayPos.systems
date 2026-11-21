'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { isImportedRefundsRefusal } from '../model/imported-refunds-failure';

import { importedRefundsKey, setImportedRefunds } from './imported-refunds-client';

export function useSetImportedRefunds(companyId: string, userId: string, businessId: string) {
  const client = useQueryClient();
  const key = importedRefundsKey(companyId, userId, businessId);
  return useMutation({
    mutationKey: [...key, 'write'],
    retry: false,
    mutationFn: (enabled: boolean) =>
      setImportedRefunds(companyId, businessId, { imported_refunds_enabled: enabled }),
    // Ø§Ù„Ù€ GET Ø§Ù„Ù…Ø­Ù…ÙŠ Ù‡Ùˆ Ø§Ù„Ù…Ø±Ø¬Ø¹ Ø§Ù„ÙˆØ­ÙŠØ¯ Ù„Ù„ÙƒØ§Ø´: Ø£ÙŠ ØªØ³ÙˆÙŠØ© (Ù†Ø¬Ø§Ø­ Ø£Ùˆ ÙØ´Ù„) Ø¨ØªØ¹ÙŠØ¯ Ø§Ù„Ù‚Ø±Ø§Ø¡Ø© Ù…Ù† Ø§Ù„Ø®Ø§Ø¯Ù… ÙˆÙ„Ø§ ØªØ®Ø²Ù†
    // Ø±Ø¯ Ø§Ù„ÙƒØªØ§Ø¨Ø©ØŒ ÙÙ…Ø§ ÙÙŠØ´ Ø±Ø¯ Ù…ØªØ£Ø®Ø± Ù…Ù† ØªÙÙˆÙŠØ¶ Ù‚Ø¯ÙŠÙ… ÙŠØ±Ø¬Ù‘Ø¹ Ø§Ù„Ù…ÙØªØ§Ø­ Ø¨Ø¹Ø¯ Ù…Ø§ Ù‚Ø±Ø§ÙŠØ© Ø£Ø­Ø¯Ø« ØªØ±ÙØ¶ (403).
    onSettled: (_saved, error) =>
      isImportedRefundsRefusal(error)
        ? client.resetQueries({ queryKey: key, exact: true })
        : client.invalidateQueries({ queryKey: key, exact: true }),
  });
}
