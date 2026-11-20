import { t } from '@pospay/i18n';
import { THEME_BOOT_SCRIPT, THEME_COLOR_METAS } from '@pospay/ui/theme';
import { render, screen } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import RootLayout from '../app/layout';
import { RatingPage } from './ratings/pages/rating-page';

// بيئة jsdom المشتركة بين الاختبارات ما بتقيّمش عناصر script المُدرجة وقت التشغيل،
// فسكربت الإقلاع بينفّذ على جهاز jsdom مستقل بقواعد إدراج زي المتصفح.
type JSDOMDeviceWindow = {
  document: Document;
  close(): void;
  matchMedia: (query: string) => MediaQueryList;
  __pospayTheme?: object;
};

const { JSDOM } = await vi.importActual<{
  JSDOM: new (
    html: string,
    options?: { url?: string; pretendToBeVisual?: boolean; runScripts?: 'dangerously' },
  ) => { window: JSDOMDeviceWindow };
}>('jsdom');

const bootedDevices: { window: JSDOMDeviceWindow }[] = [];

afterEach(() => {
  for (const device of bootedDevices) device.window.close();
  bootedDevices.length = 0;
  vi.unstubAllEnvs();
  window.history.replaceState(null, '', '/');
});

function renderLayoutDocument() {
  const markup = renderToStaticMarkup(
    <RootLayout>
      <main>probe</main>
    </RootLayout>,
  );
  return new DOMParser().parseFromString(markup, 'text/html');
}

function bootLayoutScriptOnDevice(dark: boolean) {
  const device = new JSDOM('<!DOCTYPE html>', {
    url: 'http://localhost:3000',
    pretendToBeVisual: true,
    runScripts: 'dangerously',
  });
  bootedDevices.push(device);
  device.window.matchMedia = (query) => ({
    matches: dark,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  });
  const script = device.window.document.createElement('script');
  script.textContent = renderLayoutDocument().querySelector('head script')?.textContent ?? '';
  device.window.document.head.appendChild(script);
  return device;
}

it('renders the Arabic RTL document with the two theme-color metas and the boot script', () => {
  const parsed = renderLayoutDocument();
  expect(parsed.documentElement.getAttribute('lang')).toBe('ar');
  expect(parsed.documentElement.getAttribute('dir')).toBe('rtl');
  const metas = parsed.querySelectorAll('meta[name="theme-color"]');
  expect(metas).toHaveLength(THEME_COLOR_METAS.length);
  THEME_COLOR_METAS.forEach(({ media, content }, index) => {
    expect(metas[index]?.getAttribute('media')).toBe(media);
    expect(metas[index]?.getAttribute('content')).toBe(content);
  });
  const scripts = parsed.querySelectorAll('head script');
  expect(scripts).toHaveLength(1);
  expect(scripts[0]?.textContent).toBe(THEME_BOOT_SCRIPT);
});

it.each([
  ['dark', true],
  ['light', false],
] as const)('boots a %s device to the system scheme through the layout script', (_scheme, dark) => {
  const device = bootLayoutScriptOnDevice(dark);
  expect(device.window.__pospayTheme).toBeTypeOf('object');
  expect(device.window.document.documentElement.classList.contains('dark')).toBe(dark);
});

it('offers no theme control on the rating page', async () => {
  window.history.replaceState(null, '', '/#test-link');
  vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://api.example.test');
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ business_name: 'Test Salon', state: 'open' })),
  );
  render(<RatingPage />);
  await screen.findByRole('radio', { name: '5' });
  expect(document.querySelector('[aria-pressed]')).toBeNull();
  const buttonNames = screen.getAllByRole('button').map((button) => button.textContent);
  expect(buttonNames).toEqual([
    t('ar', 'publicRating.language'),
    t('ar', 'publicRating.submit'),
    t('ar', 'publicRating.optOut'),
  ]);
});
