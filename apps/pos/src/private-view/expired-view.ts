import type { PrivateViewState } from './state';

/**
 * لقطة «انتهى الموعد» لدورة نموذج واحدة: ثابتة المرجع عشان React ما يعيدش الرسم، ومن غير أي مرجع للحالة المفتوحة،
 * فبيانات النافذة لازم تسيب الذاكرة مع القفل. بتتمسح مع أي قفل.
 */
export class ExpiredView<TData> {
  private cached: { epoch: number; view: PrivateViewState<TData> } | undefined;

  /**
   * @param epoch دورة النموذج الحالية
   * @returns خطوة PIN بسبب الانتهاء، بنفس المرجع طول ما الدورة هي هي
   */
  view(epoch: number): PrivateViewState<TData> {
    if (this.cached?.epoch !== epoch) {
      const view: PrivateViewState<TData> = {
        phase: 'pin',
        problem: 'expired',
        epoch: epoch + 1,
        waiting: false,
      };
      this.cached = { epoch, view };
    }
    return this.cached.view;
  }

  clear(): void {
    this.cached = undefined;
  }
}
