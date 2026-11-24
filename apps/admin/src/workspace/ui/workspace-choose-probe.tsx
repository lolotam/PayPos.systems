import type { SelectionChoice } from '@/shared/api/selection-cookie';

import { useWorkspace } from '../model/workspace-provider';

/** زرار اختبار بيبدّل الاختيار من نفس طريق المستخدم: choose من الـ provider. */
export function WorkspaceChooseProbe({ label, next }: { label: string; next: SelectionChoice }) {
  const workspace = useWorkspace();
  return (
    <button type="button" onClick={() => workspace.choose(next)}>
      {label}
    </button>
  );
}
