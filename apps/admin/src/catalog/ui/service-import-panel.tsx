'use client';
import { useServiceImport } from '../api/use-service-import';
import { ServiceImportFormCard } from './service-import-form-card';
import { ServiceImportOutcome } from './service-import-outcome';

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

type ServiceImportPanelProps = {
  companyId: string;
  businessId: string;
  userId: string;
};

/** لوحة استيراد الخدمات: تنزيل القالب، الرفع والمعاينة، ثم الحفظ عند خلو الأخطاء. */
export function ServiceImportPanel({ companyId, businessId, userId }: ServiceImportPanelProps) {
  const { template, preview, rows, commit, status, request, selection, select } = useServiceImport(
    companyId,
    businessId,
    userId,
  );
  const previewId = request.preview?.preview_id;
  const statusPreviewId = commit.data?.preview_id ?? selection.resumedPreviewId;
  const stale = previewId !== undefined && previewId !== statusPreviewId;
  const clean = previewId !== undefined && request.preview?.error_count === 0;
  const showResult = (selection.file === undefined || commit.isSuccess) && !stale;
  const error =
    [preview, rows, commit, showResult ? status : undefined, template].find((query) => query?.isError)
      ?.error ?? null;
  return (
    <>
      <ServiceImportFormCard
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
        canCommit={clean && !commit.isPending && commit.data?.preview_id !== previewId}
        onCommit={() => {
          if (!previewId) return;
          commit.mutate({ token: request.currentToken(), previewId });
        }}
      />
      <ServiceImportOutcome
        preview={request.preview}
        rows={request.rows}
        nextCursor={request.nextCursor}
        loadingMore={rows.isPending}
        onLoadMore={() => {
          if (!previewId || !request.nextCursor) return;
          rows.mutate({
            token: request.currentToken(),
            previewId,
            cursor: request.nextCursor,
          });
        }}
        accepted={commit.isSuccess && !stale}
        status={showResult ? status.data : undefined}
        timedOut={showResult && status.timedOut}
        error={error}
      />
    </>
  );
}
