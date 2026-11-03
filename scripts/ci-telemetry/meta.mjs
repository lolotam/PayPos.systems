// The meta table: the only environment names that may reach the report, each with the validator its
// own value must pass. The `node` field has no environment source: the CLI passes the running version.

// The pnpm field is validated with the Turbo version pattern, so one pattern serves both modules.
export const TURBO_VERSION_PATTERN = /^\d{1,3}\.\d{1,3}\.\d{1,3}(-[a-z0-9.]{1,20})?$/;

const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const EVENT_PATTERN = /^[a-z_]{1,40}$/;
const DIGITS_PATTERN = /^\d{1,20}$/;
const JOB_PATTERN = /^[a-z0-9_-]{1,60}$/;
const RUNNER_OS_PATTERN = /^(Linux|Windows|macOS)$/;
const RUNNER_ARCH_PATTERN = /^(X86|X64|ARM|ARM64)$/;
const NODE_VERSION_PATTERN = /^v\d{1,3}\.\d{1,3}\.\d{1,3}$/;

export const META_FIELDS = {
  commit: { source: 'CI_TELEMETRY_CHECKOUT_SHA', pattern: COMMIT_PATTERN },
  prHead: { source: 'CI_TELEMETRY_PR_HEAD_SHA', pattern: COMMIT_PATTERN },
  prBase: { source: 'CI_TELEMETRY_PR_BASE_SHA', pattern: COMMIT_PATTERN },
  event: { source: 'GITHUB_EVENT_NAME', pattern: EVENT_PATTERN },
  runId: { source: 'GITHUB_RUN_ID', pattern: DIGITS_PATTERN },
  runAttempt: { source: 'GITHUB_RUN_ATTEMPT', pattern: DIGITS_PATTERN },
  job: { source: 'GITHUB_JOB', pattern: JOB_PATTERN },
  runnerOs: { source: 'RUNNER_OS', pattern: RUNNER_OS_PATTERN },
  runnerArch: { source: 'RUNNER_ARCH', pattern: RUNNER_ARCH_PATTERN },
  pnpm: { source: 'CI_TELEMETRY_PNPM_VERSION', pattern: TURBO_VERSION_PATTERN },
  node: { source: '@node', pattern: NODE_VERSION_PATTERN },
};

/**
 * يقرأ بيانات البيئة بالاسم فقط، ويمرّر كل قيمة على مُحقّق حقلها؛ ما لا يجتاز يُسقط.
 */
export function buildMeta(env, nodeVersion) {
  const source = env && typeof env === 'object' ? env : {};
  const meta = {};
  for (const [key, field] of Object.entries(META_FIELDS)) {
    const value = field.source === '@node' ? nodeVersion : source[field.source];
    if (typeof value !== 'string') continue;
    if (!field.pattern.test(value)) continue;
    meta[key] = value;
  }
  return meta;
}

/**
 * ينسخ حقول الـ meta باسمها فقط، فتخرج القيم التي اجتازت مُحقّقها وحدها.
 */
export function copyMeta(meta) {
  const source = meta && typeof meta === 'object' ? meta : {};
  const copied = {};
  for (const [key, field] of Object.entries(META_FIELDS)) {
    const value = source[key];
    if (typeof value === 'string' && field.pattern.test(value)) copied[key] = value;
  }
  return copied;
}
