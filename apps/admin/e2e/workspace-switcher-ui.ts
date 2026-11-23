import { expect, type FrameLocator, type Locator, type Page } from '@playwright/test';
import { t, type Locale } from '@pospay/i18n';

type Root = Page | FrameLocator;

async function documentLocale(root: Root): Promise<Locale> {
  return (await root.locator('html').getAttribute('lang')) === 'en' ? 'en' : 'ar';
}

/**
 * زر مبدّل مساحة العمل في الإطارات الثلاثة. اسمه المتاح هو الاسم التجاري والفرع (أو «اختر الشركة» قبل الاختيار)،
 * فلا اسم ثابت له. الذي يميّزه: يفتح حوارًا (`aria-haspopup="dialog"`) وعليه نص مرئي، بخلاف زر باحث الصفحات في
 * النمط C فأيقونته بلا نص. وهو في الإطار قبل `main` في ترتيب الصفحة في الأنماط الثلاثة، فـ `first()` لا يلتقط
 * زر حوار يرسمه محتوى الصفحة. هذا صحيح في C (الافتراضي بعد كل دخول) وA؛ في B تسبقه أزرار وحدات بنص فلا يصلح.
 */
function switcherTrigger(root: Root): Locator {
  return root.locator('button[aria-haspopup="dialog"]').filter({ hasText: /\S/u }).first();
}

async function openSwitcher(root: Root, locale: Locale): Promise<Locator> {
  const dialog = root.getByRole('dialog', { name: t(locale, 'adminNav.workspacesLabel') });
  await expect(switcherTrigger(root)).toBeVisible();
  await switcherTrigger(root).click();
  await expect(dialog).toBeVisible();
  return dialog;
}

async function closeSwitcher(dialog: Locator): Promise<void> {
  await dialog.press('Escape');
  await expect(dialog).toBeHidden();
}

/** يفتح مبدّل مساحة العمل ويختار الشركة باسمها ثم يغلقه، فتبقى الصفحة قابلة للتفاعل. */
export async function chooseCompanyInSwitcher(
  root: Root,
  companyName: string,
  language?: Locale,
): Promise<void> {
  const locale = language ?? (await documentLocale(root));
  const dialog = await openSwitcher(root, locale);
  await dialog.getByRole('combobox', { name: t(locale, 'admin.companyLabel') }).click();
  await root.getByRole('option', { name: companyName, exact: true }).click();
  await closeSwitcher(dialog);
}

/** يتأكد أن الشركة المختارة في المبدّل هي المذكورة، ثم يغلق المبدّل. */
export async function expectCompanyInSwitcher(root: Root, companyName: string): Promise<void> {
  const locale = await documentLocale(root);
  const dialog = await openSwitcher(root, locale);
  await expect(
    dialog.getByRole('combobox', { name: t(locale, 'admin.companyLabel') }),
  ).toContainText(companyName);
  await closeSwitcher(dialog);
}
