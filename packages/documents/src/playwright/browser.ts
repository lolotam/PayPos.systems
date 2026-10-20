/** سطح ضيّق حوالين Playwright عشان اختبار الحياة يحقن متصفح وهمي من غير Chromium. */

export interface PdfRoute {
  request(): { url(): string };
  abort(): Promise<void>;
}

export interface PdfPage {
  setContent(html: string, options: { timeout: number; waitUntil: 'load' }): Promise<void>;
  pdf(options: {
    format: 'A4';
    printBackground: true;
    preferCSSPageSize: true;
  }): Promise<Uint8Array>;
  evaluate(expression: string): Promise<unknown>;
  outerHtml?(): Promise<string>;
  close(): Promise<void>;
}

export interface PdfContextOptions {
  readonly javaScriptEnabled: false;
  readonly offline: true;
  readonly serviceWorkers: 'block';
}

export interface PdfContext {
  route(pattern: string, handler: (route: PdfRoute) => Promise<void>): Promise<void>;
  newPage(): Promise<PdfPage>;
  close(): Promise<void>;
}

export interface PdfBrowser {
  newContext(options: PdfContextOptions): Promise<PdfContext>;
  close(): Promise<void>;
  on(event: 'disconnected', listener: () => void): void;
  /** البروتوكول المعلّق ما بيرجّعش close، فالقتل هو اللي يفضي المكان للإطلاق الجاي. */
  kill?(): void;
}

export interface PdfBrowserFactory {
  launch(): Promise<PdfBrowser>;
}
