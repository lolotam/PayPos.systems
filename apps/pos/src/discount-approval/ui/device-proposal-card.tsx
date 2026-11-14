import { t } from '@pospay/i18n';
import { Badge, Button, Card } from '@pospay/ui';

import { useLocale } from '@/shared/locale/locale-context';
import type { DeviceProposal } from '../api/device-discount-calls';
import { localName, percentText, timeLeftParts } from '../model/proposal-display';

function useProposalFields(proposal: DeviceProposal) {
  const locale = useLocale();
  const currency = t(locale, 'deviceDiscountApproval.currency');
  const number = new Intl.NumberFormat(locale, { numberingSystem: 'latn' });
  const left = timeLeftParts(new Date(proposal.expires_at), new Date());
  const timeLeft = t(locale, 'deviceDiscountApproval.timeLeft')
    .replace('{hours}', number.format(left.hours))
    .replace('{minutes}', number.format(left.minutes));
  return [
    ['listPrice', `${proposal.list_price} ${currency}`],
    ['price', `${proposal.price} ${currency}`],
    ['discount', `${proposal.discount} ${currency}`],
    ['net', `${proposal.net} ${currency}`],
    [
      'percent',
      t(locale, 'deviceDiscountApproval.percent').replace(
        '{value}',
        percentText(proposal.effective_bps),
      ),
    ],
    [
      'requester',
      localName(locale, proposal.requester_first_name_ar, proposal.requester_first_name_en),
    ],
    ['customer', proposal.customer_first_name],
    ['timeLeft', timeLeft],
  ] as const;
}

export function DeviceProposalCard({
  proposal,
  selected,
  onChoose,
}: {
  proposal: DeviceProposal;
  selected: boolean;
  onChoose: () => void;
}) {
  const locale = useLocale();
  const fields = useProposalFields(proposal);
  return (
    <Card className="flex h-full flex-col gap-4 p-4">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-lg font-semibold">
          {localName(locale, proposal.service_name_ar, proposal.service_name_en)}
        </h3>
        {proposal.kind === 'EDIT' ? (
          <Badge variant="secondary">{t(locale, 'deviceDiscountApproval.kindEdit')}</Badge>
        ) : null}
      </div>
      <dl className="grid gap-2 text-sm">
        {fields.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-4">
            <dt className="text-muted-foreground">
              {t(locale, `deviceDiscountApproval.${label}`)}
            </dt>
            <dd className="text-end font-medium">{value}</dd>
          </div>
        ))}
      </dl>
      <Button
        type="button"
        variant={selected ? 'default' : 'outline'}
        aria-pressed={selected}
        onClick={onChoose}
        className="mt-auto"
      >
        {t(locale, 'deviceDiscountApproval.choose')}
      </Button>
    </Card>
  );
}
