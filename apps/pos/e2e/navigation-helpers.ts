import { expect, type Locator, type Page } from '@playwright/test';

// Shared labels and geometry assertions for the CI-only navigation component fixture.

export type Direction = 'rtl' | 'ltr';
export type Box = { x: number; width: number };

export const VIEWPORTS = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'tablet', width: 820, height: 1180 },
  { name: 'desktop', width: 1280, height: 900 },
] as const;

export const DIRECTIONS: readonly Direction[] = ['rtl', 'ltr'];

export const LABELS = {
  navigation: 'التنقل',
  openMenu: 'افتح القائمة',
  close: 'إغلاق',
  collapse: 'طي الشريط الجانبي',
  drawerOpen: 'افتح التنقل',
  drawerTitle: 'الوحدات',
  current: 'الحالي',
  panelNavigation: 'أقسام مساحة العمل',
  panelClose: 'إغلاق اللوحة',
  finderTrigger: 'ابحث عن صفحة',
  finderSearch: 'ابحث في الصفحات',
  finderEmpty: 'لا توجد نتائج',
  business: 'الأعمال والإعدادات',
  people: 'الموظفون والفرق',
  columns: 'الأعمدة والتنسيقات المتقدمة',
  employees: 'قائمة الموظفين النشطة',
  stock: 'المخزون وأصناف المنتجات',
  stockPage: 'أصناف المخزون المتاحة',
  outsideField: 'حقل خارجي',
  headerAction: 'إجراء الرأس',
  footerAction: 'إجراء التذييل',
} as const;

export async function openScene(page: Page, scene: string, dir: Direction, extraQuery = ''): Promise<void> {
  await page.goto(`/?dir=${dir}&scene=${scene}${extraQuery}`);
  await expect(page.locator('[data-fixture-ready="true"]')).toBeVisible();
}

export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const m = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(m.scrollWidth, `overflow: scroll=${m.scrollWidth} client=${m.clientWidth}`).toBeLessThanOrEqual(m.clientWidth);
}

export function expectAtInlineStart(box: Box, dir: Direction, viewportWidth: number): void {
  const edge = dir === 'rtl' ? viewportWidth - (box.x + box.width) : box.x;
  expect(Math.abs(edge), `${dir} inline-start edge`).toBeLessThanOrEqual(2);
}

export async function requiredBox(target: Locator) {
  const box = await target.boundingBox();
  if (!box) throw new Error('expected the visible target to have a real bounding box');
  return box;
}

export async function expectMinTarget(target: Locator, min = 44): Promise<void> {
  const box = await requiredBox(target);
  expect(box.width, 'target width').toBeGreaterThanOrEqual(min);
  expect(box.height, 'target height').toBeGreaterThanOrEqual(min);
}

export async function expectVisibleCurrentMarker(target: Locator): Promise<void> {
  await expect(target).toHaveAttribute('aria-current', 'page');
  await expect(target.locator('[data-current-marker]')).toBeVisible();
  const decoration = await target.evaluate((el) => getComputedStyle(el).textDecorationLine);
  expect(decoration, 'current item must be visibly marked').toContain('underline');
}

export async function expectVisibleCurrentModuleSwitcher(target: Locator): Promise<void> {
  await expect(target).toHaveAttribute('aria-current', 'page');
  await expect(target.locator('[data-current-marker]')).toBeVisible();
  const background = await target.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(background, 'current module must keep a visible background').not.toBe('rgba(0, 0, 0, 0)');
}

export async function expectVisibleNavRailCurrentMarker(target: Locator): Promise<void> {
  await expect(target).toHaveAttribute('data-current', '');
  await expect(target.locator('[data-current-marker]')).toBeVisible();
  const decoration = await target.evaluate((el) => getComputedStyle(el).textDecorationLine);
  expect(decoration, 'current workspace must be visibly marked in the rail').toContain('underline');
}

// الـ tap بيودّي التركيز للـ body بعد pointerup. نفي "التركيز رجع للتنقل" مش بيتأكد بالانتظار لوحده،
// فبنعدّ كل focusin على زر الدرج من قبل تصغير الشاشة: أي سحب للتركيز، حتى لو لحظي، بيتسجّل.
// ظهور الزر بييجي من CSS مش من React، فبنستنى علامة data-settled-layout اللي TopNav بيكتبها بعد قرار التركيز.
export async function expectTapAwayKeepsFocusOut(page: Page, trigger: Locator): Promise<void> {
  await trigger.focus();
  await expect(trigger).toBeFocused();
  // لازم نثبت إن التركيز لسه على الزر وقت pointerup، وإلا الاختبار ينجح من غير فحص click.
  await trigger.evaluate((el) => {
    const snapshot = () => {
      document.documentElement.dataset['focusAtPointerUp'] = String(document.activeElement === el);
    };
    window.addEventListener('pointerup', snapshot, { capture: true, once: true });
  });
  await page.locator('main h1').tap();
  await expect(page.locator('html')).toHaveAttribute('data-focus-at-pointer-up', 'true');
  await expect(page.locator('body')).toBeFocused();
  await page.evaluate((openerName) => {
    const root = document.documentElement;
    root.dataset['openerFocusCount'] = '0';
    document.addEventListener(
      'focusin',
      (event) => {
        const target = event.target instanceof HTMLElement ? event.target : null;
        if (target?.getAttribute('aria-label') !== openerName) return;
        root.dataset['openerFocusCount'] = String(Number(root.dataset['openerFocusCount']) + 1);
      },
      true,
    );
  }, LABELS.drawerOpen);
  await page.setViewportSize({ width: 390, height: 844 });
  const drawerOpener = page.getByRole('button', { name: LABELS.drawerOpen });
  await expect(drawerOpener).toBeVisible();
  await expect(page.locator('[data-settled-layout="phone"]')).toBeAttached();
  await expect(page.locator('body')).toBeFocused();
  await expect(page.locator('html')).toHaveAttribute('data-opener-focus-count', '0');

  // فحص الضبط الإيجابي (#1207): العودة لعرض التابلت ثم تركيز الزر والتصغير مجددًا مع
  // انتظار العلامة بين الخطوات يثبت أن نقل التركيز يعمل حين يكون التركيز على التنقل فعلًا.
  await page.setViewportSize({ width: 820, height: 900 });
  await expect(page.locator('[data-settled-layout="tablet"]')).toBeAttached();
  await trigger.focus();
  await expect(trigger).toBeFocused();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(drawerOpener).toBeVisible();
  await expect(page.locator('[data-settled-layout="phone"]')).toBeAttached();
  await expect(drawerOpener).toBeFocused();
}
