import { expect, type FrameLocator, type Locator, type Page } from '@playwright/test';
import { t, type Locale } from '@pospay/i18n';

type Root = Page | FrameLocator;

async function documentLocale(root: Root): Promise<Locale> {
  return (await root.locator('html').getAttribute('lang')) === 'en' ? 'en' : 'ar';
}

/**
 * زر مبدّل مساحة العمل في الإطارات الثلاثة. اسمه المتاح هو الاسم التجاري والفرع (أو «اختر الشركة» قبل الاختيار)،
 * فلا اسم ثابت له. الذي يميّزه: يفتح حوارًا (`aria-haspopup="dialog"`) وعليه نص مرئي وليس داخل `nav`.
 * أزرار الوحدات في النمط B تفتح حوارات بنص أيضًا لكنها داخل `nav`، وزر باحث الصفحات في C وزر درج الهاتف في B
 * أيقونتان بلا نص؛ فيبقى المبدّل وحده في الأنماط الثلاثة. وهو في الإطار قبل `main` في ترتيب الصفحة، فـ `first()` لا
 * يلتقط زر حوار يرسمه محتوى الصفحة.
 */
function switcherTrigger(root: Root): Locator {
  return root
    .locator('xpath=//button[@aria-haspopup="dialog"][not(ancestor::nav)]')
    .filter({ hasText: /\S/u })
    .first();
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
