'use client';
import { useCustomerImport } from '../api/use-customer-import';
import type { CustomerImportTargetScope } from '../model/customer-import-status';
import { CustomerImportFormCard } from './customer-import-form-card';
import { CustomerImportOutcome } from './customer-import-outcome';

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

/** لوحة استيراد العملاء: تنزيل القالب، الرفع والمعاينة، ثم الحفظ عند خلو الأخطاء. */
export function CustomerImportPanel({ scope }: { scope: CustomerImportTargetScope }) {
  const { template, preview, rows, commit, status, request, selection, select } =
    useCustomerImport(scope);
  const previewId = request.preview?.preview_id;
  const statusPreviewId = commit.data?.preview_id ?? selection.resumedPreviewId;
  // نتيجة حفظ سابقة لمعاينة قديمة ما تظهرش بعد معاينة جديدة أو ملف جديد.
  const stale = previewId !== undefined && previewId !== statusPreviewId;
  const clean = previewId !== undefined && request.preview?.error_count === 0;
  const commitOutcome = status.data?.status;
  const commitFinished =
    commitOutcome === 'committed' ||
    commitOutcome === 'failed' ||
    status.isError ||
    status.timedOut;
  const commitActive =
    commit.isPending ||
    (previewId !== undefined && commit.data?.preview_id === previewId && !commitFinished);
  const showResult = (selection.file === undefined || commit.isSuccess) && !stale;
  const error =
    [preview, rows, commit, showResult ? status : undefined, template].find(
      (query) => query?.isError,
    )?.error ?? null;
  return (
    <>
      <CustomerImportFormCard
        templateReady={!template.isPending && !template.isError}
        onDownload={() =>
          template.data && downloadBase64(template.data.file_name, template.data.content_base64)
        }
        onSelect={select}
        canPreview={selection.file !== undefined && !preview.isPending && !commitActive}
        onInspect={() => {
          if (!selection.file) return;
          preview.mutate({ token: request.currentToken(), file: selection.file });
        }}
        canCommit={
          clean && !preview.isPending && !commitActive && commit.data?.preview_id !== previewId
        }
        onCommit={() => {
          if (!previewId) return;
          commit.mutate({ token: request.currentToken(), previewId });
        }}
      />
      <CustomerImportOutcome
        preview={request.preview}
        rows={request.rows}
        nextCursor={request.nextCursor}
        loadingMore={rows.isPending}
        onLoadMore={() => {
          if (!previewId || !request.nextCursor) return;
          rows.mutate({ token: request.currentToken(), previewId, cursor: request.nextCursor });
        }}
        accepted={commit.isSuccess && !stale}
        status={showResult ? status.data : undefined}
        timedOut={showResult && status.timedOut}
        error={error}
      />
    </>
  );
}
