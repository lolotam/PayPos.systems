import { t, type Locale } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { RatingRequestError, useRating } from '../api/use-rating';
import { RatingForm } from '../ui/rating-form';

export function RatingScreen({ token, locale }: { token: string; locale: Locale }) {
  const { view, submit, optOut } = useRating(token);
  // الرد المقروء بعد تعارض الإرسال يسمح بإظهار الإكمال للرابط المستهلك حتى انتهاء صلاحيته.
  const submitError = view.data?.state === 'submitted' ? null : submit.error;
  const unavailable = [view.error, submitError, optOut.error].some(
    (error) => error instanceof RatingRequestError && error.code === 'RATING_LINK_UNAVAILABLE',
  );
  if (!token || unavailable) return <p role="alert">{t(locale, 'publicRating.unavailable')}</p>;
  if (view.isError && !view.data)
    return (
      <section>
        <p role="alert">{t(locale, 'publicRating.error')}</p>
        <Button onClick={() => void view.refetch()}>{t(locale, 'publicRating.retry')}</Button>
      </section>
    );
  if (!view.data) return <p role="status">{t(locale, 'publicRating.loading')}</p>;
  const pending = submit.isPending || optOut.isPending || view.isFetching;
  return (
    <section>
      <h1>
        {t(locale, 'publicRating.title')} <bdi>{view.data.business_name}</bdi>
      </h1>
      {view.data.state === 'submitted' ? (
        <p role="status">{t(locale, 'publicRating.done')}</p>
      ) : (
        <RatingForm locale={locale} pending={pending} submit={(input) => submit.mutate(input)} />
      )}
      {submit.isError && view.data.state !== 'submitted' && (
        <p role="alert">
          {t(
            locale,
            submit.error instanceof RatingRequestError &&
              submit.error.code === 'RATING_INPUT_INVALID'
              ? 'publicRating.invalid'
              : 'publicRating.error',
          )}
        </p>
      )}
      {optOut.isSuccess ? (
        <p role="status">{t(locale, 'publicRating.optedOut')}</p>
      ) : (
        <Button variant="ghost" disabled={pending} onClick={() => optOut.mutate()}>
          {t(locale, 'publicRating.optOut')}
        </Button>
      )}
      {optOut.isError && <p role="alert">{t(locale, 'publicRating.error')}</p>}
    </section>
  );
}
