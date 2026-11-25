'use client';
import { usePackageImport } from '../api/use-package-import';
import { PackageImportFormCard } from './package-import-form-card';
import { PackageImportOutcome } from './package-import-outcome';

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

type PackageImportPanelProps = {
  companyId: string;
  businessId: string;
  userId: string;
};

/** لوحة استيراد الباقات: تنزيل القالب، الرفع والمعاينة غير المتزامنة، ثم الحفظ عند خلو الأخطاء. */
export function PackageImportPanel({ companyId, businessId, userId }: PackageImportPanelProps) {
  const { template, preview, commit, status, request, selection, select, previewId } =
    usePackageImport(companyId, businessId, userId);
  // حالة وصلت لمعاينة غير الجارية لا تُعرض ولا تُحفظ.
  const stale = status.data !== undefined && status.data.preview_id !== previewId;
  const current = stale ? undefined : status.data;
  const canCommit =
    !stale &&
    current?.status === 'ready' &&
    current.error_count === 0 &&
    !request.commitAccepted &&
    !commit.isPending;
  const error =
    [preview, commit, stale ? undefined : status, template].find((query) => query?.isError)
      ?.error ?? null;
  return (
    <>
      <PackageImportFormCard
        templateReady={!template.isPending && !template.isError}
        onDownload={() =>
          template.data && downloadBase64(template.data.file_name, template.data.content_base64)
        }
        onSelect={select}
        canPreview={selection.file !== undefined && !preview.isPending}
        onInspect={() => {
          if (!selection.file) return;
          preview.mutate({ token: request.currentToken(), file: selection.file });
        }}
        canCommit={canCommit}
        onCommit={() => {
          if (!previewId) return;
          commit.mutate({ token: request.currentToken(), previewId });
        }}
      />
      <PackageImportOutcome
        status={current}
        previewAccepted={
          previewId !== undefined && current === undefined && !stale && !status.isError
        }
        commitAccepted={request.commitAccepted}
        timedOut={!stale && status.timedOut}
        error={error}
      />
    </>
  );
}
