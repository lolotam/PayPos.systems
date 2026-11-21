'use client';

import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useState } from 'react';
import { useLocale } from '@/shared/locale/locale-context';
import type { SessionServiceScope } from '../api/use-session-services';
import { ExtendPackageDialog } from './extend-package-dialog';

/** حالة حوار التمديد تزول عند فقد القدرة على التمديد أو رفض قراءة الباقة. */
export function CustomerPackageExtensionControls({
  scope,
  customerId,
  entitlementId,
  expiresOn,
  onSaved,
}: {
  scope: SessionServiceScope;
  customerId: string;
  entitlementId: string;
  expiresOn: string;
  onSaved: () => void;
}) {
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" onClick={() => setOpen(true)}>
        {t(locale, 'customerPackages.extend')}
      </Button>
      {open ? (
        <ExtendPackageDialog
          scope={scope}
          customerId={customerId}
          entitlementId={entitlementId}
          currentExpiresOn={expiresOn}
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
