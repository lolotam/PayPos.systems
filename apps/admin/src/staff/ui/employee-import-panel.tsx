'use client';
import { t } from '@pospay/i18n';
import { Card } from '@pospay/ui';
import { useState } from 'react';
import { envelopeMessage } from '@/shared/api/api-error';
import { useLocale } from '@/shared/locale/locale-context';
import { useEmployeeImport } from '../api/use-employee-import';
import { EmployeeImportErrors } from './employee-import-errors';

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

/** لوحة استيراد الموظفين: تنزيل القالب، الرفع والمعاينة، ثم الحفظ عند خلو الأخطاء. */
export function EmployeeImportPanel({
  companyId,
  businessId,
  userId,
}: {
  companyId: string;
  businessId: string;
  userId: string;
}) {
  const locale = useLocale();
  const { template, preview, commit } = useEmployeeImport(companyId, businessId, userId);
  const [file, setFile] = useState<File>();
  const error = preview.isError ? preview.error : commit.isError ? commit.error : null;
  const clean = preview.isSuccess && preview.data.error_count === 0;
  return (
    <Card className="flex flex-col gap-4 p-6">
      <button
        type="button"
        className="self-start rounded-md border px-3 py-2 text-sm"
        disabled={template.isPending || template.isError}
        onClick={() =>
          template.data && downloadBase64(template.data.file_name, template.data.content_base64)
        }
      >
        {t(locale, 'employeeImport.download')}
      </button>
      <label className="flex flex-col gap-2 text-sm">
        {t(locale, 'employeeImport.choose')}
        <input type="file" accept=".xlsx" onChange={(event) => setFile(event.target.files?.[0])} />
      </label>
      <div className="flex gap-2">
        <button
          type="button"
          className="rounded-md border px-3 py-2 text-sm"
          disabled={file === undefined || preview.isPending}
          onClick={() => file && preview.mutate(file)}
        >
          {t(locale, 'employeeImport.preview')}
        </button>
        <button
          type="button"
          className="rounded-md border px-3 py-2 text-sm"
          disabled={!clean || commit.isPending}
          onClick={() => preview.data && commit.mutate(preview.data.preview_id)}
        >
          {t(locale, 'employeeImport.commit')}
        </button>
      </div>
      {preview.isSuccess ? <EmployeeImportErrors preview={preview.data} /> : null}
      {commit.isSuccess ? (
        <p role="status">
          {t(locale, 'employeeImport.committed')} {commit.data.created_count}
        </p>
      ) : null}
      {error ? <p role="alert">{envelopeMessage(error, locale)}</p> : null}
    </Card>
  );
}
