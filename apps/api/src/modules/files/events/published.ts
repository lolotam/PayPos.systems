/** طلب رفع محفوظ مع الحدث لتسجيل مهمتي الاحتفاظ حتى لو انقطع API قبل الاتصال بالعامل. */
export interface FileUploadRequested {
  /** هوية الملف فقط؛ لا مفاتيح تخزين ولا روابط. */
  readonly fileId: string;
}
