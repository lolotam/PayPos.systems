import type { PdfBrowserFactory } from './browser.ts';

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
  /** لقطة DOM بعد التحميل. للاختبار؛ مش بتتسجل. */
  readonly onDocumentHtml?: (outerHtml: string) => void;
}
