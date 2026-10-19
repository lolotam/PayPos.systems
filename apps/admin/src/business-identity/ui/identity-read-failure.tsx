'use client';

import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';

export function IdentityReadFailure(props: {
  message: string;
  canRetry: boolean;
  onRetry: () => void;
}) {
  const locale = useLocale();
  return (
    <div className="flex flex-col items-start gap-2">
      <p role="alert">{props.message}</p>
      {props.canRetry ? (
        <Button type="button" variant="outline" onClick={props.onRetry}>
          {t(locale, 'pos.retry')}
        </Button>
      ) : null}
    </div>
  );
}
