import { t } from '@pospay/i18n';
import { EmptyState, CircleAlert } from '@pospay/ui';
import { envelopeMessage } from '@/shared/api/api-error';
import { useLocale } from '@/shared/locale/locale-context';
import type { usePermissions } from '../api/use-permissions';

type Props = Pick<ReturnType<typeof usePermissions>, 'save' | 'revoke'>;

export function PermissionDecisionNotices({ save, revoke }: Props) {
  const locale = useLocale();
  return (
    <>
      {save.isError ? (
        <EmptyState
          role="alert"
          tone="danger"
          icon={<CircleAlert />}
          title={envelopeMessage(save.error, locale)}
        />
      ) : null}
      {save.isSuccess ? (
        <p role="status" className="text-success">
          {t(locale, 'permissions.saved')}
        </p>
      ) : null}
      {revoke.isError ? (
        <EmptyState
          role="alert"
          tone="danger"
          icon={<CircleAlert />}
          title={envelopeMessage(revoke.error, locale)}
        />
      ) : null}
      {revoke.isSuccess ? (
        <p role="status" className="text-success">
          {t(locale, 'permissions.revoked')}
        </p>
      ) : null}
    </>
  );
}
