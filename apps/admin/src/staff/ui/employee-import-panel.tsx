'use client';
import { t } from '@pospay/i18n';
import { Button, Card } from '@pospay/ui';
import { useState } from 'react';
import { envelopeMessage } from '@/shared/api/api-error';
import { useLocale } from '@/shared/locale/locale-context';
import { useEmployeeImport } from '../api/use-employee-import';
import { EmployeeImportErrors } from './employee-import-errors';
import { EmployeeImportResult } from './employee-import-result';

function downloadBase64(fileName: string, base64: string) {
  const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
  const url = URL.createObjectURL(
    new Blob([bytes], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
  );
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

type EmployeeImportPanelProps = {
  companyId: string;
  businessId: string;
  userId: string;
};

/** لوحة استيراد الموظفين: تنزيل القالب، الرفع والمعاينة، ثم الحفظ عند خلو الأخطاء. */
export function EmployeeImportPanel({ companyId, businessId, userId }: EmployeeImportPanelProps) {
  const locale = useLocale();
  const { template, preview, commit, status } = useEmployeeImport(companyId, businessId, userId);
  const [file, setFile] = useState<File>();
  const error = [preview, commit, status].find((query) => query.isError)?.error ?? null;
  const clean = preview.isSuccess && preview.data.error_count === 0;
  return (
    <Card className="flex flex-col gap-4 p-6">
      <Button
        type="button"
        variant="outline"
        className="self-start"
        disabled={template.isPending || template.isError}
        onClick={() =>
          template.data && downloadBase64(template.data.file_name, template.data.content_base64)
        }
      >
        {t(locale, 'employeeImport.download')}
      </Button>
      <label className="flex flex-col gap-2 text-sm">
        {t(locale, 'employeeImport.choose')}
        <input type="file" accept=".xlsx" onChange={(event) => setFile(event.target.files?.[0])} />
      </label>
      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={file === undefined || preview.isPending}
          onClick={() => file && preview.mutate(file)}
        >
          {t(locale, 'employeeImport.preview')}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={
            !clean || commit.isPending || commit.data?.preview_id === preview.data?.preview_id
          }
          onClick={() => preview.data && commit.mutate(preview.data.preview_id)}
        >
          {t(locale, 'employeeImport.commit')}
        </Button>
      </div>
      {preview.isSuccess && commit.data?.preview_id !== preview.data.preview_id ? (
        <EmployeeImportErrors preview={preview.data} />
      ) : null}
      <EmployeeImportResult
        accepted={commit.isSuccess}
        status={status.data}
        timedOut={status.timedOut}
      />
      {error ? <p role="alert">{envelopeMessage(error, locale)}</p> : null}
    </Card>
  );
}
