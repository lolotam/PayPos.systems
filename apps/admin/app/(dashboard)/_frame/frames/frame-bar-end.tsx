import { FrameActions } from './frame-actions';
import { FrameWorkspaceSwitcher } from './frame-workspace-switcher';

/**
 * طرف الشريط العلوي في الأنماط الثلاثة: مبدّل مساحة العمل ثم الإجراءات. المبدّل هو العنصر المرن (يقصّ نصه)،
 * والإجراءات لا تنكمش؛ فإن ضاق العرض نزلت الإجراءات إلى سطر ثانٍ بدل أن يتجاوز الشريطُ الشاشة أو تنكمش أزراره
 * تحت 44px، فلا تمرير أفقي من 360px.
 */
export function FrameBarEnd() {
  return (
    <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
      <FrameWorkspaceSwitcher />
      <FrameActions />
    </div>
  );
}
