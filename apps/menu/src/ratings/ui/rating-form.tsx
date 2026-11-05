import { zodResolver } from '@hookform/resolvers/zod';
import { submitRatingInput, type SubmitRatingInput } from '@pospay/contracts';
import { t, type Locale } from '@pospay/i18n';
import { Button, Label } from '@pospay/ui';
import { useForm } from 'react-hook-form';
import { RatingStars } from './rating-stars';

export function RatingForm({
  locale,
  pending,
  submit,
}: {
  locale: Locale;
  pending: boolean;
  submit: (input: SubmitRatingInput) => void;
}) {
  const form = useForm<SubmitRatingInput>({ resolver: zodResolver(submitRatingInput) });
  return (
    <form onSubmit={form.handleSubmit(submit)}>
      <fieldset disabled={pending}>
        <legend>{t(locale, 'publicRating.stars')}</legend>
        <RatingStars control={form.control} />
        <Label htmlFor="rating-comment">{t(locale, 'publicRating.comment')}</Label>
        <textarea
          id="rating-comment"
          {...form.register('comment', {
            setValueAs: (comment: string) => (comment.trim() === '' ? undefined : comment),
          })}
        />
        {Object.keys(form.formState.errors).length > 0 && (
          <p role="alert">{t(locale, 'publicRating.invalid')}</p>
        )}
        <Button type="submit">{t(locale, 'publicRating.submit')}</Button>
      </fieldset>
    </form>
  );
}
