// نفس قائمة files وحدها (قرار المالك 2026-10-03)؛ السيرفر يعيد الفحص من المحتوى، وهذا تنبيه مبكر فقط.
const ALLOWED = new Set(['application/pdf', 'image/jpeg', 'image/png']);
export const DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;

export function acceptableDocumentFile(file: File | null | undefined): file is File {
  return (
    file !== null &&
    file !== undefined &&
    ALLOWED.has(file.type) &&
    file.size > 0 &&
    file.size <= DOCUMENT_MAX_BYTES
  );
}
