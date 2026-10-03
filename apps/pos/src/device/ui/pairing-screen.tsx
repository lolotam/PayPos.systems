import type { RegisterDeviceInput } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { BrandedPanel, EmptyState, CircleAlert } from '@pospay/ui';

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
    <BrandedPanel
      brandTitle={t(locale, 'brand.title')}
      title={t(locale, 'pos.pairingTitle')}
      description={t(locale, 'pos.pairingLead')}
    >
      {notice ? (
        <EmptyState
          role="alert"
          className="mb-6"
          tone="danger"
          icon={<CircleAlert />}
          title={t(locale, notice === 'refused' ? 'pos.refused' : 'pos.removed')}
        />
      ) : null}
      <PairingForm onSubmit={onSubmit} />
    </BrandedPanel>
  );
}
