'use client';

import { t } from '@pospay/i18n';
import { Input, Label } from '@pospay/ui';
import { useState } from 'react';
import { useLocale } from '@/shared/locale/locale-context';
import { parseRatingsMonth } from '../model/ratings-period';

/**
 * حقل الشهر: فاضي ومقفول لحد ما يتعرف الشهر (من رد الخادم)، وبعدها يحتفظ بما يكتبه المستخدم ولا يغيّر الفلتر إلا عند شهر
 * كامل صالح، وعند الخروج يرجع لآخر شهر صالح. لما الشهر المعتمد نفسه يتغيّر (أول ما يتعرف، أو الخادم بدّله بعد تغيير
 * الشهر والصفحة مفتوحة) المسودة بتتبعه، وطول ما هو ما اتغيّرش المسودة الجزئية بتفضل زي ما كتبها المستخدم.
 */
export function RatingsMonthField({
  month,
  onChange,
}: {
  month: string | null;
  onChange: (month: string) => void;
}) {
  const locale = useLocale();
  const [draft, setDraft] = useState(month ?? '');
  const [syncedMonth, setSyncedMonth] = useState(month);
  if (syncedMonth !== month) {
    setSyncedMonth(month);
    setDraft(month ?? '');
  }
  return (
    <div className="grid gap-1">
      <Label htmlFor="ratings-month">{t(locale, 'ratings.month')}</Label>
      <Input
        id="ratings-month"
        type="month"
        value={draft}
        disabled={month === null}
        onChange={(event) => {
          setDraft(event.target.value);
          const valid = parseRatingsMonth(event.target.value);
          if (valid) onChange(valid);
        }}
        onBlur={() => setDraft(month ?? '')}
      />
    </div>
  );
}
