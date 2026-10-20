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
 * إشارات الإيقاف بتوصل للوركر. Playwright لو قفل Chromium معاها، الوظيفة الجارية بتتقص قبل ما الطابور يخلّص.
 */
export const chromiumLaunchOptions: LaunchOptions = {
  chromiumSandbox: false,
  args: ['--disable-dev-shm-usage', '--disable-gpu'],
  handleSIGINT: false,
  handleSIGTERM: false,
  handleSIGHUP: false,
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
  return {
    route: async (pattern, handler) => {
      await context.route(pattern, (route) => handler(wrapRoute(route)));
    },
    newPage: async () => wrapPage(await context.newPage()),
    close: () => context.close(),
  };
}

type KillableProcess = { kill(signal: NodeJS.Signals): boolean };

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

function wrapBrowser(browser: Browser): PdfBrowser {
  return {
    newContext: async (options) => wrapContext(await browser.newContext(options)),
    close: () => browser.close(),
    kill: () => {
      chromiumProcess(browser)?.kill('SIGKILL');
    },
    on: (event, listener) => {
      browser.on(event, listener);
    },
  };
}

/** متصفح العملية. المسار بييجي من PLAYWRIGHT_BROWSERS_PATH ومن غير تنزيل وقت التشغيل. */
export function playwrightFactory(): PdfBrowserFactory {
  return {
    launch: async () => wrapBrowser(await chromium.launch(chromiumLaunchOptions)),
  };
}
