import { describe, expect, it } from 'vitest';

import { renderOperationalEmail } from '../templates/email-operational.ts';
import { EmailLayoutError, renderEmailLayout } from '../templates/email-layout.ts';

const PROD = 'https://app.pospay.systems';
const STAGING = 'https://app.staging.pospay.systems';

function layout(overrides: Partial<Parameters<typeof renderEmailLayout>[0]> = {}) {
  return renderEmailLayout({
    locale: 'ar',
    adminOrigin: PROD,
    title: 'تنبيه',
    bodyHtml: '<p style="margin:0;">نص</p>',
    bodyText: 'نص',
    ...overrides,
  });
}

describe('renderEmailLayout direction and language', () => {
  it('sets the direction and the language from the locale', () => {
    expect(layout({ locale: 'ar' }).html).toContain('<html lang="ar" dir="rtl">');
    expect(layout({ locale: 'en' }).html).toContain('<html lang="en" dir="ltr">');
  });
});

describe('renderEmailLayout brand asset', () => {
  it.each([PROD, STAGING])('embeds the brand mark over https from %s', (adminOrigin) => {
    const { html } = layout({ adminOrigin });
    expect(html).toContain(`<img src="${adminOrigin}/brand/logo-mark-simple-tile.png"`);
    expect(html).not.toContain('attachments');
    expect(html).not.toContain('http://');
  });
});

describe('renderEmailLayout structure', () => {
  it('builds a table layout with inline styles only', () => {
    const { html } = layout();
    expect(html).toContain('<table role="presentation"');
    expect(html).toContain('background-color:#F7F1E8');
    expect(html).toContain('background-color:#FFFFFF');
    expect(html).toContain('color:#0D1522');
    expect(html).not.toContain('<style');
    expect(html).not.toContain('class="');
  });

  it('refuses an origin that is not a plain https origin', () => {
    for (const adminOrigin of [
      'http://app.pospay.systems',
      'https://app.pospay.systems/evil',
      'https://app.pospay.systems?x=1',
      'not-a-url',
    ])
      expect(() => layout({ adminOrigin })).toThrow(EmailLayoutError);
  });
  it('refuses an action URL whose origin differs from adminOrigin or uses a non-https scheme', () => {
    for (const url of [
      'javascript:alert(1)',
      'https://evil.test/phish',
      `${STAGING}/`,
      'not-a-url',
    ]) {
      expect(() =>
        layout({ adminOrigin: PROD, action: { label: 'افتح', url } }),
      ).toThrow(EmailLayoutError);
    }
  });
});

describe('renderEmailLayout escaping', () => {
  it('renders the action button with an escaped href and label', () => {
    const { html } = layout({
      action: { label: 'افتح & load', url: 'https://app.pospay.systems/?a=1&b=2' },
    });
    expect(html).toContain('href="https://app.pospay.systems/?a=1&amp;b=2"');
    expect(html).toContain('background-color:#FF6421');
    expect(html).toContain('افتح &amp; load');
    expect(html).not.toContain('?a=1&b=2');
  });

  it('escapes the title and the note in the html twin', () => {
    const { html } = layout({ title: 'ع <b>title</b>', footerNote: 'note & more' });
    expect(html).toContain('ع &lt;b&gt;title&lt;/b&gt;');
    expect(html).toContain('note &amp; more');
    expect(html).not.toContain('<b>title</b>');
  });
});

describe('renderEmailLayout plain-text twin', () => {
  it('keeps the plain text aligned with the html content', () => {
    const { text } = layout({
      title: 'عنوان',
      bodyText: 'جسم',
      action: { label: 'زر', url: 'https://app.pospay.systems/' },
    });
    expect(text).toContain('عنوان');
    expect(text).toContain('جسم');
    expect(text).toContain('زر');
    expect(text).toContain('https://app.pospay.systems/');
  });

  it('keeps the raw title and note in the plain text', () => {
    const { text } = layout({ title: 'ع <b>title</b>', footerNote: 'note & more' });
    expect(text).toContain('ع <b>title</b>');
    expect(text).toContain('note & more');
  });
});

describe('renderOperationalEmail', () => {
  it.each([
    ['ar', 'rtl'],
    ['en', 'ltr'],
  ] as const)('renders the operational email through the shared layout (%s)', (locale, dir) => {
    const content = renderOperationalEmail('document_expiring', 1, locale, [], PROD);
    expect(content).not.toBeNull();
    expect(content?.html).toContain(`<html lang="${locale}" dir="${dir}">`);
    expect(content?.html).toContain(`<img src="${PROD}/brand/logo-mark-simple-tile.png"`);
    expect(content?.html).toContain('<table role="presentation"');
    expect(content?.text).toContain('https://app.pospay.systems/');
  });

  it('refuses an origin that is not one of the two known admin origins', () => {
    expect(renderOperationalEmail('document_expiring', 1, 'ar', [], 'https://evil.test')).toBeNull();
  });
});
