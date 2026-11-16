import { t } from '@pospay/i18n';
import { Button, Label, NativeSelect } from '@pospay/ui';
import { useState } from 'react';

import { useLocale } from '@/shared/locale/locale-context';
import type { PinDecision } from '../api/use-pin-decision';
import {
  approverMembershipLabel,
  type ApproverMembership,
} from '../model/approver-memberships';

export function ApproverMembershipSelect({
  memberships,
  decision,
  pending,
  online,
  onChoose,
  onCancel,
}: {
  memberships: ApproverMembership[];
  decision: PinDecision;
  pending: boolean;
  online: boolean;
  onChoose: (membershipId: string) => void;
  onCancel: () => void;
}) {
  const locale = useLocale();
  const [membershipId, setMembershipId] = useState('');
  return (
    <div className="grid gap-3">
      <p>{t(locale, 'deviceDiscountApproval.membershipPrompt')}</p>
      <Label htmlFor="approver-membership">{t(locale, 'deviceDiscountApproval.membership')}</Label>
      <NativeSelect
        id="approver-membership"
        value={membershipId}
        disabled={pending || !online}
        onChange={(event) => setMembershipId(event.target.value)}
      >
        <option value="">{t(locale, 'deviceDiscountApproval.membership')}</option>
        {memberships.map((membership, index) => (
          <option key={membership.membershipId} value={membership.membershipId}>
            {approverMembershipLabel(locale, membership, index)}
          </option>
        ))}
      </NativeSelect>
      <Button
        type="button"
        variant={decision === 'reject' ? 'destructive' : 'default'}
        disabled={membershipId === '' || pending || !online}
        onClick={() => onChoose(membershipId)}
      >
        {pending
          ? t(locale, 'deviceDiscountApproval.deciding')
          : t(
              locale,
              decision === 'approve'
                ? 'deviceDiscountApproval.approve'
                : 'deviceDiscountApproval.reject',
            )}
      </Button>
      <Button type="button" variant="ghost" onClick={onCancel}>
        {t(locale, 'deviceDiscountApproval.cancel')}
      </Button>
    </div>
  );
}
