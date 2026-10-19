// حد عقد الملفات العام (10 ميبي بايت). الشعار مش له سقف خاص؛ السيرفر يعيد الفحص من المحتوى.
const LOGO_TYPES = new Set(['image/png', 'image/jpeg']);
export const LOGO_MAX_BYTES = 10 * 1024 * 1024;

export function acceptableLogoFile(
  file: { type: string; size: number } | null | undefined,
): boolean {
  return file != null && LOGO_TYPES.has(file.type) && file.size > 0 && file.size <= LOGO_MAX_BYTES;
}

export function logoContentType(file: { type: string }): 'image/png' | 'image/jpeg' | null {
  if (file.type === 'image/png' || file.type === 'image/jpeg') return file.type;
  return null;
}
