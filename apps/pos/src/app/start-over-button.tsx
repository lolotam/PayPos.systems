import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';

import { useLocale } from '@/shared/locale/locale-context';

/** رجوع آمن لاختيار نوع الجهاز لما لسه مفيش اقتران ولا جلسة (FR-001). */
export function StartOverButton({
  onStartOver,
  busy,
}: {
  onStartOver: () => void;
  busy: boolean;
}) {
  const locale = useLocale();
  return (
    <div className="mx-auto mt-4 flex w-full max-w-md justify-center">
      <Button type="button" variant="outline" disabled={busy} onClick={onStartOver}>
        {t(locale, 'nativeShell.startOver')}
      </Button>
    </div>
  );
}
