'use client';
import { useEmployeeImport } from '../api/use-employee-import';
import { useImportSelection } from '../api/use-import-selection';
import { EmployeeImportFormCard } from './employee-import-form-card';
import { EmployeeImportOutcome } from './employee-import-outcome';

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
  const { template, preview, commit, status } = useEmployeeImport(companyId, businessId, userId);
  const { file, select, inspect, result } = useImportSelection(preview, commit);
  const clean = result?.error_count === 0;
  const showResult = file === undefined || commit.isSuccess;
  const error =
    [preview, commit, showResult ? status : undefined].find((query) => query?.isError)?.error ??
    null;
  return (
    <>
      <EmployeeImportFormCard
        templateReady={!template.isPending && !template.isError}
        onDownload={() =>
          template.data && downloadBase64(template.data.file_name, template.data.content_base64)
        }
        onSelect={select}
        canPreview={file !== undefined && !preview.isPending}
        onInspect={inspect}
        canCommit={clean && !commit.isPending && commit.data?.preview_id !== result?.preview_id}
        onCommit={() => result && commit.mutate(result.preview_id)}
      />
      <EmployeeImportOutcome
        preview={
          result !== undefined && commit.data?.preview_id !== result.preview_id ? result : undefined
        }
        accepted={commit.isSuccess}
        status={showResult ? status.data : undefined}
        timedOut={showResult && status.timedOut}
        error={error}
      />
    </>
  );
}
