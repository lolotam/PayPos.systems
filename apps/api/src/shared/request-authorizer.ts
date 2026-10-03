export const REQUEST_AUTHORIZER = Symbol('REQUEST_AUTHORIZER');
/** تقييم حي للصلاحيات يستخدمه الحارس وإصدار القدرة المحمية بالصلاحية المحفوظة. */
export interface RequestAuthorizer {
  execute(input: {
    userId: string;
    requestedCompany: unknown;
    permission: string;
    businessParam?: unknown;
    branchParam?: unknown;
  }): Promise<unknown | null>;
}
