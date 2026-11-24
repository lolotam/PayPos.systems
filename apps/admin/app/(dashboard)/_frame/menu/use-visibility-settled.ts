'use client';

import { useSessionIdentity } from '@/session/api/use-session';
import { useMounted } from '@/shared/browser/use-mounted';
import { useWorkspace } from '@/workspace/model/workspace-provider';

import { useVisibilityReads } from './use-visibility-reads';
import { visibilityReadsPending } from './visibility-settled';

/**
 * هل استقر كل ما يحدد الصفحات المرئية: مساحة العمل، وهوية المستخدم، وكل قراءة خلف شرط ظهور؟
 * عناوين النظرة العامة و`/soon/` تقرّر وجهتها من الصفحات المرئية، فلا تقرّر قبل هذا وإلا استبدلت العنوان
 * بصفحة غير مبنية لأن قراءة ما وصلت بعد، أو أظهرت «غير موجود» لمدخل سيظهر.
 * مساحة غير جاهزة (اختيار ناقص أو فارغة أو خطأ) جواب نهائي، وكذلك فشل قراءة الهوية: الشروط تبقى مغلقة.
 *
 * @returns true حين لا يتغير جواب القوائم بعد الآن إلا بتغيير مساحة العمل
 */
export function useVisibilitySettled(): boolean {
  const { userId, status } = useSessionIdentity(useMounted());
  const workspace = useWorkspace();
  const reads = useVisibilityReads(userId);
  if (workspace.status === 'loading') return false;
  if (workspace.status !== 'ready') return true;
  if (status === 'pending') return false;
  return !visibilityReadsPending(reads);
}
