import { attendanceChangeAr, attendanceChangeEn } from './attendance-change.js';

// نصوص جرس الإشعارات في ملف لوحده، عشان كل قالب جديد يضيف سطوره هنا بدل ما يكبّر الكتالوج الرئيسي.
export const inAppEn = {
  ...attendanceChangeEn.inApp,
  title: 'Notifications',
  unread: 'Unread',
  read: 'Read',
  markRead: 'Mark read',
  markAllRead: 'Mark all read',
  empty: 'No notifications yet.',
  loading: 'Loading notifications…',
  error: 'Notifications could not be updated. Try again.',
  generic_notice: 'Update for {{subject}}',
  generic_employee: 'Employee',
  generic_branch: 'Branch',
  shift_not_clocked_in:
    '{{employee_name_en}} has not clocked in for the {{shift_start}} shift at {{branch_name_en}}',
  break_not_returned:
    '{{employee_name_en}} has not clocked back in from the break that ended at {{break_end}} at {{branch_name_en}}',
};

export const inAppAr = {
  ...attendanceChangeAr.inApp,
  title: 'الإشعارات',
  unread: 'غير مقروء',
  read: 'مقروء',
  markRead: 'تحديد كمقروء',
  markAllRead: 'تحديد الكل كمقروء',
  empty: 'لا توجد إشعارات بعد.',
  loading: 'جارٍ تحميل الإشعارات…',
  error: 'تعذّر تحديث الإشعارات. حاول مرة أخرى.',
  generic_notice: 'تحديث بخصوص {{subject}}',
  generic_employee: 'موظف',
  generic_branch: 'فرع',
  shift_not_clocked_in:
    'لم يُسجَّل حضور {{employee_name_ar}} لشفت الساعة {{shift_start}} في {{branch_name_ar}}',
  break_not_returned:
    'لم يُسجَّل رجوع {{employee_name_ar}} من البريك المنتهي الساعة {{break_end}} في {{branch_name_ar}}',
};
