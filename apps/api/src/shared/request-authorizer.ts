export const REQUEST_AUTHORIZER = Symbol('REQUEST_AUTHORIZER');
/** تقييم حي للصلاحيات يستخدمه الحارس وإصدار القدرة المحمية بالصلاحية المحفوظة. */
export interface RequestAuthorizer {
  execute(input: {
    userId: string;
    requestedCompany: unknown;
    permission: string;
    businessParam?: unknown;
    branchParam?: unknown;
    featureFlag?: string;
  }): Promise<{ feature?: { enabled: boolean } } | null>;
  /**
   * هل عضوية المستخدم السارية بتغطي النشاط ده؟
   * التحقق من التغطية لا يطلب صلاحية، وهو طريق القراءة الوحيد للشعار المربوط (TQ-1).
   *
   * @param input المستخدم والشركة المطلوبة والنشاط المطلوب
   * @returns true لما العضوية السارية بتغطي النشاط
   */
  coversBusiness(input: {
    userId: string;
    requestedCompany: unknown;
    businessParam: unknown;
  }): Promise<boolean>;
}
