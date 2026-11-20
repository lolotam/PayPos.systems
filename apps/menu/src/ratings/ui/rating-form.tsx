import { zodResolver } from '@hookform/resolvers/zod';
import { submitRatingInput, type SubmitRatingInput } from '@pospay/contracts';
import { t, type Locale } from '@pospay/i18n';
import { Button, Label } from '@pospay/ui';
import { useForm } from 'react-hook-form';
import { RatingNotice } from './rating-notice';
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
    <form onSubmit={form.handleSubmit(submit)} className="grid gap-4">
      <fieldset disabled={pending} className="grid gap-4 border-0 p-0 m-0 min-w-0">
        <legend className="mb-2 text-sm font-medium">{t(locale, 'publicRating.stars')}</legend>
        <RatingStars control={form.control} />
        <Label htmlFor="rating-comment">{t(locale, 'publicRating.comment')}</Label>
        <textarea
          id="rating-comment"
          className="min-h-28 w-full rounded-interactive border border-input bg-card ps-3 pe-3 py-2 text-start text-base text-card-foreground placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50"
          {...form.register('comment', {
            setValueAs: (comment: string) => (comment.trim() === '' ? undefined : comment),
          })}
        />
        {Object.keys(form.formState.errors).length > 0 && (
          <RatingNotice tone="alert">{t(locale, 'publicRating.invalid')}</RatingNotice>
        )}
        <Button type="submit" className="w-full">
          {t(locale, 'publicRating.submit')}
        </Button>
      </fieldset>
    </form>
  );
}
