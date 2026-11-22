import type { ReactNode } from 'react';

/**
 * عنصر تنقّل مشترك بين أجزاء الإطار (التبويبات والحبوب والشريط السفلي وبطاقة المحور).
 * نفس أسماء حقول عنصر صفحة نموذج التنقّل القادم من 074-4/5/6 (`NavigationPage`) مع أيقونة
 * وحالة اختياريتين، عشان 074-7 يمرّر نفس الكائن للمجموعتين من غير تحويل.
 */
export type ShellNavItem = {
  /** معرّف مستقر للعنصر يُستخدم مفتاحًا في القائمة. */
  id: string;
  /** النص الظاهر — مترجم مسبقًا من المستدعي، الكيت لا يملك أي نص. */
  label: string;
  /** عنوان الصفحة الهدف؛ الرابط عادي `<a href>` بلا توجيه من الكيت. */
  href: string;
  /** عدّاد جاهز للعرض بجانب العنصر؛ غيابه لا يعرض شيئًا. */
  count?: string;
  /** علامة نصية اختيارية مثل «قريبًا» — نصها وتابعها من المستدعي. */
  status?: string;
  /** أيقونة اختيارية من أيقونات الكيت تُعرض قبل النص. */
  icon?: ReactNode;
  /** العنصر الحالي — الحالة يحددها المستدعي لأن الكيت لا يقرأ المسار أبدًا. */
  current?: boolean;
};

/**
 * أساس رابط التنقّل المشترك: هدف لمس 44px على الأقل في الاتجاهين، قصّ النص الطويل
 * بنقطة حذف بدل توسيع الصف، وخواص منطقية فقط حتى يعمل نفس الصنف في RTL وLTR.
 * `min-w-11` حدّ العرض الأدنى (هدف لمس كامل ولو كان النص قصيرًا)،
 * و`max-w-full` يربط الرابط بعرض العنصر الحامل حتى يعمل القصّ فعلًا.
 */
export const shellNavLinkClass =
  'inline-flex min-h-11 min-w-11 max-w-full items-center gap-2 rounded-interactive text-start text-sm font-medium whitespace-nowrap transition-colors motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';

/**
 * عدّاد التنقّل المشترك: شريحة صغيرة بلون النداء تُعرض بجانب العنصر فقط
 * لما يرسل المستدعي قيمة، ولأن الأرقام تظل LTR داخل النص العربي.
 */
export const shellNavCountClass =
  'inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-cta px-1.5 text-[11px] font-semibold text-cta-foreground';
