// محتوى الجدول والقالب وحد الورديات قابل للتعديل؛ الملكية وهوية الموظف والأسبوع والنشاط غير قابلة للتحديث.
export const SCHEDULE_COLUMN_GRANTS = [
  'staff_branch_schedule_settings.max_shifts_per_day:pospay_app:UPDATE',
  'staff_branch_schedule_settings.updated_at:pospay_app:UPDATE',
  'staff_branch_schedule_settings.updated_by:pospay_app:UPDATE',
  'staff_schedules.revision:pospay_app:UPDATE',
  'staff_schedules.timezone:pospay_app:UPDATE',
  'staff_shift_templates.archived_at:pospay_app:UPDATE',
  'staff_shift_templates.name_ar:pospay_app:UPDATE',
  'staff_shift_templates.name_en:pospay_app:UPDATE',
  'staff_shift_templates.revision:pospay_app:UPDATE',
  'staff_shift_templates.shifts:pospay_app:UPDATE',
  'staff_schedule_settings.max_shifts_per_day:pospay_app:UPDATE',
  'staff_schedule_settings.updated_at:pospay_app:UPDATE',
  'staff_schedule_settings.updated_by:pospay_app:UPDATE',
];

export const SCHEDULE_TABLE_GRANTS = [
  'staff_branch_schedule_settings:DELETE',
  'staff_branch_schedule_settings:INSERT',
  'staff_branch_schedule_settings:SELECT',
  'staff_schedule_settings:INSERT',
  'staff_schedule_settings:SELECT',
];
