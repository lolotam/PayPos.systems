import { t, type Locale } from './catalog.js';
import { safeDisplayName } from './display-name.js';
import { roleName } from './role-name.js';

/** ما حُفظ في صف التعديل عن المحرر: اسم الموظف إن وُجد، ولقطة دور العضوية دائمًا. */
export interface EditorLabelSnapshot {
  readonly nameAr: string | null;
  readonly nameEn: string | null;
  readonly role: string | null;
  readonly roleIsSystem: boolean | null;
  readonly roleNameAr: string | null;
  readonly roleNameEn: string | null;
}

// manager كان قيمة الصفوف قبل ADR-0045 ولا يزال يُقرأ كمدير.
const MANAGER_ROLES = new Set(['general_manager', 'business_manager', 'branch_manager', 'manager']);

/**
 * يحسب النص الذي يراه الإنسان عن محرر السعر في الجرس وسجل التعديلات؛ لا يُخزَّن هذا النص في أي مكان.
 * الترتيب: اسم الموظف الآمن، ثم الدور (المالك «المالك»، المديرون الثلاثة «المدير»، بقية أدوار النظام باسمها المعتمد،
 * والدور المخصص باسمه الملتقط وقت الحفظ)، ثم تسمية عامة.
 *
 * @param locale لغة العرض
 * @param editor لقطة المحرر من صف التعديل
 * @returns الاسم أو مسمى الدور أو التسمية العامة، ولا يرجع نصًا فارغًا
 */
export function editorLabel(locale: Locale, editor: EditorLabelSnapshot): string {
  const own =
    locale === 'ar'
      ? (safeDisplayName(editor.nameAr) ?? safeDisplayName(editor.nameEn))
      : safeDisplayName(editor.nameEn);
  if (own !== null) return own;
  const role = roleLabel(locale, editor);
  if (role !== null) return role;
  const storedName = [editor.nameAr, editor.nameEn].some((name) => (name?.trim() ?? '') !== '');
  return t(locale, storedName ? 'inApp.generic_employee' : 'inApp.editor_generic');
}

function roleLabel(locale: Locale, editor: EditorLabelSnapshot): string | null {
  const code = editor.role;
  if (code === null) return null;
  const stored =
    locale === 'ar'
      ? (safeDisplayName(editor.roleNameAr) ?? safeDisplayName(editor.roleNameEn))
      : safeDisplayName(editor.roleNameEn);
  // الدور المخصص قد يحمل كود دور نظام؛ هويته من لقطة is_system لا من الكود.
  if (editor.roleIsSystem === false) return stored;
  if (code === 'owner') return t(locale, 'inApp.editor_role_owner');
  if (MANAGER_ROLES.has(code)) return t(locale, 'inApp.editor_role_manager');
  return roleName(locale, code, stored ?? '') || null;
}
