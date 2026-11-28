import type { PdfBrowserFactory } from './browser.ts';
import { DEFAULT_CHROMIUM_LAUNCH_TIMEOUT_MS, playwrightFactory } from './factory.ts';

/**
 * إعدادات محوّل المستند: مصنع المتصفح، والنوم المحقون، وكل سقف زمني.
 * الافتراضيات في `PlaywrightDocumentRenderer`؛ القيم اللي بتتغير في الاختبار بتتقفل هنا.
 */
export interface RendererOptions {
  readonly factory?: PdfBrowserFactory;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly backoffMs?: readonly number[];
  readonly contentTimeoutMs?: number;
  readonly pdfTimeoutMs?: number;
  readonly overallTimeoutMs?: number;
  readonly browserCloseGraceMs?: number;
  /** انتظار browser.close في الإغلاق المتعمد. بعد المهلة، أو لو close رفض أو رمى، بنحاول نقتل Chromium (browser.kill لو موجودة). */
  readonly closeGraceMs?: number;
  /** مهلة إطلاق Chromium. الإطلاق المعلّق بيتحسب فشل وبعده بتتأجل إعادة المحاولة. */
  readonly launchTimeoutMs?: number;
  /** التأخير بيرجع لأول درجة بعد ما المتصفح يفضل قائم المدة دي. */
  readonly stableForMs?: number;
  readonly onLaunchError?: (error: unknown) => void;
  /** مهلة تأكيد خروج العملية بعد مهلة الإطلاق أو التقاعد، وبعدها بنصعّد لإعادة تشغيل العامل. */
  readonly unconfirmedExitTimeoutMs?: number;
  readonly onUnconfirmedExit?: (error: Error) => void;
  /** لقطة DOM بعد التحميل. للاختبار؛ مش بتتسجل. */
  readonly onDocumentHtml?: (outerHtml: string) => void;
}

export interface ResolvedRendererConfig {
  readonly factory: PdfBrowserFactory;
  readonly sleep: (ms: number) => Promise<void>;
  readonly backoff: readonly number[];
  readonly contentTimeoutMs: number;
  readonly pdfTimeoutMs: number;
  readonly overallTimeoutMs: number;
  readonly browserCloseGraceMs: number;
  readonly closeGraceMs: number;
  readonly launchTimeoutMs: number;
  readonly stableForMs: number;
  readonly unconfirmedExitTimeoutMs: number;
  readonly onLaunchError: ((error: unknown) => void) | undefined;
  readonly onUnconfirmedExit: ((error: Error) => void) | undefined;
  readonly onDocumentHtml: ((outerHtml: string) => void) | undefined;
}

const DEFAULT_BACKOFF_MS = [250, 500, 1000, 2000, 5000] as const;
const CLOSE_GRACE_MS = 5_000;
const LAUNCH_TIMEOUT_MS = 40_000;
const UNCONFIRMED_EXIT_TIMEOUT_MS = 10_000;
const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** يجمع افتراضيات محوّل المستند في سجل جاهز للتنفيذ. */
export function resolveRendererConfig(options: RendererOptions = {}): ResolvedRendererConfig {
  const launchTimeoutMs = options.launchTimeoutMs ?? LAUNCH_TIMEOUT_MS;
  const browserCloseGraceMs = options.browserCloseGraceMs ?? 1_000;
  const margin = Math.min(browserCloseGraceMs, Math.floor(launchTimeoutMs / 2));
  const playwrightTimeoutMs = launchTimeoutMs === LAUNCH_TIMEOUT_MS
    ? DEFAULT_CHROMIUM_LAUNCH_TIMEOUT_MS
    : Math.max(1, launchTimeoutMs - margin);
  return {
    factory: options.factory ?? playwrightFactory(playwrightTimeoutMs),
    sleep: options.sleep ?? delay,
    backoff: options.backoffMs ?? DEFAULT_BACKOFF_MS,
    contentTimeoutMs: options.contentTimeoutMs ?? 10_000,
    pdfTimeoutMs: options.pdfTimeoutMs ?? 20_000,
    overallTimeoutMs: options.overallTimeoutMs ?? 30_000,
    browserCloseGraceMs,
    closeGraceMs: options.closeGraceMs ?? CLOSE_GRACE_MS,
    launchTimeoutMs,
    stableForMs: options.stableForMs ?? 30_000,
    unconfirmedExitTimeoutMs: options.unconfirmedExitTimeoutMs ?? UNCONFIRMED_EXIT_TIMEOUT_MS,
    onLaunchError: options.onLaunchError,
    onUnconfirmedExit: options.onUnconfirmedExit,
    onDocumentHtml: options.onDocumentHtml,
  };
}
