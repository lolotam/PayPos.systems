import { t, type Locale } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useId, useState } from 'react';

import { failureText } from '@/shared/api/api-error';
import { useLocale } from '@/shared/locale/locale-context';
import type { DeviceProposal } from '../api/device-discount-calls';
import { useDeviceDiscountProposals } from '../api/use-device-discount-proposals';
import { usePinDecision, type PinDecision } from '../api/use-pin-decision';
import type { PinDecisionOutcome } from '../model/pin-decision-outcome';
import { DeviceProposalCard } from './device-proposal-card';
import { PinDecisionForm } from './pin-decision-form';

function useProposalSelection(
  items: DeviceProposal[],
  outcome: PinDecisionOutcome | null,
  clear: () => void,
) {
  const [requestedId, setRequestedId] = useState<string | null>(null);
  const exists = requestedId !== null && items.some((proposal) => proposal.id === requestedId);
  const selectedId = outcome?.kind === 'done' || !exists ? null : requestedId;
  const choose = (id: string) => {
    clear();
    setRequestedId(id);
  };
  const cancel = () => {
    clear();
    setRequestedId(null);
  };
  return { selectedId, choose, cancel };
}

function listNotice(list: ReturnType<typeof useDeviceDiscountProposals>, locale: 'ar' | 'en') {
  if (list.isPending) return <p role="status">{t(locale, 'pos.loading')}</p>;
  if (list.isError) {
    return (
      <div role="alert" className="grid gap-3">
        <p>{t(locale, 'deviceDiscountApproval.loadError')}</p>
        <Button type="button" variant="outline" onClick={list.retry}>
          {t(locale, 'deviceDiscountApproval.retry')}
        </Button>
      </div>
    );
  }
  if (list.items.length === 0) return <p>{t(locale, 'deviceDiscountApproval.empty')}</p>;
  return null;
}

const outcomeKeys = {
  pinInvalid: 'deviceDiscountApproval.pinInvalid',
  locked: 'deviceDiscountApproval.locked',
  busy: 'deviceDiscountApproval.busy',
} as const;

function outcomeText(outcome: PinDecisionOutcome | null, locale: Locale): string | null {
  if (outcome === null || outcome.kind === 'done') return null;
  if (outcome.kind === 'stale' || outcome.kind === 'failure') {
    return failureText(outcome.failure, locale);
  }
  return t(locale, outcomeKeys[outcome.kind]);
}

function outcomeNotice(
  outcome: PinDecisionOutcome | null,
  decision: PinDecision | null,
  locale: Locale,
) {
  const error = outcomeText(outcome, locale);
  return (
    <>
      {outcome?.kind === 'done' && decision !== null ? (
        <p role="status" className="font-medium">
          {t(
            locale,
            decision === 'approve'
              ? 'deviceDiscountApproval.approved'
              : 'deviceDiscountApproval.rejected',
          )}
        </p>
      ) : null}
      {error !== null ? (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      ) : null}
    </>
  );
}

export function DeviceDiscountApprovals({
  branchId,
  onRejected,
}: {
  branchId: string;
  onRejected: () => Promise<void>;
}) {
  const locale = useLocale();
  const titleId = useId();
  const list = useDeviceDiscountProposals(branchId, onRejected);
  const controller = usePinDecision(branchId);
  const { outcome, decision, clear } = controller;
  const { selectedId, choose, cancel } = useProposalSelection(list.items, outcome, clear);
  return (
    <section aria-labelledby={titleId} className="grid gap-4">
      <div>
        <h2 id={titleId} className="text-2xl font-bold">
          {t(locale, 'deviceDiscountApproval.title')}
        </h2>
        <p className="text-muted-foreground">{t(locale, 'deviceDiscountApproval.lead')}</p>
      </div>
      {listNotice(list, locale) ?? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {list.items.map((proposal) => (
            <div key={proposal.id}>
              <DeviceProposalCard
                proposal={proposal}
                selected={selectedId === proposal.id}
                onChoose={() => choose(proposal.id)}
              />
              {selectedId === proposal.id ? (
                <PinDecisionForm
                  key={proposal.id}
                  proposal={proposal}
                  controller={controller}
                  onCancel={cancel}
                />
              ) : null}
            </div>
          ))}
        </div>
      )}
      {list.hasMore ? (
        <Button type="button" variant="outline" disabled={list.loadingMore} onClick={list.loadMore}>
          {t(locale, 'deviceDiscountApproval.more')}
        </Button>
      ) : null}
      {outcomeNotice(outcome, decision, locale)}
    </section>
  );
}
