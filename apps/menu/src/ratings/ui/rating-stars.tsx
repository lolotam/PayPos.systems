import type { SubmitRatingInput } from '@pospay/contracts';
import { useController, type Control } from 'react-hook-form';

export function RatingStars({ control }: { control: Control<SubmitRatingInput> }) {
  const { field } = useController({ name: 'stars', control });
  return (
    <div className="stars">
      {[1, 2, 3, 4, 5].map((stars) => (
        <label className="star" key={stars}>
          <input
            type="radio"
            name={field.name}
            value={stars}
            ref={field.ref}
            checked={field.value === stars}
            onBlur={field.onBlur}
            onChange={() => field.onChange(stars)}
          />
          <span>
            {stars}
            <span aria-hidden="true"> ★</span>
          </span>
        </label>
      ))}
    </div>
  );
}
