'use client';

import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useEffect, useRef, useState } from 'react';
import { useLocale } from '@/shared/locale/locale-context';
import { whatsAppShareHref } from '../model/employee-app-link';

export function EmployeeAppLinkActions({
  link,
  businessName,
}: {
  link: string;
  businessName: string;
}) {
  const locale = useLocale();
  const [feedback, setFeedback] = useState<'copied' | 'failed' | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );
  const copy = async () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    setFeedback(null);
    if (!navigator.clipboard) {
      setFeedback('failed');
      return;
    }
    try {
      await navigator.clipboard.writeText(link);
      setFeedback('copied');
      timer.current = setTimeout(() => {
        setFeedback(null);
        timer.current = null;
      }, 4000);
    } catch {
      setFeedback('failed');
    }
  };
  const line = t(locale, 'employeeAppLink.whatsappLine').replace('{name}', businessName);
  return (
    <div className="flex flex-col items-start gap-3">
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={() => void copy()}>
          {t(locale, 'employeeAppLink.copy')}
        </Button>
        <Button asChild variant="outline">
          <a href={whatsAppShareHref(line, link)} target="_blank" rel="noopener noreferrer">
            {t(locale, 'employeeAppLink.whatsapp')}
          </a>
        </Button>
      </div>
      {feedback === 'copied' ? (
        <p role="status">{t(locale, 'employeeAppLink.copied')}</p>
      ) : null}
      {feedback === 'failed' ? (
        <p role="alert">{t(locale, 'employeeAppLink.copyFailed')}</p>
      ) : null}
    </div>
  );
}
