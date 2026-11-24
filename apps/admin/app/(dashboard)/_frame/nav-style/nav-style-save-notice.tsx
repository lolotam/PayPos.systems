'use client';

import { NavStyleSaveAlert } from './nav-style-save-alert';
import { useNavStyle } from './nav-style-context';

/**
 * يرسم تنبيه فشل الحفظ داخل المستضيف الحقيقي؛ التبعية معكوسة عشان المستضيف لا يستورد وحدة تقرأ اللغة،
 * فتبقى شجرة المستضيف بلا أي حلقة مع سياق اللغة.
 */
export function NavStyleSaveNotice() {
  const { saveFailed } = useNavStyle();
  return saveFailed ? <NavStyleSaveAlert /> : null;
}
