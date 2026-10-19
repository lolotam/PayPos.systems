/** العلامة اللي بتميّز قطعة HTML اتبنت جوه الحزمة. مش متصدّرة من مدخل الحزمة. */
export const htmlFragmentBrand: unique symbol = Symbol('pospay.documents.raw');

export interface HtmlFragment {
  readonly [htmlFragmentBrand]: true;
  readonly value: string;
}

/** قطعة موثوقة. مش متصدّرة من index؛ نص الطلب يعدّي على html`` بس. */
export function raw(value: string): HtmlFragment {
  return { [htmlFragmentBrand]: true, value };
}

export function isHtmlFragment(value: unknown): value is HtmlFragment {
  if (typeof value !== 'object' || value === null) return false;
  return (value as { readonly [htmlFragmentBrand]?: unknown })[htmlFragmentBrand] === true;
}
