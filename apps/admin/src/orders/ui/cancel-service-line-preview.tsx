'use client';
import { parseMoney } from '@pospay/domain';
import { formatKwd, t, type Locale } from '@pospay/i18n';
import { Badge } from '@pospay/ui';

export type CancelDialogLine = {
  id: string;
  revision: number;
  price?: string;
  discount?: string;
  net?: string;
  edited?: boolean;
  performers?: readonly { name_ar: string | null; name_en: string }[];
};

const shown = (locale: Locale, row: { name_ar: string | null; name_en: string }) =>
  locale === 'ar' ? (row.name_ar ?? row.name_en) : row.name_en;

// الأرقام ظاهرة جوه الحوار عشان المدير يشوف السطر بعد الجلب قبل ما يأكد الإلغاء.
export function CancelServiceLinePreview({
  line,
  locale,
}: {
  line: CancelDialogLine;
  locale: Locale;
}) {
  if (!line.price || !line.discount || !line.net) return null;
  const names = (line.performers ?? []).map((row) => shown(locale, row)).join(', ');
  return (
    <div className="grid gap-1 text-start">
      {line.edited ? <Badge>{t(locale, 'serviceLineEdit.edited')}</Badge> : null}
      <p>
        {t(locale, 'serviceSessions.price')} <bdi>{formatKwd(parseMoney(line.price))}</bdi>
      </p>
      <p>
        {t(locale, 'serviceLineEdit.discount')} <bdi>{formatKwd(parseMoney(line.discount))}</bdi>
      </p>
      <p>
        {t(locale, 'serviceLineEdit.net')} <bdi>{formatKwd(parseMoney(line.net))}</bdi>
      </p>
      {names ? <p>{names}</p> : null}
    </div>
  );
}
