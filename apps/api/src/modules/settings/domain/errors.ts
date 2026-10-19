/** الملف مش ملف شعار مسموح بربطه: الرد هو كود الغلاف نفسه عشان سبب الرفض ما يتكشفش. */
export class LogoFileRejected extends Error {
  readonly code: 'FILE_NOT_FOUND' | 'FILE_NOT_READY';

  /**
   * بيرفض الربط قبل الكتابة. الكود هو كود الغلاف، فالملف الغريب والملف المجهول نفس الإجابة.
   */
  constructor(code: 'FILE_NOT_FOUND' | 'FILE_NOT_READY') {
    super(code);
    this.name = 'LogoFileRejected';
    this.code = code;
  }
}
