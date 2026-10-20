import {
  DocumentRenderTimeoutError,
  DocumentRendererUnavailableError,
  DocumentTooLargeError,
} from './errors.ts';

export interface RendererFailureText {
  readonly error_class:
    | 'TimeoutError'
    | 'TypeError'
    | 'RangeError'
    | 'DocumentRenderTimeoutError'
    | 'DocumentTooLargeError'
    | 'DocumentRendererUnavailableError'
    | 'DocumentKindUnknownError'
    | 'MISSING_EXECUTABLE'
    | 'MISSING_LIBRARY'
    | 'OTHER';
}

type FailureClass = RendererFailureText['error_class'];

const NAMED_CLASS = new Map<string, FailureClass>([
  ['TimeoutError', 'TimeoutError'],
  ['DocumentKindUnknownError', 'DocumentKindUnknownError'],
]);

const MISSING_EXECUTABLE = "Executable doesn't exist";
const MISSING_LIBRARY_PACKAGES = 'missing dependencies to run browsers';
const MISSING_SHARED_LIBRARY = 'error while loading shared libraries';

function builtinClass(error: Error): FailureClass | undefined {
  if (error instanceof DocumentRenderTimeoutError) return 'DocumentRenderTimeoutError';
  if (error instanceof DocumentTooLargeError) return 'DocumentTooLargeError';
  if (error instanceof DocumentRendererUnavailableError) return 'DocumentRendererUnavailableError';
  if (error instanceof TypeError) return 'TypeError';
  if (error instanceof RangeError) return 'RangeError';
  return NAMED_CLASS.get(error.name);
}

function launchClass(message: string): FailureClass | undefined {
  if (message.includes(MISSING_EXECUTABLE)) return 'MISSING_EXECUTABLE';
  if (message.includes(MISSING_LIBRARY_PACKAGES) || message.includes(MISSING_SHARED_LIBRARY)) {
    return 'MISSING_LIBRARY';
  }
  return undefined;
}

/**
 * بيحوّل فشل الرندر لرمز من قائمة ثابتة.
 * الاسم والنص ممكن يحملوا اسم موظف أو قيمة حضور أو نص المستند، فالسجل ما ياخدش غير الرمز.
 *
 * @param error الخطأ الخام من Chromium أو المصدر أو الطابور
 * @returns رمز الصنف المسموح، أو OTHER
 */
export function rendererFailureText(error: unknown): RendererFailureText {
  if (!(error instanceof Error)) return { error_class: 'OTHER' };
  const errorClass = builtinClass(error) ?? launchClass(error.message) ?? 'OTHER';
  return { error_class: errorClass };
}
