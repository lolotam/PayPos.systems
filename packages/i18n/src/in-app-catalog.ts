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
  late_service_session: 'A late service session dated {{business_date}} was recorded at {{branch_name_en}}.',
  service_line_price_edited:
    '{{editor_name_en}} edited {{service_name_en}} at {{branch_name_en}} dated {{business_date}}: the net was {{previous_net}} KWD and is now {{new_net}} KWD.',
  service_line_cancelled:
    '{{service_name_en}} was cancelled at {{branch_name_en}} dated {{business_date}}: the line net was {{cancelled_net}} KWD.',
  service_line_performers_changed:
    'The performers of {{service_name_en}} at {{branch_name_en}} dated {{business_date}} were changed: the line net is {{line_net}} KWD.',
  editor_role_owner: 'Owner',
  editor_role_manager: 'Manager',
  editor_generic: 'User',
  shift_not_clocked_in:
    '{{employee_name_en}} has not clocked in for the {{shift_start}} shift at {{branch_name_en}}',
  break_not_returned:
    '{{employee_name_en}} has not clocked back in from the break that ended at {{break_end}} at {{branch_name_en}}',
  break_returned_other_branch:
    '{{employee_name_en}} returned from the break at {{branch_name_en}}',
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
  late_service_session: 'سُجّلت جلسة متأخرة بتاريخ {{business_date}} في فرع {{branch_name_ar}}.',
  service_line_price_edited:
    'عدّل {{editor_name_ar}} خدمة {{service_name_ar}} في فرع {{branch_name_ar}} بتاريخ {{business_date}}: كان الصافي {{previous_net}} دينار وأصبح {{new_net}} دينار.',
  service_line_cancelled:
    'أُلغيت خدمة {{service_name_ar}} في فرع {{branch_name_ar}} بتاريخ {{business_date}}: كان صافي السطر {{cancelled_net}} دينار.',
  service_line_performers_changed:
    'تغيّر منفّذو خدمة {{service_name_ar}} في فرع {{branch_name_ar}} بتاريخ {{business_date}}: صافي السطر {{line_net}} دينار.',
  editor_role_owner: 'المالك',
  editor_role_manager: 'المدير',
  editor_generic: 'مستخدم',
  shift_not_clocked_in:
    'لم يُسجَّل حضور {{employee_name_ar}} لشفت الساعة {{shift_start}} في {{branch_name_ar}}',
  break_not_returned:
    'لم يُسجَّل رجوع {{employee_name_ar}} من البريك المنتهي الساعة {{break_end}} في {{branch_name_ar}}',
  break_returned_other_branch:
    '{{employee_name_ar}} رجعت من البريك في فرع {{branch_name_ar}}',
};
