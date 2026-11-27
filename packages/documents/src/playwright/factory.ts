import {
  chromium,
  type Browser,
  type BrowserContext,
  type LaunchOptions,
  type Page,
  type Route,
} from 'playwright-core';

import type { PdfBrowser, PdfBrowserFactory, PdfContext, PdfPage, PdfRoute } from './browser.ts';

/**
 * مهلة إطلاق Chromium على Playwright.
 * تفضل تحت حد الإطلاق الخارجي (40 s) عشان مهلة Playwright تقتل العملية قبل المهلة الخارجية.
 */
export const DEFAULT_CHROMIUM_LAUNCH_TIMEOUT_MS = 35_000;

/**
 * إشارات الإيقاف بتوصل للوركر. Playwright لو قفل Chromium معاها، الوظيفة الجارية بتتقص قبل ما الطابور يخلّص.
 */
export const chromiumLaunchOptions: LaunchOptions = {
  chromiumSandbox: false,
  args: ['--disable-dev-shm-usage', '--disable-gpu'],
  handleSIGINT: false,
  handleSIGTERM: false,
  handleSIGHUP: false,
  timeout: DEFAULT_CHROMIUM_LAUNCH_TIMEOUT_MS,
};

function wrapRoute(route: Route): PdfRoute {
  return {
    request: () => ({ url: () => route.request().url() }),
    abort: () => route.abort(),
  };
}

async function readOuterHtml(page: Page): Promise<string> {
  const session = await page.context().newCDPSession(page);
  try {
    const document = (await session.send('DOM.getDocument', { depth: 0 })) as {
      root: { nodeId: number };
    };
    const html = (await session.send('DOM.getOuterHTML', { nodeId: document.root.nodeId })) as {
      outerHTML: string;
    };
    return html.outerHTML;
  } finally {
    await session.detach();
  }
}

function wrapPage(page: Page): PdfPage {
  return {
    setContent: (html, options) => page.setContent(html, options),
    pdf: async (options) => new Uint8Array(await page.pdf(options)),
    evaluate: (expression) => page.evaluate(expression),
    outerHtml: () => readOuterHtml(page),
    close: () => page.close(),
  };
}

function wrapContext(context: BrowserContext): PdfContext {
  let closed: Promise<void> | undefined;
  return {
    route: async (pattern, handler) => {
      await context.route(pattern, (route) => handler(wrapRoute(route)));
    },
    newPage: async () => wrapPage(await context.newPage()),
    close: () => (closed ??= context.close()),
  };
}

export type KillableProcess = {
  kill(signal: NodeJS.Signals): boolean;
  readonly exitCode?: number | null;
  readonly signalCode?: string | null;
  once?(event: 'exit', listener: () => void): unknown;
  off?(event: 'exit', listener: () => void): unknown;
};

/**
 * Playwright 1.63 شال Browser.process() من الواجهة العامة.
 * عملية Chromium لسه على اتصال الإطلاق المحلي، و SIGKILL هو اللي يفك البروتوكول المعلّق.
 */
function chromiumProcess(browser: Browser): KillableProcess | null {
  const published = browser as Browser & { process?: () => KillableProcess | null };
  if (typeof published.process === 'function') return published.process() ?? null;
  const owned = browser as unknown as {
    _connection?: {
      toImpl?: (owner: Browser) => {
        options?: { browserProcess?: { process?: KillableProcess | null } };
      };
    };
  };
  try {
    return owned._connection?.toImpl?.(browser)?.options?.browserProcess?.process ?? null;
  } catch {
    return null;
  }
}

function hasExited(proc: KillableProcess): boolean {
  return (
    (proc.exitCode !== undefined && proc.exitCode !== null) ||
    (proc.signalCode !== undefined && proc.signalCode !== null)
  );
}

/**
 * يقتل عملية Chromium ويستنّى تأكيد الخروج الحقيقي (`exit` أو `ESRCH`) من غير مهلة مزيفة.
 * التقاعد والإغلاق هما اللي بيحدّدوا سقف الانتظار، عشان إعادة الإطلاق ما تفتحش متصفحين مع بعض.
 */
export function killAndWait(proc: KillableProcess | null): Promise<void> | void {
  if (proc === null) return Promise.reject(new Error('CHROMIUM_PROCESS_UNAVAILABLE'));
  if (hasExited(proc)) return Promise.resolve();
  const once = proc.once;
  if (typeof once !== 'function') {
    const signaled = proc.kill('SIGKILL');
    if (signaled || hasExited(proc)) return;
    throw new Error('SIGKILL_REJECTED');
  }
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      proc.off?.('exit', finish);
      resolve();
    };
    const fail = (error: unknown): void => {
      if (settled) return;
      settled = true;
      proc.off?.('exit', finish);
      reject(error instanceof Error ? error : new Error('SIGKILL_FAILED'));
    };
    once.call(proc, 'exit', finish);
    if (hasExited(proc)) {
      finish();
      return;
    }
    try {
      const signaled = proc.kill('SIGKILL');
      if (hasExited(proc)) {
        finish();
      } else if (!signaled) {
        fail(new Error('SIGKILL_REJECTED'));
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | null)?.code;
      if (code === 'ESRCH' || hasExited(proc)) {
        finish();
      } else {
        fail(error);
      }
    }
  });
}

function wrapBrowser(browser: Browser): PdfBrowser {
  const launchedProc = chromiumProcess(browser);
  let disconnected = false;
  browser.on('disconnected', () => {
    disconnected = true;
  });
  return {
    newContext: async (options) => wrapContext(await browser.newContext(options)),
    close: () => browser.close(),
    kill: () => {
      if (disconnected) return Promise.resolve();
      return killAndWait(launchedProc ?? chromiumProcess(browser));
    },
    on: (event, listener) => {
      browser.on(event, listener);
    },
  };
}

/**
 * متصفح العملية. المسار بييجي من PLAYWRIGHT_BROWSERS_PATH ومن غير تنزيل وقت التشغيل.
 *
 * @param timeoutMs مهلة إطلاق Chromium بالميلي ثانية
 * @returns مصنع متصفح بيحترم المهلة
 */
export function playwrightFactory(
  timeoutMs = DEFAULT_CHROMIUM_LAUNCH_TIMEOUT_MS,
): PdfBrowserFactory {
  return {
    launch: async (signal?: AbortSignal) => {
      const wrapped = wrapBrowser(
        await chromium.launch({ ...chromiumLaunchOptions, timeout: timeoutMs }),
      );
      if (signal?.aborted) {
        await Promise.resolve(wrapped.kill?.()).catch(() => undefined);
        throw new Error('DOCUMENT_LAUNCH_ABORTED');
      }
      return wrapped;
    },
  };
}
