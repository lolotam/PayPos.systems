import type { RegisterDeviceInput } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Card, CardContent, CardHeader } from '@pospay/ui';

import { useLocale } from '@/shared/locale/locale-context';

import type { PairingNotice } from '../api/screen-state';
import { PairingForm } from './pairing-form';

export function PairingScreen({
  notice,
  onSubmit,
}: {
  notice: PairingNotice | null;
  onSubmit: (values: RegisterDeviceInput) => Promise<string | null>;
}) {
  const locale = useLocale();
  return (
    <div className="mx-auto w-full max-w-md">
      <Card>
        <CardHeader>
          <h1 className="text-start text-lg font-bold leading-tight">
            {t(locale, 'pos.pairingTitle')}
          </h1>
          <p className="text-start text-sm text-muted-foreground">{t(locale, 'pos.pairingLead')}</p>
        </CardHeader>
        <CardContent>
          {notice ? (
            <p role="alert" className="mb-4 text-start text-sm text-destructive">
              {t(locale, notice === 'refused' ? 'pos.refused' : 'pos.removed')}
            </p>
          ) : null}
          <PairingForm onSubmit={onSubmit} />
        </CardContent>
      </Card>
    </div>
  );
}
