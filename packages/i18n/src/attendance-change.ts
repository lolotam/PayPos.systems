export const attendanceChangeAr = {
  permissionCodes: {
    requestAttendanceChangeBranch: 'طلب تعديل حضور',
  },
  inApp: {
    attendance_change_requested: 'طلب {{change}} لـ {{employee_name_ar}} مستني موافقتك',
    attendance_change_decided:
      '{{change}} لـ {{employee_name_ar}}: {{decision}}. السبب: {{reason}}',
    attendance_change_add: 'إضافة يوم حضور',
    attendance_change_void: 'إلغاء يوم حضور',
    attendance_change_approved: 'تمت الموافقة',
    attendance_change_rejected: 'تم الرفض',
  },
  errors: {
    ATTENDANCE_CHANGE_SELF_FORBIDDEN: 'ماينفعش تطلب تعديل حضورك بنفسك.',
    ATTENDANCE_CHANGE_NOT_PENDING: 'الطلب لازم يكون مستني عشان يتقرر أو يتسحب.',
    ATTENDANCE_CHANGE_REVISION_CONFLICT: 'الطلب اتغيّر. حدّث الصفحة وحاول تاني.',
    ATTENDANCE_CHANGE_DUPLICATE_PENDING: 'فيه طلب مستني لنفس التغيير بالفعل.',
    ATTENDANCE_CHANGE_KIND_UNAVAILABLE: 'نوع تعديل الحضور ده مش متاح لسه.',
  },
};

export const attendanceChangeEn = {
  permissionCodes: {
    requestAttendanceChangeBranch: 'Request attendance change',
  },
  inApp: {
    attendance_change_requested:
      '{{change}} requested for {{employee_name_en}}; awaiting your approval',
    attendance_change_decided:
      '{{change}} for {{employee_name_en}}: {{decision}}. Reason: {{reason}}',
    attendance_change_add: 'Add attendance day',
    attendance_change_void: 'Void attendance day',
    attendance_change_approved: 'Approved',
    attendance_change_rejected: 'Rejected',
  },
  errors: {
    ATTENDANCE_CHANGE_SELF_FORBIDDEN: 'You cannot request a change to your own attendance.',
    ATTENDANCE_CHANGE_NOT_PENDING:
      'Only pending attendance change requests can be decided or withdrawn.',
    ATTENDANCE_CHANGE_REVISION_CONFLICT: 'The request changed. Reload and try again.',
    ATTENDANCE_CHANGE_DUPLICATE_PENDING: 'A pending request already exists for this change.',
    ATTENDANCE_CHANGE_KIND_UNAVAILABLE: 'This attendance change kind is not available yet.',
  },
};
