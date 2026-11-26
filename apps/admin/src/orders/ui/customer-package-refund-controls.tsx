'use client';

import type { CustomerPackageDetail } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useRef, useState } from 'react';
import { useLocale } from '@/shared/locale/locale-context';
import type { HeldAttempt } from '../api/use-refund-package';
import type { SessionServiceScope } from '../api/use-session-services';
import { RefundPackageDialog } from './refund-package-dialog';

/** حالة حوار الاسترداد تزول عند فقد القدرة على الاسترداد أو رفض قراءة الباقة. */
export function CustomerPackageRefundControls({
  scope,
  customerId,
  entitlementId,
  detail,
  onSaved,
  buttonLabel,
}: {
  scope: SessionServiceScope;
  customerId: string;
  entitlementId: string;
  detail: CustomerPackageDetail;
  onSaved: () => void;
  buttonLabel?: string;
}) {
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const heldAttemptRef = useRef<HeldAttempt | null>(null);
  return (
    <>
      <Button type="button" onClick={() => setOpen(true)}>
        {buttonLabel ?? t(locale, 'packageRefund.refund')}
      </Button>
      {open ? (
        <RefundPackageDialog
          scope={scope}
          customerId={customerId}
          entitlementId={entitlementId}
          components={detail.components}
          heldAttemptRef={heldAttemptRef}
          onSaved={() => {
            setOpen(false);
            onSaved();
          }}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}
