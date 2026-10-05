import { t } from '@pospay/i18n';
import { CircleAlert, EmptyState, LoaderCircle } from '@pospay/ui';
import { envelopeMessage } from '@/shared/api/api-error';
import { useLocale } from '@/shared/locale/locale-context';

export function PermissionListFeedback({
  pending,
  failed,
  error,
}: {
  pending: boolean;
  failed: boolean;
  error: unknown;
}) {
  const locale = useLocale();
  return (
    <>
      {pending ? (
        <EmptyState role="status" icon={<LoaderCircle />} title={t(locale, 'admin.loading')} />
      ) : null}
      {failed ? (
        <EmptyState
          role="alert"
          tone="danger"
          icon={<CircleAlert />}
          title={envelopeMessage(error, locale)}
        />
      ) : null}
    </>
  );
}
