import { t } from '@pospay/i18n';
import { Button, EmptyState, Input, Label, WifiOff } from '@pospay/ui';

import { useLocale } from '@/shared/locale/locale-context';

/** مدخل الكود: ماسح لوحة المفاتيح يكتب ثم Enter؛ المسح معطّل أثناء الانتظار أو عدم الاتصال. */
export function ClockByCardForm({
  code,
  online,
  pending,
  onChange,
  onSubmit,
}: {
  code: string;
  online: boolean;
  pending: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void;
}) {
  const locale = useLocale();
  return (
    <form
      className="flex flex-col gap-3 text-start"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <Label htmlFor="card-code">{t(locale, 'pos.cardLabel')}</Label>
      <Input
        id="card-code"
        value={code}
        autoFocus
        autoComplete="off"
        disabled={pending || !online}
        onChange={(event) => onChange(event.target.value)}
      />
      <Button size="touch" type="submit" disabled={pending || !online || code.trim().length === 0}>
        {t(locale, 'pos.cardSubmit')}
      </Button>
      {!online ? (
        <EmptyState role="status" tone="warning" icon={<WifiOff />} title={t(locale, 'pos.cardOffline')} />
      ) : null}
    </form>
  );
}
