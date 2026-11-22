/**
 * بيخفّي حاوية البيانات الخاصة في نفس لحظة الحدث، قبل ما React يطبّق التغيير. الإخفاء بـ `hidden` و`display:none`
 * (مش بتفريغ الأبناء ولا إزالتهم) عشان React هو اللي يشيلها بعدين من غير ما يلاقي عقدة ناقصة. الحاوية دي بتتركّب
 * في مرحلة الفتح بس وبتتشال معاها، فالسمة بتموت مع العنصر.
 *
 * مش مضمون: مؤقت JavaScript مبيشتغلش لو الخيط الرئيسي موقوف أو مشغول، فرسمة ممكن تتعمل بين فوات الموعد وبين ما المؤقت يشتغل.
 *
 * @param root حاوية العرض الخاص
 */
export function concealPrivateRoot(root: HTMLElement): void {
  root.hidden = true;
  root.style.display = 'none';
  root.setAttribute('inert', '');
  root.setAttribute('aria-hidden', 'true');
}
