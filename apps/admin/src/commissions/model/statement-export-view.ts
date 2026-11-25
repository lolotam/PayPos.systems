import type { DocumentRenderState } from '@pospay/contracts';
import { t, type Locale } from '@pospay/i18n';
import { exportExpired, exportFailureText } from './statement-export-display';

/** الأزرار اللي بتفضل للمستخدم بعد فشل: يبدأ من تاني، أو يطلب تصدير جديد، أو يتأكد تاني، أو يعيد التحميل. */
export type ExportRecovery = 'start' | 'new' | 'check' | 'download';

/** اللي الحوار بيعرضه في كل لحظة؛ الأكواد الخام ما بتوصلش هنا أبدًا، النص جاهز. */
export type ExportView =
  | { kind: 'idle' }
  | { kind: 'waiting' }
  | { kind: 'timeout' }
  | { kind: 'ready' }
  | { kind: 'downloaded' }
  | { kind: 'failed'; text: string; recovery: ExportRecovery };

/** مدخلات الحوار اللي بتحدد العرض: الطلب والتابع والتحميل. */
export interface ExportViewInput {
  renderId: string | undefined;
  requestPending: boolean;
  requestError: unknown;
  state: DocumentRenderState | undefined;
  renderErrorCode: string | undefined;
  statusError: unknown;
  timedOut: boolean;
  downloadError: unknown;
  collected: boolean;
}

function failed(error: unknown, locale: Locale, recovery: ExportRecovery): ExportView {
  return { kind: 'failed', text: exportFailureText(error, locale), recovery };
}

function terminalFailure(input: ExportViewInput, locale: Locale): ExportView | null {
  if (input.state === 'FAILED') {
    return failed({ code: input.renderErrorCode }, locale, 'new');
  }
  if (input.state === 'EXPIRED') {
    return {
      kind: 'failed',
      text: t(locale, 'commissionStatementScreen.exportExpired'),
      recovery: 'new',
    };
  }
  if (input.state === 'CONSUMED') {
    return {
      kind: 'failed',
      text: t(locale, 'commissionStatementScreen.exportConsumed'),
      recovery: 'new',
    };
  }
  return null;
}

/**
 * يحدد عرض الحوار من حالة الطلب والمتابعة والتحميل. الترتيب مهم: الملف اللي اتحمّل بيغلب أي حاجة،
 * وفشل الطلب بيرجّع لزرار البدء، وفشل التحميل المؤقت بيسيب إعادة المحاولة، والانتهاء بيطلب تصدير جديد.
 *
 * @param input حالة الطلب والمتابعة والتحميل
 * @param locale لغة الشاشة
 * @returns العرض الجاهز للحوار
 */
export function exportView(input: ExportViewInput, locale: Locale): ExportView {
  if (input.collected) return { kind: 'downloaded' };
  if (input.requestError) return failed(input.requestError, locale, 'start');
  if (input.renderId === undefined) return { kind: input.requestPending ? 'waiting' : 'idle' };
  if (input.downloadError) {
    return failed(
      input.downloadError,
      locale,
      exportExpired(input.downloadError) ? 'new' : 'download',
    );
  }
  if (input.statusError) {
    return failed(input.statusError, locale, exportExpired(input.statusError) ? 'new' : 'check');
  }
  const terminal = terminalFailure(input, locale);
  if (terminal !== null) return terminal;
  if (input.state === 'READY') return { kind: 'ready' };
  return { kind: input.timedOut ? 'timeout' : 'waiting' };
}
