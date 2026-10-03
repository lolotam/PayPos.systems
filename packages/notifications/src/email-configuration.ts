export interface EmailConfiguration {
  readonly enabled: false;
  readonly reason: 'EMAIL_FEEDBACK_NOT_IMPLEMENTED';
  readonly hashKey?: string;
  readonly hashKeyId?: string;
}

export function readEmailConfiguration(env: NodeJS.ProcessEnv): EmailConfiguration {
  // استقبال موثّق ومصالحة ومنع bounce شرط تفعيل؛ أي إعداد بيئة لا يرفع البوابة وحده.
  return {
    enabled: false,
    reason: 'EMAIL_FEEDBACK_NOT_IMPLEMENTED',
    ...(env['NOTIFICATION_EMAIL_HASH_KEY'] ? { hashKey: env['NOTIFICATION_EMAIL_HASH_KEY'] } : {}),
    ...(env['NOTIFICATION_EMAIL_HASH_KEY_ID']
      ? { hashKeyId: env['NOTIFICATION_EMAIL_HASH_KEY_ID'] }
      : {}),
  };
}
