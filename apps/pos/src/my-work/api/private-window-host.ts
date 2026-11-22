import type { PrivateWindowAction } from '../model/private-window-state';
import type { PrivateWindowDeps } from './private-window-env';

/** جيل الطلب: بيتاخد وقت الإرسال، وأي رد بيتطبّق بس لو الجيل (والشهر للقراءات) لسه هو الحالي. */
export type Scope = {
  gen: number;
  /** رقم قراءة الشهر الحالية؛ undefined للمس اللي مش مربوطة بشهر. */
  readSeq: number | undefined;
  signal: AbortSignal;
  windowId: string;
  month: string | undefined;
};

/** اللي القراءات واللمس بتشوفه من المتحكم: النطاق، والتطبيق المحروس، ومعالجة الرفض. */
export type WindowHost = {
  deps: PrivateWindowDeps;
  /** نطاق الجيل الحالي لو النافذة مفتوحة، وغير كده undefined. */
  scope: (forRead: boolean) => Scope | undefined;
  /** بيطبّق الفعل بس لو الجيل متطابق والنافذة مفتوحة والموعد ما فاتش؛ وإلا بيرمي الرد (وبيقفل لو الموعد فات). */
  commit: (scope: Scope, action: PrivateWindowAction) => boolean;
  /** true = الخطأ اتعالج (جيل قديم، نافذة انتهت، جلسة انتهت) والمتصل مايعملش حاجة تانية. */
  refused: (scope: Scope, error: unknown) => boolean;
  /** خطأ غير متوقع جوّا المتحكم: قفل بدل ما تفضل بيانات معروضة. */
  fail: () => void;
};
