'use client';
import type { DiscountProposalStatus, RejectedServiceLine, RequesterDiscountProposalList } from '@pospay/contracts';
import { t, type Locale } from '@pospay/i18n';
import { useLocale } from '@/shared/locale/locale-context';

type Proposal = RequesterDiscountProposalList['items'][number];

function statusText(locale: Locale, status: DiscountProposalStatus): string {
  if (status === 'PENDING') return t(locale, 'discountApproval.pending');
  if (status === 'APPROVED') return t(locale, 'discountApproval.approved');
  if (status === 'REJECTED') return t(locale, 'discountApproval.rejected');
  if (status === 'EXPIRED') return t(locale, 'discountApproval.expired');
  return t(locale, 'discountApproval.consumed');
}

export function SessionDiscountApprovalStatus({ error, proposal }: { error: RejectedServiceLine; proposal?: Proposal | undefined }) {
  const locale = useLocale();
  const status = proposal?.status ?? 'PENDING';
  const decided = proposal ? locale === 'ar' ? proposal.decided_label_ar : proposal.decided_label_en : undefined;
  return <div className="grid gap-1">
    <p>{locale === 'ar' ? error.name_ar ?? error.name_en : error.name_en}</p>
    <p>{statusText(locale, status)}</p>
    {decided ? <p>{t(locale, 'discountApproval.decidedBy')}: {decided}</p> : null}
    {proposal?.decided_via ? <p>{t(locale, proposal.decided_via === 'PIN' ? 'discountApproval.viaPin' : 'discountApproval.viaRemote')}</p> : null}
    {status === 'APPROVED' ? <p>{t(locale, 'discountApproval.approvedSave')}</p> : null}
    {status === 'REJECTED' && proposal?.reject_reason ? <p>{t(locale, 'discountApproval.reason')}: {proposal.reject_reason}</p> : null}
  </div>;
}
