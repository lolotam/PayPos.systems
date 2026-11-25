/** رفض متوقع من مسار الرقم السري للموظفة: كود ثابت وآمن للطباعة، ومفيش أي بيانات حساب تاني فيه. */
export class StaffPinError extends Error {
  override readonly name = 'StaffPinError';
  /** كود الرفض الثابت: لازم تغيير الرقم المؤقت، أو مدته خلصت. */
  readonly code: 'PIN_CHANGE_REQUIRED' | 'PIN_EXPIRED';
  /** دليل تغيير الرقم المؤقت — بيتسلّم للعميل مرة واحدة وبس، وما بيتكتبش في log ولا في audit. */
  readonly proof: string | undefined;

  /**
   * يبني الرفض بكوده.
   *
   * @param code  كود الرفض الثابت
   * @param proof دليل التغيير، لو الكود بيطلب تغيير
   */
  constructor(code: 'PIN_CHANGE_REQUIRED' | 'PIN_EXPIRED', proof?: string) {
    super(code);
    this.code = code;
    this.proof = proof;
  }
}
