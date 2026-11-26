import type { PrivateViewDeps } from './env';
import type { PrivateViewWindowAction } from './state';

/** جيل الطلب: بيتاخد وقت الإرسال، وأي رد بيتطبّق بس لو الجيل (والشهر للقراءات) لسه هو الحالي. */
export type Scope = {
  gen: number;
  /** رقم قراءة الشهر الحالية؛ undefined للمس اللي مش مربوطة بشهر. */
  readSeq: number | undefined;
  signal: AbortSignal;
  windowId: string;
  month: string | undefined;
};

/** اللي اللمسة بتشوفه من المتحكم: النطاق، والتطبيق المحروس، ومعالجة الرفض. */
export type WindowTouchHost = {
  deps: PrivateViewDeps;
  /** نطاق الجيل الحالي لو النافذة مفتوحة والموعد ما فاتش؛ وغير كده undefined (وبيقفل بـ expired لو الموعد فات). */
  scope: (forRead: boolean) => Scope | undefined;
  /** بيطبّق فعل النافذة بس لو الجيل متطابق والنافذة مفتوحة والموعد ما فاتش؛ وإلا بيرمي الرد. */
  commitWindow: (scope: Scope, action: PrivateViewWindowAction) => boolean;
  /** true = الخطأ اتعالج (جيل قديم، نافذة انتهت، جلسة انتهت) والمتصل مايعملش حاجة تانية. */
  refused: (scope: Scope, error: unknown) => boolean;
  /** خطأ غير متوقع جوّا المتحكم: قفل بدل ما تفضل بيانات معروضة. */
  fail: () => void;
};

/** اللي القراءات بتشوفه من المتحكم: النطاق، وتطبيق فعل البيانات المحروس، ومعالجة الرفض. */
export type WindowHost<TAction> = WindowTouchHost & {
  /** بيطبّق فعل البيانات بس لو الجيل متطابق والنافذة مفتوحة والموعد ما فاتش؛ وإلا بيرمي الرد. */
  commitData: (scope: Scope, action: TAction) => boolean;
};
