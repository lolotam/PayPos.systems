/** سياق الإشعار يحمل المستخدم المحدد من المنتج، ولا يحتاج قراءة جهات اتصال. */
export interface InAppInput {
  readonly companyId: string;
  readonly sourceEventId: string;
  readonly recipientUserId: string;
  readonly businessId: string | null;
  readonly branchId: string | null;
  readonly templateKey: string;
  readonly templateRevision: number;
  readonly locale: 'ar' | 'en';
  readonly safeParameters: readonly {
    name: string;
    type: 'text' | 'number';
    value: string | number;
  }[];
}
