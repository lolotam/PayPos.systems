'use client';

import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';
import { ModalDialog } from '@/shared/ui/modal-dialog';
import type { StatementScope } from '../api/commission-statement-client';
import type { StatementExportLanguage } from '../api/commission-statement-export-client';
import { StatementExportProgress } from './statement-export-progress';
import { useStatementExport } from './use-statement-export';

const NS = 'commissionStatementScreen';
const LANGUAGES: readonly StatementExportLanguage[] = ['ar', 'en'];

/** اختيار لغة ملف الإكسل: عربي أو إنجليزي؛ مقفول طول ما التصدير شغّال. */
function LanguageChoice({
  value,
  locked,
  onChange,
}: {
  value: StatementExportLanguage;
  locked: boolean;
  onChange(language: StatementExportLanguage): void;
}) {
  const locale = useLocale();
  return (
    <fieldset className="flex flex-wrap items-center gap-4" disabled={locked}>
      <legend className="font-medium">{t(locale, `${NS}.exportLanguageLabel`)}</legend>
      {LANGUAGES.map((option) => (
        <label key={option} className="flex items-center gap-2">
          <input
            type="radio"
            name="statement-export-language"
            value={option}
            checked={value === option}
            onChange={() => onChange(option)}
          />
          {t(locale, option === 'ar' ? `${NS}.exportLanguageAr` : `${NS}.exportLanguageEn`)}
        </label>
      ))}
    </fieldset>
  );
}

/**
 * حوار تصدير كشف الشهر المغلق إكسل: المستخدم يختار لغة الملف (الافتراضي لغة الشاشة) ويبدأ التصدير،
 * والحوار بيتابع التجهيز لحد ما يبقى جاهز فيحمّله مرة واحدة. النطاق والموظفات بيحدّدهم السيرفر
 * من صلاحية الطالب، مش من هنا.
 */
export function StatementExportDialog({
  scope,
  period,
  onClose,
}: {
  scope: StatementScope;
  period: string;
  onClose(): void;
}) {
  const locale = useLocale();
  const exporting = useStatementExport(scope, period);
  return (
    <ModalDialog title={t(locale, `${NS}.exportTitle`)} pending={exporting.busy} onClose={onClose}>
      <p>{t(locale, `${NS}.exportBody`)}</p>
      <LanguageChoice
        value={exporting.language}
        locked={exporting.locked}
        onChange={exporting.setLanguage}
      />
      <StatementExportProgress
        view={exporting.view}
        downloading={exporting.downloading}
        onStart={exporting.start}
        onDownload={exporting.download}
        onCheckAgain={exporting.checkAgain}
        onNew={exporting.startNew}
      />
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={exporting.busy} onClick={onClose}>
          {t(locale, `${NS}.exportClose`)}
        </Button>
      </div>
    </ModalDialog>
  );
}
