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
  generic_document: 'Document',
  late_service_session:
    'A late service session dated {{business_date}} was recorded at {{branch_name_en}}.',
  service_line_price_edited:
    '{{editor_name_en}} edited {{service_name_en}} at {{branch_name_en}} dated {{business_date}}: the net was {{previous_net}} KWD and is now {{new_net}} KWD.',
  service_line_cancelled:
    '{{service_name_en}} was cancelled at {{branch_name_en}} dated {{business_date}}: the line net was {{cancelled_net}} KWD.',
  service_line_performers_changed:
    'The performers of {{service_name_en}} at {{branch_name_en}} dated {{business_date}} were changed: the line net is {{line_net}} KWD.',
  discount_self_approved:
    '{{approver_name_en}} approved a discount of up to {{max_percent}}% on {{service_name_en}}, a service they performed, at {{branch_name_en}}.',
  discount_approval_requested:
    'Discount approval requested at {{branch_name_en}}: {{service_name_en}}, {{line_count}} line(s), discount up to {{max_percent}}%.',
  commission_correction_blocked:
    'A commission correction for {{period}} is on hold: an employee has no commission plan or no salary for that month. Open the blocked corrections to fix it.',
  editor_role_owner: 'Owner',
  editor_role_manager: 'Manager',
  editor_generic: 'User',
  shift_not_clocked_in:
    '{{employee_name_en}} has not clocked in for the {{shift_start}} shift at {{branch_name_en}}',
  break_not_returned:
    '{{employee_name_en}} has not clocked back in from the break that ended at {{break_end}} at {{branch_name_en}}',
  break_returned_other_branch: '{{employee_name_en}} returned from the break at {{branch_name_en}}',
  attendance_exception_raised:
    '{{employee_name_en}} clocked in at {{branch_name_en}} on {{clock_in_date}} at {{clock_in_time}} and has not clocked out',
  document_expiring: "{{employee_name_en}}'s {{document_type_en}} expires on {{expires_on}}",
  document_expiring_numbered:
    "{{employee_name_en}}'s {{document_type_en}} expires on {{expires_on}} · document no. {{document_number}}",
  low_rating_summary:
    'Low rating: {{stars}} at {{branch}} on {{business_date}}. Performed by {{performers}}. Customer: {{customer}}, phone ending {{phone_last3}}.',
  low_rating_stars_1: '1 star',
  low_rating_stars_2: '2 stars',
  low_rating_generic_customer: 'A customer',
  low_rating_names_separator: ', ',
  low_rating_comment_label: 'Customer comment',
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
  generic_document: 'مستند',
  late_service_session: 'سُجّلت جلسة متأخرة بتاريخ {{business_date}} في فرع {{branch_name_ar}}.',
  service_line_price_edited:
    'عدّل {{editor_name_ar}} خدمة {{service_name_ar}} في فرع {{branch_name_ar}} بتاريخ {{business_date}}: كان الصافي {{previous_net}} دينار وأصبح {{new_net}} دينار.',
  service_line_cancelled:
    'أُلغيت خدمة {{service_name_ar}} في فرع {{branch_name_ar}} بتاريخ {{business_date}}: كان صافي السطر {{cancelled_net}} دينار.',
  service_line_performers_changed:
    'تغيّر منفّذو خدمة {{service_name_ar}} في فرع {{branch_name_ar}} بتاريخ {{business_date}}: صافي السطر {{line_net}} دينار.',
  discount_self_approved:
    'وافق {{approver_name_ar}} على خصم حتى {{max_percent}}% على خدمة {{service_name_ar}} نفّذها بنفسه في فرع {{branch_name_ar}}.',
  discount_approval_requested:
    'طلب موافقة على خصم في فرع {{branch_name_ar}}: {{service_name_ar}}، عدد السطور {{line_count}}، الخصم حتى {{max_percent}}%.',
  commission_correction_blocked:
    'فيه تصحيح عمولة موقوف عن شهر {{period}}: موظفة ناقصها خطة عمولة أو مرتب. افتح التصحيحات الموقوفة عشان يتصلّح.',
  editor_role_owner: 'المالك',
  editor_role_manager: 'المدير',
  editor_generic: 'مستخدم',
  shift_not_clocked_in:
    'لم يُسجَّل حضور {{employee_name_ar}} لشفت الساعة {{shift_start}} في {{branch_name_ar}}',
  break_not_returned:
    'لم يُسجَّل رجوع {{employee_name_ar}} من البريك المنتهي الساعة {{break_end}} في {{branch_name_ar}}',
  break_returned_other_branch: '{{employee_name_ar}} رجعت من البريك في فرع {{branch_name_ar}}',
  attendance_exception_raised:
    '{{employee_name_ar}} سجّلت دخول في {{branch_name_ar}} يوم {{clock_in_date}} الساعة {{clock_in_time}} ولم تسجّل خروج',
  document_expiring:
    'مستند {{document_type_ar}} الخاص بـ {{employee_name_ar}} ينتهي يوم {{expires_on}}',
  document_expiring_numbered:
    'مستند {{document_type_ar}} الخاص بـ {{employee_name_ar}} ينتهي يوم {{expires_on}} — رقم المستند {{document_number}}',
  low_rating_summary:
    'تقييم منخفض: {{stars}} في {{branch}} بتاريخ {{business_date}}. المنفّذون: {{performers}}. العميل: {{customer}}، الهاتف المنتهي بـ {{phone_last3}}.',
  low_rating_stars_1: 'نجمة واحدة',
  low_rating_stars_2: 'نجمتان',
  low_rating_generic_customer: 'عميل',
  low_rating_names_separator: '، ',
  low_rating_comment_label: 'تعليق العميل',
};
