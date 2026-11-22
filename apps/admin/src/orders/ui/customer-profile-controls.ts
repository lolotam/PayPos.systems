import type { Locale } from '@pospay/i18n';
import type { UseFormReturn } from 'react-hook-form';

import type { SessionCustomerFormValues } from '../api/use-session-customer';

export type Registration = ReturnType<UseFormReturn<SessionCustomerFormValues>['register']>;

export type FieldProps = {
  id: string;
  locale: Locale;
  describedBy: string | undefined;
};

// كل تغيير في حقل يبطل الاختيار الحالي، وبعد أول محاولة يعيد تحقق بقية حقول المجموعة.
export function changed(
  registration: Registration,
  invalidate: () => void,
  revalidate?: () => void,
): Registration {
  return {
    ...registration,
    onChange: (...args: Parameters<Registration['onChange']>) => {
      const submitted = registration.onChange(...args);
      invalidate();
      if (revalidate !== undefined) void Promise.resolve(submitted).then(revalidate);
      return submitted;
    },
  };
}
