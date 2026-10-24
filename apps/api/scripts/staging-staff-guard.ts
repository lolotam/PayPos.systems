export class OperatorInputError extends Error {
  override readonly name = 'OperatorInputError';
}

const REFUSAL = 'staging staff operator target refused';

function parsed(value: string | undefined): URL {
  if (value === undefined || value === '') throw new OperatorInputError(REFUSAL);
  try {
    return new URL(value);
  } catch {
    throw new OperatorInputError(REFUSAL);
  }
}

function sameDatabase(app: URL, auth: URL): boolean {
  return (
    app.protocol === auth.protocol &&
    app.hostname === auth.hostname &&
    (app.port || '5432') === (auth.port || '5432') &&
    app.pathname === auth.pathname &&
    app.search === auth.search
  );
}

// NODE_ENV=production على staging، ولذلك نطلب خمس علامات مستقلة؛ DEPLOY_ENV literal لا تحمله إلا staging compose،
// فملف env منسوخ من production لا يكفي، وتطابق قاعدتي الاتصال يمنع الكتابة في قاعدة غير المقصودة.
export function assertStagingTarget(target: string | undefined, env: NodeJS.ProcessEnv): void {
  const authUrl = parsed(env['BETTER_AUTH_URL']);
  if (
    target !== 'staging' ||
    env['DEPLOY_ENV'] !== 'staging' ||
    !authUrl.hostname.endsWith('.staging.pospay.systems') ||
    env['COOKIE_DOMAIN'] !== '.staging.pospay.systems' ||
    !sameDatabase(parsed(env['DATABASE_URL']), parsed(env['AUTH_DATABASE_URL']))
  ) {
    throw new OperatorInputError(REFUSAL);
  }
}
