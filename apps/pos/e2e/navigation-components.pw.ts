import { expect, test, type Locator, type Page } from '@playwright/test';

// CI-only component fixture: no dashboard route, adapter or deployment is involved.
// It mounts the reusable navigation components with long Arabic labels and
// measures real browser geometry at the three required widths in both directions.

type Direction = 'rtl' | 'ltr';
type Box = { x: number; width: number };

const VIEWPORTS = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'tablet', width: 820, height: 1180 },
  { name: 'desktop', width: 1280, height: 900 },
] as const;

const DIRECTIONS: readonly Direction[] = ['rtl', 'ltr'];

const LABELS = {
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

async function openScene(
  page: Page,
  scene: string,
  dir: Direction,
  extraQuery = '',
): Promise<void> {
  await page.goto(`/?dir=${dir}&scene=${scene}${extraQuery}`);
  await expect(page.locator('[data-fixture-ready="true"]')).toBeVisible();
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(
    metrics.scrollWidth,
    `horizontal document overflow: scroll=${metrics.scrollWidth} client=${metrics.clientWidth}`,
  ).toBeLessThanOrEqual(metrics.clientWidth);
}

function expectAtInlineStart(box: Box, dir: Direction, viewportWidth: number): void {
  const edge = dir === 'rtl' ? viewportWidth - (box.x + box.width) : box.x;
  expect(Math.abs(edge), `${dir} inline-start edge`).toBeLessThanOrEqual(2);
}

async function requiredBox(target: Locator) {
  const box = await target.boundingBox();
  if (!box) throw new Error('expected the visible target to have a real bounding box');
  return box;
}

async function expectMinTarget(target: Locator, min = 44): Promise<void> {
  const box = await requiredBox(target);
  expect(box.width, 'target width').toBeGreaterThanOrEqual(min);
  expect(box.height, 'target height').toBeGreaterThanOrEqual(min);
}

async function expectVisibleCurrentMarker(target: Locator): Promise<void> {
  await expect(target).toHaveAttribute('aria-current', 'page');
  await expect(target.locator('[data-current-marker]')).toBeVisible();
  const decoration = await target.evaluate((element) => getComputedStyle(element).textDecorationLine);
  expect(decoration, 'current item must be visibly marked, not only aria-current or sr-only').toContain(
    'underline',
  );
}

async function expectVisibleCurrentModuleSwitcher(target: Locator): Promise<void> {
  await expect(target).toHaveAttribute('aria-current', 'page');
  await expect(target.locator('[data-current-marker]')).toBeVisible();
  const background = await target.evaluate(
    (element) => getComputedStyle(element).backgroundColor,
  );
  expect(background, 'current module must keep a visible background').not.toBe('rgba(0, 0, 0, 0)');
}

async function expectVisibleNavRailCurrentMarker(target: Locator): Promise<void> {
  await expect(target).toHaveAttribute('data-current', '');
  await expect(target.locator('[data-current-marker]')).toBeVisible();
  const decoration = await target.evaluate((element) => getComputedStyle(element).textDecorationLine);
  expect(decoration, 'current workspace must be visibly marked in the rail').toContain('underline');
}

for (const viewport of VIEWPORTS) {
  for (const dir of DIRECTIONS) {
    test(`geometry: no horizontal overflow and inline-start placement at ${viewport.name} ${dir}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });

      await openScene(page, 'top', dir);
      await expectNoHorizontalOverflow(page);

      if (viewport.width >= 700) {
        const currentTrigger = page.getByRole('button', { name: LABELS.business }).first();
        await expect(currentTrigger).toBeVisible();
        await expectMinTarget(currentTrigger);
        await expectVisibleCurrentMarker(currentTrigger);
        const box = await requiredBox(currentTrigger);
        expect(box.x, 'trigger must stay inside the viewport').toBeGreaterThanOrEqual(-1);
        expect(box.x + box.width, 'trigger must stay inside the viewport').toBeLessThanOrEqual(
          viewport.width + 1,
        );
      } else {
        const opener = page.getByRole('button', { name: LABELS.drawerOpen });
        await expect(opener).toBeVisible();
        await expectMinTarget(opener);
        await opener.click();
        const drawer = page.getByRole('dialog', { name: LABELS.drawerTitle });
        await expect(drawer).toBeVisible();
        const box = await requiredBox(drawer);
        expect(box.width, 'drawer stays within 304px').toBeLessThanOrEqual(305);
        expectAtInlineStart(box, dir, viewport.width);
        await expectNoHorizontalOverflow(page);
        await page.keyboard.press('Escape');
        await expect(drawer).toBeHidden();
      }

      await openScene(page, 'context', dir);
      await expectNoHorizontalOverflow(page);
      const rail = page.getByRole('navigation', { name: LABELS.navigation });
      await expect(rail).toBeVisible();
      const railBox = await requiredBox(rail);
      expect(railBox.width, 'rail width').toBeGreaterThanOrEqual(44);
      expectAtInlineStart(railBox, dir, viewport.width);
      const currentWorkspace = rail.getByRole('button', { name: LABELS.business }).first();
      await expectMinTarget(currentWorkspace);
      await expectVisibleNavRailCurrentMarker(currentWorkspace);
      await expectNoHorizontalOverflow(page);

      if (viewport.width >= 600) {
        await openScene(page, 'sidebar', dir);
        await expectNoHorizontalOverflow(page);
        const aside = page.locator('aside').first();
        await expect(aside).toBeVisible();
        const asideBox = await requiredBox(aside);
        expectAtInlineStart(asideBox, dir, viewport.width);
        const expectedWidth = viewport.width >= 1024 ? 264 : 80;
        expect(asideBox.width, 'A sidebar width').toBeGreaterThanOrEqual(expectedWidth - 2);
        expect(asideBox.width, 'A sidebar width').toBeLessThanOrEqual(expectedWidth + 2);
        const firstLink = aside.locator('nav a[href]').first();
        await expectMinTarget(firstLink, viewport.width >= 1024 ? 48 : 60);
        await expectNoHorizontalOverflow(page);
      }
    });
  }
}

for (const dir of DIRECTIONS) {
  test(`B phone drawer switches module, navigates and restores focus (${dir})`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openScene(page, 'top', dir);
    const opener = page.getByRole('button', { name: LABELS.drawerOpen });
    await opener.focus();
    await opener.click();
    const drawer = page.getByRole('dialog', { name: LABELS.drawerTitle });
    await expect(drawer).toBeVisible();

    const current = drawer.getByRole('button', { name: LABELS.business });
    await expect(current).toHaveAttribute('aria-expanded', 'true');
    await expect(drawer.getByRole('link', { name: LABELS.columns })).toBeVisible();

    const people = drawer.getByRole('button', { name: LABELS.people });
    await expectMinTarget(people);
    await people.click();
    const destination = drawer.getByRole('link', { name: LABELS.employees });
    await expect(destination).toBeVisible();
    await destination.click();
    await expect(drawer).toBeHidden();
    await expect(page.locator('body')).toHaveAttribute('data-navigated', 'true');
    await expect(opener).toBeFocused();
  });

  test(`B phone drawer Escape and short-viewport scroll (${dir})`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openScene(page, 'top', dir);
    const opener = page.getByRole('button', { name: LABELS.drawerOpen });
    await opener.focus();
    await opener.click();
    const drawer = page.getByRole('dialog', { name: LABELS.drawerTitle });
    await expect(drawer).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
    await expect(opener).toBeFocused();
    await expect(page.locator('body')).not.toHaveAttribute('data-navigated', 'true');

    await page.setViewportSize({ width: 390, height: 300 });
    await opener.click();
    await expect(drawer).toBeVisible();
    const metrics = await drawer.evaluate((element) => ({
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
    }));
    expect(metrics.scrollHeight, 'drawer content must scroll in a short viewport').toBeGreaterThan(
      metrics.clientHeight,
    );
    const lastModule = drawer.getByRole('button', { name: LABELS.business });
    await lastModule.scrollIntoViewIfNeeded();
    await expect(lastModule).toBeVisible();
  });

  test(`B mega menu visible current marker and keyboard module switch (${dir})`, async ({ page }) => {
    for (const width of [820, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await openScene(page, 'top', dir);
      const opener = page.getByRole('button', { name: LABELS.business }).first();
      await expectVisibleCurrentMarker(opener);
      await opener.click();

      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      const peopleSwitcher = dialog.getByRole('button', { name: LABELS.people });
      await expectMinTarget(peopleSwitcher);
      await peopleSwitcher.focus();
      await page.keyboard.press('Enter');
      await expect(dialog.getByRole('heading', { name: LABELS.people })).toBeVisible();
      const currentSwitcher = dialog.getByRole('button', {
        name: new RegExp(`${LABELS.business}.*${LABELS.current}`),
      });
      await expectVisibleCurrentModuleSwitcher(currentSwitcher);
      await expect(dialog.getByRole('button', { name: LABELS.people })).not.toHaveAttribute(
        'aria-current',
        'page',
      );

      await dialog.getByRole('link', { name: LABELS.employees }).click();
      await expect(dialog).toBeHidden();
      await expect(page.locator('body')).toHaveAttribute('data-navigated', 'true');
      await expect(opener).toBeFocused();
    }
  });

  test(`B standalone drawer closes and releases focus at 699/700 (${dir})`, async ({ page }) => {
    await page.setViewportSize({ width: 699, height: 844 });
    await openScene(page, 'drawer', dir);
    const dialog = page.getByRole('dialog', { name: LABELS.drawerTitle });
    await expect(dialog).toBeVisible();

    await page.setViewportSize({ width: 700, height: 844 });
    await expect(dialog).toBeHidden();
    const outside = page.locator('[data-fixture-outside-input]');
    await outside.focus();
    await expect(outside).toBeFocused();
  });

  test(`B mega menu closes at the 1023/1024 boundary (${dir})`, async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 900 });
    await openScene(page, 'top', dir);
    const opener = page.getByRole('button', { name: LABELS.business }).first();
    await opener.focus();
    await opener.click();
    await expect(page.getByRole('dialog')).toBeVisible();

    await page.setViewportSize({ width: 1023, height: 900 });
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(opener).toBeFocused();
  });

  test(`B long module labels stay inside their trigger (${dir})`, async ({ page }) => {
    await page.setViewportSize({ width: 820, height: 900 });
    await openScene(page, 'top', dir, '&longLabel=true');
    const triggers = page.locator('header nav button');
    expect(await triggers.count(), 'fixture must supply more than one module').toBeGreaterThan(1);
    const first = triggers.nth(0);
    const second = triggers.nth(1);
    const firstBox = await requiredBox(first);
    const secondBox = await requiredBox(second);
    const overlap =
      Math.min(firstBox.x + firstBox.width, secondBox.x + secondBox.width) -
      Math.max(firstBox.x, secondBox.x);
    expect(overlap, 'adjacent module triggers must not overlap').toBeLessThanOrEqual(1);
    const truncated = await first
      .locator('span')
      .first()
      .evaluate((element) => element.scrollWidth > element.clientWidth);
    expect(truncated, 'the long label must truncate inside its own trigger').toBe(true);
    await expectNoHorizontalOverflow(page);
  });

  test(`C rail inspects another workspace and filters the panel (${dir})`, async ({ page }) => {
    for (const width of [1280, 820]) {
      await page.setViewportSize({ width, height: 900 });
      await openScene(page, 'context', dir);
      const rail = page.getByRole('navigation', { name: LABELS.navigation });
      const currentWorkspace = rail.getByRole('button', { name: LABELS.business }).first();
      await expectVisibleNavRailCurrentMarker(currentWorkspace);

      const panel = page.getByRole(width >= 1024 ? 'complementary' : 'dialog', {
        name: LABELS.panelNavigation,
      });
      await expect(panel).toBeVisible();
      await expect(panel.getByRole('link', { name: LABELS.columns })).toBeVisible();

      const team = rail.getByRole('button', { name: LABELS.people }).first();
      await team.click();
      await expectVisibleNavRailCurrentMarker(currentWorkspace);
      await expect(team).not.toHaveAttribute('data-current', '');
      await expect(team).toHaveAttribute('aria-pressed', 'true');
      await expect(panel.getByRole('link', { name: LABELS.employees })).toBeVisible();
      await expect(panel.getByRole('link', { name: LABELS.columns })).toHaveCount(0);

      const closePanel = panel.getByRole('button', { name: LABELS.panelClose });
      await closePanel.focus();
      await page.keyboard.press('Enter');
      await expect(panel).toBeHidden();
      await expect(team).toBeFocused();
      await team.click();
      await expect(panel).toBeVisible();
    }
  });

  test(`finder keyboard activation and localized empty state (${dir})`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openScene(page, 'context', dir);
    const trigger = page.getByRole('button', { name: LABELS.finderTrigger });
    await expectMinTarget(trigger);
    await trigger.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    const input = dialog.getByRole('searchbox', { name: LABELS.finderSearch });
    await input.fill('الأعمدة');
    await input.press('Enter');
    await expect(dialog).toBeHidden();
    await expect(page.locator('body')).toHaveAttribute('data-navigated', 'true');
    await expect(trigger).toBeFocused();

    await trigger.click();
    await input.fill('غير موجود');
    await expect(dialog.getByText(LABELS.finderEmpty)).toBeVisible();
  });

  test(`finder Enter skips a CSS-hidden result (${dir})`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openScene(page, 'context', dir, '&finderHideFirst=true');
    const trigger = page.getByRole('button', { name: LABELS.finderTrigger });
    await trigger.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    const links = dialog.locator('[data-finder-result]');
    expect(await links.count(), 'fixture must supply at least two finder results').toBeGreaterThan(1);
    await expect(links.first()).toBeHidden();
    await expect(links.nth(1)).toBeVisible();

    await links.first().evaluate((element) => {
      element.addEventListener('click', () => {
        document.body.dataset['hiddenFinderClicked'] = 'true';
      });
    });
    await links.nth(1).evaluate((element) => {
      element.addEventListener('click', () => {
        document.body.dataset['visibleFinderClicked'] = 'true';
      });
    });

    const input = dialog.getByRole('searchbox', { name: LABELS.finderSearch });
    await input.press('Enter');
    await expect(dialog).toBeHidden();
    await expect(page.locator('body')).not.toHaveAttribute('data-hidden-finder-clicked', 'true');
    await expect(page.locator('body')).toHaveAttribute('data-visible-finder-clicked', 'true');
    await expect(page.locator('body')).toHaveAttribute('data-navigated', 'true');
  });

  test(`navigation keeps focus outside when crossing 699 and 700 (${dir})`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openScene(page, 'top', dir);
    const outside = page.locator('[data-fixture-outside-input]');
    await outside.focus();
    await expect(outside).toBeFocused();

    await page.setViewportSize({ width: 1280, height: 900 });
    await expect(outside).toBeFocused();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(outside).toBeFocused();
  });
}

for (const dir of DIRECTIONS) {
  test(`A sidebar keeps current item and focus across desktop/tablet resize (${dir})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openScene(page, 'sidebar', dir);
    const toggle = page.getByRole('button', { name: LABELS.collapse });
    await toggle.focus();
    await expect(toggle).toBeFocused();

    await page.setViewportSize({ width: 820, height: 900 });
    const firstLink = page.locator('aside nav a[href]').first();
    await expect(firstLink).toBeFocused();
    await expect(firstLink).toBeVisible();

    await page.setViewportSize({ width: 1280, height: 900 });
    await expect(firstLink).toBeFocused();
    await expect(firstLink).toBeVisible();
  });

  test(`A sidebar transfers hidden slot focus at 1024 to 1023 (${dir})`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openScene(page, 'sidebar', dir);
    const firstLink = page.locator('aside nav a[href]').first();
    const headerAction = page.getByRole('button', { name: LABELS.headerAction });
    const footerAction = page.getByRole('button', { name: LABELS.footerAction });

    await headerAction.focus();
    await expect(headerAction).toBeFocused();
    await page.setViewportSize({ width: 820, height: 900 });
    await expect(firstLink).toBeFocused();

    await page.setViewportSize({ width: 1280, height: 900 });
    await footerAction.focus();
    await expect(footerAction).toBeFocused();
    await page.setViewportSize({ width: 820, height: 900 });
    await expect(firstLink).toBeFocused();
  });

  test(`A sidebar keeps focus outside when crossing 1024 and 1023 (${dir})`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openScene(page, 'sidebar', dir);
    const outside = page.locator('[data-fixture-outside-input]');
    await outside.focus();
    await expect(outside).toBeFocused();

    await page.setViewportSize({ width: 820, height: 900 });
    await expect(outside).toBeFocused();
    await page.setViewportSize({ width: 1280, height: 900 });
    await expect(outside).toBeFocused();
  });
}
