// The demo data is for a developer's own database only. Refused unless NODE_ENV is development and every database
// connection the script uses points at the same database on this machine — a staging or production URL in the
// environment can never receive a demo operator with a platform grant.
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/**
 * @param env the process environment
 * @returns nothing; throws when the target is not a local development database
 */
export function assertDevelopmentTarget(env: NodeJS.ProcessEnv): void {
  if (env['NODE_ENV'] !== 'development') {
    throw new Error('demo:seed runs only with NODE_ENV=development');
  }
  const urls = ['DATABASE_URL', 'AUTH_DATABASE_URL', 'MIGRATION_DATABASE_URL'].map((name) => {
    const value = env[name];
    if (value === undefined || value === '' || !URL.canParse(value)) {
      throw new Error(`demo:seed needs ${name}`);
    }
    return new URL(value);
  });
  const targets = new Set(
    urls.map((url) => `${url.hostname}:${url.port || '5432'}${url.pathname}`),
  );
  if (targets.size !== 1 || !urls.every((url) => LOCAL_HOSTS.has(url.hostname))) {
    throw new Error('demo:seed runs only against one database on this machine');
  }
}
