import { t, type Locale } from '@pospay/i18n';
import { Button, Card, CardContent } from '@pospay/ui';
import { RatingRequestError, useRating } from '../api/use-rating';
import { RatingForm } from '../ui/rating-form';
import { RatingNotice } from '../ui/rating-notice';

export function RatingScreen({ token, locale }: { token: string; locale: Locale }) {
  const { view, submit, optOut, linkUnavailable } = useRating(token);
  // الرد المقروء بعد تعارض الإرسال يسمح بإظهار الإكمال للرابط المستهلك حتى انتهاء صلاحيته.
  const submitError = view.data?.state === 'submitted' ? null : submit.error;
  const unavailable = [view.error, submitError, optOut.error].some(
    (error) => error instanceof RatingRequestError && error.code === 'RATING_LINK_UNAVAILABLE',
  );
  if (!token || unavailable || linkUnavailable)
    return <RatingNotice tone="alert">{t(locale, 'publicRating.unavailable')}</RatingNotice>;
  if (view.isError && !view.data)
    return (
      <section>
        <RatingNotice tone="alert">{t(locale, 'publicRating.error')}</RatingNotice>
        <Button onClick={() => void view.refetch()}>{t(locale, 'publicRating.retry')}</Button>
      </section>
    );
  if (!view.data)
    return <RatingNotice tone="loading">{t(locale, 'publicRating.loading')}</RatingNotice>;
  const pending = submit.isPending || optOut.isPending || view.isFetching;
  return (
    <section>
      <Card>
        <CardContent className="flex flex-col gap-4">
          <h1 className="text-start text-2xl">
            {t(locale, 'publicRating.title')} <bdi>{view.data.business_name}</bdi>
          </h1>
          {view.data.state === 'submitted' ? (
            <RatingNotice tone="status">{t(locale, 'publicRating.done')}</RatingNotice>
          ) : (
            <RatingForm
              locale={locale}
              pending={pending}
              submit={(input) => submit.mutate(input)}
            />
          )}
          {submit.isError && view.data.state !== 'submitted' && (
            <RatingNotice tone="alert">
              {t(
                locale,
                submit.error instanceof RatingRequestError &&
                  submit.error.code === 'RATING_INPUT_INVALID'
                  ? 'publicRating.invalid'
                  : 'publicRating.error',
              )}
            </RatingNotice>
          )}
          {optOut.isSuccess ? (
            <RatingNotice tone="status">{t(locale, 'publicRating.optedOut')}</RatingNotice>
          ) : (
            <Button variant="ghost" disabled={pending} onClick={() => optOut.mutate()}>
              {t(locale, 'publicRating.optOut')}
            </Button>
          )}
          {optOut.isError && (
            <RatingNotice tone="alert">{t(locale, 'publicRating.error')}</RatingNotice>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
