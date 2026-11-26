/**
 * هل البناء ده نسخة التطبيق الأصلي جوّه «PosPay Business» ولا نسخة الويب (PWA)؟
 *
 * المكان ده هو اللي بيقرر، مفيش شاشة بتفحص المنصة بنفسها (spec 065 FR-006)،
 * و FR-006 بيكبّر المكان ده نفسه لبوابة قدرات في M-1d.
 *
 * @returns true في نسخة التطبيق الأصلي، false في نسخة الويب
 */
export function isNativeShell(): boolean {
  return import.meta.env.VITE_NATIVE === '1';
}

/**
 * هل طلبات جلسة الموظف محتاجة تعدي بالشبكة الأصلية بدل شبكة الـ web view؟
 *
 * الـ web view على iOS بيفتح من `capacitor://localhost` فمابيبعتش كوكي مضيف الـ API،
 * والشرط ده هنا بس عشان مفيش عميل API يقرر المنصة بنفسه (spec 065 FR-006).
 *
 * @returns true في بناء iOS الأصلي فقط، false في Android والويب
 */
export function usesNativeStaffTransport(): boolean {
  return (
    isNativeShell() &&
    (globalThis as { Capacitor?: { getPlatform?: () => string } }).Capacitor?.getPlatform?.() ===
      'ios'
  );
}

/**
 * الـ host بتاع نسخة التطبيق الأصلي: نفس الـ host اللي مضمون في البناء.
 *
 * ده ثابت مش `location.host`: على iOS الصفحة بتفتح على `capacitor://localhost` (ADR-0055 قرار 3)،
 * فلو قرأنا الـ host من الصفحة هنقبل لينك على مضيف غلط. نسخة الويب ما بتستدعيش الدالة دي،
 * لأن قراءة اللينك شغل نسخة التطبيق بس.
 *
 * @returns الـ host المضمون في البناء
 */
export function nativePosHost(): string {
  const host = import.meta.env.VITE_POS_HOST;
  if (!host) throw new Error('NATIVE_POS_HOST_MISSING');
  return host;
}

/**
 * هل نسخة التطبيق اللي قدام المستخدم دلوقتي هي نسخة التجربة (staging)؟
 *
 * لازم الإجابة تكون واضحة من غير ما أي شاشة تفحص المنصة بنفسها (FR-006)، لأن نسخة
 * التجربة بتتكلم مع سيرفر التجربة وبياناتها بيانات اختبار: المختبِر لازم ما يخلطهاش
 * بالنسخة الحقيقية فيدخل على بيانات زبائن حقيقية بالغلط (APP-Q13).
 *
 * @returns true في نسخة التطبيق من نوع staging، false في نسخة الإنتاج أو في نسخة الويب
 */
export function isStagingApp(): boolean {
  return isNativeShell() && import.meta.env.VITE_NATIVE_FLAVOUR === 'staging';
}

/**
 * قدرات البناء الحالي: كل قدرة بتتحدد في نسخة التطبيق الأصلي بس (M-1d، spec 065 FR-006).
 *
 * البوابة دي هي المكان الوحيد اللي يقرر القدرة، ومفيش شاشة بتفحص المنصة بنفسها.
 */
export interface PlatformCapabilities {
  /** إشعارات المتصفح: مفيش Service Worker ولا Web Push جوّه نسخة التطبيق الأصلي. */
  readonly webPush: boolean;
  /** مفاتيح المرور (WebAuthn): مفيش منصة WebAuthn في الـ web view بتاع التطبيق. */
  readonly passkeys: boolean;
  /** مسح كود الـ QR بالكاميرا: مفعّل وقت البناء لو المشروع سمح. */
  readonly qrScan: boolean;
  /** كاميرا الحضور: مفعّلة وقت البناء لو المشروع سمح. */
  readonly attendanceCamera: boolean;
}

/** القدرات كلها مفتوحة: دي نسخة الويب، وهي زي ما كانت من غير أي تغيير. */
const WEB_CAPABILITIES: PlatformCapabilities = {
  webPush: true,
  passkeys: true,
  qrScan: true,
  attendanceCamera: true,
};

/**
 * قدرات البناء الحالي: نسخة الويب مفتوحة كلها، ونسخة التطبيق الأصلي بتقفل اللي ما هيشتغلش فيه.
 *
 * @returns القدرات المتاحة في البناء الحالي
 */
export function capabilities(): PlatformCapabilities {
  if (!isNativeShell()) return WEB_CAPABILITIES;
  return {
    webPush: false,
    passkeys: false,
    qrScan: import.meta.env.VITE_NATIVE_QR_SCAN === '1',
    attendanceCamera: import.meta.env.VITE_NATIVE_ATTENDANCE_CAMERA === '1',
  };
}

/**
 * نوع نسخة التطبيق: تجربة أو إنتاج. الثابتة في البناء (ADR-0055 قرار 4)، مش من الصفحة.
 *
 * @returns 'production' لو البناء ده نسخة الإنتاج، و'staging' غير كده
 */
export function nativeFlavour(): 'staging' | 'production' {
  return import.meta.env.VITE_NATIVE_FLAVOUR === 'production' ? 'production' : 'staging';
}

/**
 * لينك نسخة الويب: الميزة اللي نسخة التطبيق الأصلي مش بتعرف تعملها بتتعمل في نسخة الويب.
 *
 * @param path المسار جوه نسخة الويب، افتراضياً شاشة الموظف
 * @returns اللينك الكامل في نسخة التطبيق، والمسار نفسه في نسخة الويب
 */
export function webAppUrl(path = '/personal'): string {
  if (!isNativeShell()) return path;
  const suffix = path.startsWith('/') ? path : `/${path}`;
  try {
    return `https://${nativePosHost()}${suffix}`;
  } catch {
    // بناء من غير host معرّف: مفيش لينك بتاع نسخة الويب، فبنسيب المسار زي ما هو.
    return path;
  }
}
