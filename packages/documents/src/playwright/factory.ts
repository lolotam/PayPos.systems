import {
  chromium,
  type Browser,
  type BrowserContext,
  type LaunchOptions,
  type Page,
  type Route,
} from 'playwright-core';

import type { PdfBrowser, PdfBrowserFactory, PdfContext, PdfPage, PdfRoute } from './browser.ts';
import {
  beginLaunchProcessCapture,
  getLaunchCleanup,
  killProcessTree,
  LAUNCH_MARKER_ENV,
  takeLaunchedProcess,
  withLaunchCleanup,
  type KillableProcess,
} from './process-tree.ts';

export { getLaunchCleanup, withLaunchCleanup, type KillableProcess };

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

/**
 * يقتل عملية Chromium وشجرة توابعها ويستنّى تأكيد الخروج الحقيقي (`exit` أو `ESRCH`) من غير مهلة مزيفة.
 * التقاعد والإغلاق هما اللي بيحدّدوا سقف الانتظار، عشان إعادة الإطلاق ما تفتحش متصفحين مع بعض.
 */
export function killAndWait(proc: KillableProcess | null): Promise<void> | void {
  if (proc === null) return Promise.reject(new Error('CHROMIUM_PROCESS_UNAVAILABLE'));
  return killProcessTree(proc);
}

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

function wrapBrowser(browser: Browser, capturedProc: KillableProcess | null = null): PdfBrowser {
  const launchedProc = capturedProc ?? chromiumProcess(browser);
  return {
    newContext: async (options) => wrapContext(await browser.newContext(options)),
    close: () => browser.close(),
    kill: () => killAndWait(launchedProc ?? chromiumProcess(browser)),
    on: (event, listener) => {
      browser.on(event, listener);
    },
  };
}

let launchSequence = 0;

function launchEnvWithMarker(launchMarker: string): Record<string, string> {
  const base = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
  base[LAUNCH_MARKER_ENV] = launchMarker;
  return base;
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
    launch: async () => {
      launchSequence += 1;
      const launchMarker = [process.pid, Date.now(), launchSequence].join(':');
      beginLaunchProcessCapture(launchMarker);
      try {
        const browser = await chromium.launch({
          ...chromiumLaunchOptions,
          timeout: timeoutMs,
          env: launchEnvWithMarker(launchMarker),
        });
        return wrapBrowser(browser, takeLaunchedProcess(launchMarker));
      } catch (error) {
        const captured = takeLaunchedProcess(launchMarker);
        if (getLaunchCleanup(error) !== undefined || captured === null) throw error;
        const retryKill = (): Promise<void> | void => killProcessTree(captured);
        const cleanup = retryKill();
        if (cleanup === undefined) throw error;
        throw withLaunchCleanup(error, cleanup, retryKill);
      }
    },
  };
}
