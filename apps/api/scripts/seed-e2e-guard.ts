import { assertDevelopmentTarget } from './demo-guard.ts';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

function asE2eSeed(error: unknown): Error {
  const message = error instanceof Error ? error.message : 'e2e:seed refused';
  return new Error(message.replaceAll('demo:seed', 'e2e:seed'));
}

function apiHostname(env: NodeJS.ProcessEnv): string {
  const raw = env['BETTER_AUTH_URL'];
  if (raw === undefined || raw === '' || !URL.canParse(raw)) {
    throw new Error('e2e:seed needs BETTER_AUTH_URL');
  }
  return new URL(raw).hostname;
}

export function assertE2eTarget(env: NodeJS.ProcessEnv): void {
  try {
    assertDevelopmentTarget(env);
  } catch (error) {
    throw asE2eSeed(error);
  }
  if (!LOCAL_HOSTS.has(apiHostname(env))) {
    throw new Error('e2e:seed runs only against an API on this machine');
  }
}
