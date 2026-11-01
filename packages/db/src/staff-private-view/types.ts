/**
 * صف الجلسة المقفل أثناء فتح النافذة، كما وصل من execute خام.
 * نوع alias مش interface، لأن execute في Drizzle يشترط Record<string, unknown>
 * والواجهات مابيبقاش ليها فهرس ضمني فبترفضها التوليد.
 */
export type StaffPrivateViewSessionRow = {
  readonly user_id: string;
  readonly purpose: string | null;
  readonly staff_device_context: unknown;
  readonly staff_absolute_deadline: Date | string | null;
};

/**
 * صف الجلسة بعد التطبيع: الموعد بقى تاريخاً واحداً اتحسب مرة واحدة في db.
 * القرار في auth بيقارن تاريخاً واحداً، والعداد بيكتب نفس القيمة، فما يتقارنش مرتين.
 */
export type StaffPrivateViewDecisionRow = {
  readonly user_id: string;
  readonly purpose: string | null;
  readonly staff_device_context: unknown;
  readonly staff_absolute_deadline: Date | null;
};
