import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { DirectionProvider } from '../direction-provider.js';
import { PageHeader } from '../page-header.js';
import { PageShell } from '../page-shell.js';

it('centres list pages on 1200px and forms on 840px, owning width and gaps only', () => {
  render(
    <PageShell layout="list" data-testid="list">
      <span>list body</span>
    </PageShell>,
  );
  const list = screen.getByTestId('list');
  expect(list.getAttribute('data-page-shell')).toBe('list');
  const classes = list.className.split(' ');
  expect(classes).toContain('mx-auto');
  expect(classes).toContain('max-w-[1200px]');
  expect(classes).toContain('gap-4');
  expect(classes).toContain('md:gap-6');
  // الحشوة ليست للكيت: لا حشوة صفحة هنا حتى لا تتحشر الصفحة مرتين مع إطارات 074-7
  expect(
    classes.some((name) => name === 'p-4' || name.startsWith('px-') || name.startsWith('py-')),
  ).toBe(false);
});

it('caps form pages at 840px', () => {
  render(
    <PageShell layout="form" data-testid="form">
      <span>form body</span>
    </PageShell>,
  );
  expect(screen.getByTestId('form').className).toContain('max-w-[840px]');
});

it('stacks the two-column template below 1024px with main first', () => {
  render(
    <PageShell
      layout="two-column"
      main={<p>names block</p>}
      side={<p>logo block</p>}
      data-testid="two-column"
    >
      <h2>identity header</h2>
    </PageShell>,
  );
  const header = screen.getByText('identity header');
  const names = screen.getByText('names block');
  const logo = screen.getByText('logo block');
  // من 1024px يصير حامل الأعمدة شبكة 2fr/1fr، وتحته يبقى التكديس الرئيسي أولًا
  const columns = names.parentElement?.parentElement as HTMLElement;
  expect(columns.className).toContain('lg:grid');
  expect(columns.className).toContain('lg:grid-cols-[2fr_1fr]');
  expect(columns.className).toContain('lg:items-start');
  // header ثم main ثم side في ترتيب الوثيقة نفسه في الاتجاهين
  expect(header.compareDocumentPosition(names) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(names.compareDocumentPosition(logo) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

it('keeps a lone block in the main column with no side column', () => {
  render(
    <PageShell layout="two-column" main={<p>logo alone</p>} data-testid="lone">
      <span>header</span>
    </PageShell>,
  );
  expect(screen.getByText('logo alone')).toBeTruthy();
  expect(screen.queryByText('side column')).toBeNull();
});

it('puts a lone side block first in the grid, so it takes the main column and not the narrow one', () => {
  // حالة هوية النشاط بلا كتلة أسماء: الشعار يبقى في خانته الثابتة، ومن غير خانة
  // رئيسية قبله يقع في أول عمود (2fr) بترتيب الشبكة.
  render(
    <PageShell layout="two-column" side={<p>logo alone in side slot</p>} data-testid="lone-side">
      <span>header</span>
    </PageShell>,
  );
  const columns = screen.getByText('logo alone in side slot').parentElement
    ?.parentElement as HTMLElement;
  expect(columns.className).toContain('lg:grid-cols-[2fr_1fr]');
  expect(columns.children).toHaveLength(1);
  expect(columns.firstElementChild?.textContent).toBe('logo alone in side slot');
});

it.each(['rtl', 'ltr'] as const)(
  'caps the page header description to 65 characters only inside the shell in %s',
  (dir) => {
    render(
      <DirectionProvider dir={dir}>
        <PageShell layout="list">
          <PageHeader title="Services" description="A one line description of the page" />
        </PageShell>
      </DirectionProvider>,
    );
    const description = screen.getByText('A one line description of the page');
    expect(description.hasAttribute('data-page-header-description')).toBe(true);
    const shell = description.closest('[data-page-shell]');
    expect(shell?.className).toContain('[&_[data-page-header-description]]:max-w-[65ch]');
    // سطر واحد بنقطة حذف تحت نفس محدِّد القالب نفسه
    expect(shell?.className).toContain('[&_[data-page-header-description]]:truncate');
  },
);

it('leaves the header description uncapped outside the shell', () => {
  render(
    <DirectionProvider dir="rtl">
      <PageHeader title="Legacy page" description="Keeps today's appearance" />
    </DirectionProvider>,
  );
  const description = screen.getByText("Keeps today's appearance");
  expect(description.hasAttribute('data-page-header-description')).toBe(true);
  expect(description.closest('[data-page-shell]')).toBeNull();
});
