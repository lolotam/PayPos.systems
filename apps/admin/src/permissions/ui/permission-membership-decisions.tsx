import type { MembershipPermissions } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { envelopeMessage } from '@/shared/api/api-error';
import { useLocale } from '@/shared/locale/locale-context';
import type { usePermissions } from '../api/use-permissions';
import { PermissionOverrides } from './permission-overrides';
import { PermissionOverrideForm } from './permission-override-form';
import { PermissionPageNavigation } from './permission-page-navigation';

type Props = {
  data: MembershipPermissions;
  companyId: string;
  branchTimeZones: Readonly<Record<string, string>>;
  save: ReturnType<typeof usePermissions>['save'];
  revoke: ReturnType<typeof usePermissions>['revoke'];
  cursor: string | undefined;
  onCursorChange: (cursor: string | undefined) => void;
};
export function PermissionMembershipDecisions({
  data,
  companyId,
  branchTimeZones,
  save,
  revoke,
  cursor,
  onCursorChange,
}: Props) {
  const locale = useLocale();
  return (
    <>
      <h2>{t(locale, 'permissions.overrides')}</h2>
      <PermissionOverrides
        items={data.overrides.items}
        branchTimeZones={branchTimeZones}
        pending={save.isPending || revoke.isPending}
        {...(data.editing_enabled
          ? {
              onRevoke: (overrideId: string, reason: string) =>
                revoke.mutate({ overrideId, reason }),
            }
          : {})}
      />
      <PermissionPageNavigation
        cursor={cursor}
        next={data.overrides.next_cursor}
        onChange={onCursorChange}
      />
      {!data.editing_enabled ? <p role="status">{t(locale, 'permissions.readOnly')}</p> : null}
      <PermissionOverrideForm
        companyId={companyId}
        catalog={data.permission_catalog}
        disabled={!data.editing_enabled}
        pending={save.isPending || revoke.isPending}
        onSave={(terms) => save.mutate(terms)}
      />
      {save.isError ? <p role="alert">{envelopeMessage(save.error, locale)}</p> : null}
      {save.isSuccess ? <p role="status">{t(locale, 'permissions.saved')}</p> : null}
      {revoke.isError ? <p role="alert">{envelopeMessage(revoke.error, locale)}</p> : null}
      {revoke.isSuccess ? <p role="status">{t(locale, 'permissions.revoked')}</p> : null}
    </>
  );
}
