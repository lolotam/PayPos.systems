'use client';

import { t } from '@pospay/i18n';
import { Label } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';
import { useAccessProof } from '@/shared/api/use-access-proof';
import { importedRefundsFailureMessage } from '../model/imported-refunds-failure';
import { useImportedRefunds } from '../api/use-imported-refunds';
import { useSetImportedRefunds } from '../api/use-set-imported-refunds';

export function ImportedRefundsSwitch({
  companyId,
  userId,
  businessId,
}: {
  companyId: string;
  userId: string;
  businessId: string;
}) {
  const locale = useLocale();
  const query = useImportedRefunds(companyId, userId, businessId);
  const mutation = useSetImportedRefunds(companyId, userId, businessId);
  // Ø¥Ø«Ø¨Ø§Øª Ù‚Ø±Ø§Ø¡Ø© Ø­Ø§Ù„ÙŠ Ù‚Ø¨Ù„ Ø¹Ø±Ø¶ Ø£ÙŠ Ù‚ÙŠÙ…Ø© Ù…Ù† Ø§Ù„ÙƒØ§Ø´: Ø§Ù†ØªØ¸Ø§Ø± Ø£Ùˆ Ø±ÙØ¶ (401/403) Ø¨ÙŠØ®ÙÙŠ Ø§Ù„Ù…ÙØªØ§Ø­ Ø¨Ø§Ù„ÙƒØ§Ù…Ù„.
  const proof = useAccessProof(
    query.isFetching,
    query.isError,
    query.error,
    `${companyId}:${userId}:${businessId}`,
    Boolean(companyId && userId && businessId),
  );
  // Ø±ÙØ¶ Ø§Ù„ÙƒØªØ§Ø¨Ø© Ø¨ÙŠÙØ¶Ù„ Ø¸Ø§Ù‡Ø± Ø­ØªÙ‰ Ù„Ùˆ Ù‚Ø±Ø§ÙŠØ© Ù„Ø§Ø­Ù‚Ø© Ø±Ø¬Ø¹Øª Ù†ÙØ³ Ø§Ù„Ù‚ÙŠÙ…Ø© Ø§Ù„Ù…Ø·Ù„ÙˆØ¨Ø©: Ø§Ù„Ù‚ÙŠÙ…Ø© Ø§Ù„Ù…Ø¹Ø±ÙˆØ¶Ø© Ù‡ÙŠ
  // Ø¢Ø®Ø± Ù‚ÙŠÙ…Ø© Ø£ÙƒØ¯Ù‡Ø§ Ø§Ù„Ø®Ø§Ø¯Ù…ØŒ ÙˆØ§Ù„ØªØ­ÙƒÙ… Ù…ØªØ¹Ø·Ù„ Ø£Ø«Ù†Ø§Ø¡ Ø§Ù„ÙƒØªØ§Ø¨Ø© ÙˆØ£Ø«Ù†Ø§Ø¡ Ø¥Ø¹Ø§Ø¯Ø© Ø¥Ø«Ø¨Ø§Øª Ø§Ù„Ø­Ø§Ù„Ø© Ø¨Ø¹Ø¯Ù‡Ø§ØŒ
  // ÙˆØ£ÙŠ Ø±Ø¯ Ù…ØªØ£Ø®Ø± Ù…Ù† ØªÙÙˆÙŠØ¶ Ù‚Ø¯ÙŠÙ… Ù…Ø§ Ø¨ÙŠØ±Ø¬Ø¹Ø´ Ø§Ù„Ù…ÙØªØ§Ø­ Ù„Ø£Ù† Ø§Ù„ÙƒØ§Ø´ Ø¨ÙŠØªØ­Ø¯Ø« Ù…Ù† Ø§Ù„Ù€ GET Ø§Ù„Ù…Ø­Ù…ÙŠ Ø¨Ø³.
  if (proof === 'pending') return null;
  if (proof === 'refused' || query.isError) {
    return (
      <p role="alert">{importedRefundsFailureMessage(mutation.isError ? mutation.error : query.error, locale)}</p>
    );
  }
  const enabled = query.data?.imported_refunds_enabled ?? false;
  // أثناء الكتابة وأثناء إعادة إثبات الصلاحية بعدها المفتاح يختفي بالكامل: الإثبات الجاي هو اللي
  // بيرجّع القيمة المؤكدة والرفض لو الصلاحية اتسحبت، وما فيش رد متأخر من تفويض قديم بيرجع للعرض.
  if (mutation.isPending || ((mutation.isSuccess || mutation.isError) && query.isRefetching))
    return null;
  return (
    <div className="flex flex-col gap-2 rounded-card border border-border p-4">
      <div className="flex items-center gap-3">
        <input
          id="imported-refunds"
          type="checkbox"
          role="switch"
          checked={enabled}
          onChange={(event) => mutation.mutate(event.target.checked)}
        />
        <Label htmlFor="imported-refunds">{t(locale, 'importedRefunds.label')}</Label>
      </div>
      {!enabled ? <p role="status">{t(locale, 'importedRefunds.offNote')}</p> : null}
      {mutation.isError ? <p role="alert">{importedRefundsFailureMessage(mutation.error, locale)}</p> : null}
    </div>
  );
}
