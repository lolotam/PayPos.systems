'use client';
import type { PackageTypeListItem } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { envelopeMessage } from '@/shared/api/api-error';
import { useLocale } from '@/shared/locale/locale-context';
import { usePackageTypeSelling } from '../api/use-package-types';

export function PackageTypeSellingToggle({
  item,
  canManage,
  companyId,
  businessId,
  userId,
}: {
  item: PackageTypeListItem;
  canManage: boolean;
  companyId: string;
  businessId: string;
  userId: string;
}) {
  const locale = useLocale();
  const selling = usePackageTypeSelling(companyId, businessId, userId);
  if (!canManage) return null;
  const stopped = item.selling_stopped_at !== null;
  return (
    <div className="flex flex-col gap-1">
      <Button
        variant="outline"
        size="sm"
        disabled={selling.isPending}
        onClick={() =>
          selling.mutate({
            packageTypeId: item.id,
            expectedRevision: item.revision,
            action: stopped ? 'resume' : 'stop',
          })
        }
      >
        {t(
          locale,
          stopped ? 'catalogPackageTypes.resumeSelling' : 'catalogPackageTypes.stopSelling',
        )}
      </Button>
      {selling.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {envelopeMessage(selling.error, locale)}
        </p>
      ) : null}
    </div>
  );
}
