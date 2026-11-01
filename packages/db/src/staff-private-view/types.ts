/**
 * صف الجلسة المقفل أثناء فتح النافذة.
 * نوع alias مش interface، لأن execute في Drizzle يشترط Record<string, unknown>
 * والواجهات مابيبقاش ليها فهرس ضمني فبترفضها التوليد.
 */
export type StaffPrivateViewSessionRow = {
  readonly user_id: string;
  readonly purpose: string | null;
  readonly staff_device_context: unknown;
  readonly staff_absolute_deadline: Date | string | null;
};
