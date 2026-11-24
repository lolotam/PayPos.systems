/** المستخدم انتهى بين التحقق من الجلسة والكتابة؛ يُطلب دخول جديد بدل تحويله لعطل داخلي. */
export class AuthUserNotFoundError extends Error {
  constructor() {
    super('AUTH_USER_NOT_FOUND');
    this.name = 'AuthUserNotFoundError';
  }
}
