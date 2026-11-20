import type { SubmitRatingInput } from '@pospay/contracts';
import { Star } from '@pospay/ui';
import { useController, type Control } from 'react-hook-form';

export function RatingStars({ control }: { control: Control<SubmitRatingInput> }) {
  const { field } = useController({ name: 'stars', control });
  return (
    <div className="grid grid-cols-5 gap-2">
      {[1, 2, 3, 4, 5].map((stars) => (
        <label
          className="inline-flex min-h-12 min-w-0 cursor-pointer items-center justify-center gap-1 rounded-interactive border border-input bg-card ps-1 pe-1 text-base font-semibold text-card-foreground has-[:checked]:border-primary has-[:checked]:bg-primary has-[:checked]:text-primary-foreground has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50 forced-colors:has-[:checked]:border-4"
          key={stars}
        >
          <input
            type="radio"
            name={field.name}
            value={stars}
            ref={field.ref}
            checked={field.value === stars}
            onBlur={field.onBlur}
            onChange={() => field.onChange(stars)}
            className="sr-only"
          />
          <span>{stars}</span>
          <Star aria-hidden="true" className="size-5" />
        </label>
      ))}
    </div>
  );
}
