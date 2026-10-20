export interface RendererFailureText {
  readonly error_class: string;
  readonly error_message: string;
}

const URL_OR_DATA = /\b(?:[a-z][a-z0-9+.-]*:\/\/\S+|data:[^\s"'<>]*)/gi;
const WINDOWS_PATH = /\b[A-Za-z]:\\[^\s"'<>]*/g;
const UNIX_PATH = /\/(?:[\w.+@=-]+\/)+[\w.+@=-]*/g;
const HTML_TAG = /<[^>\n]*>/g;

/**
 * بياخد أول سطر من سبب الفشل بعد ما يشيل المسارات والعناوين وHTML.
 * السجل محتاج اسم الخطأ عشان مكتبة ناقصة أو /dev/shm تتفهم، من غير مسار المتصفح ولا الصفحة.
 *
 * @param error الخطأ الخام من Chromium أو الطابور
 * @returns اسم الصنف وأول سطر متنضّف
 */
export function rendererFailureText(error: unknown): RendererFailureText {
  const errorClass = error instanceof Error && error.name !== '' ? error.name : 'Error';
  const raw = error instanceof Error ? error.message : '';
  const first = raw.split(/\r?\n/, 1)[0] ?? '';
  const errorMessage = first
    .replace(URL_OR_DATA, '')
    .replace(WINDOWS_PATH, '')
    .replace(UNIX_PATH, '')
    .replace(HTML_TAG, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
  return { error_class: errorClass, error_message: errorMessage };
}
