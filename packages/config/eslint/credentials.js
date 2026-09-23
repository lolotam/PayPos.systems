// CLAUDE.md §8, plan T9b: only packages/auth issues or verifies a session, hashes a password or hashes a PIN. These are
// the imports that could do it anywhere else — shared by the base config and by the layer overrides that replace
// no-restricted-imports (use-cases/), so the ban cannot be dropped by accident.
const MESSAGE =
  'hashing a password or a PIN, and Better Auth itself, belong to packages/auth (CLAUDE.md §8).';

// Password-grade functions of node:crypto; `default` and namespace imports are refused too, since either reaches them.
const CRYPTO_NAMES = [
  'scrypt',
  'scryptSync',
  'pbkdf2',
  'pbkdf2Sync',
  'argon2',
  'argon2Sync',
  'default',
];

const PACKAGES = ['bcrypt', 'bcryptjs', 'argon2', 'scrypt-js', 'better-auth'];
const PATTERNS = [
  'better-auth/*',
  '@better-auth/*',
  '@node-rs/argon2*',
  '@node-rs/bcrypt*',
  '@noble/hashes/scrypt*',
  '@noble/hashes/argon2*',
  '@noble/hashes/pbkdf2*',
];

/** no-restricted-imports `paths` entries. */
export const CREDENTIAL_PATHS = [
  ...PACKAGES.map((name) => ({ name, message: MESSAGE })),
  ...['node:crypto', 'crypto'].map((name) => ({
    name,
    importNames: CRYPTO_NAMES,
    message: MESSAGE,
  })),
];

/** no-restricted-imports `patterns` entries. */
export const CREDENTIAL_PATTERNS = [{ group: PATTERNS, message: MESSAGE }];

// import('…') and require('…') of the same modules — no-restricted-imports sees static imports only.
const DYNAMIC =
  '/^((node:)?crypto|bcrypt|bcryptjs|argon2|scrypt-js|better-auth(\\/.*)?|@better-auth\\/.*|@node-rs\\/(argon2|bcrypt).*|@noble\\/hashes\\/(scrypt|argon2|pbkdf2).*)$/';

/** no-restricted-syntax entries for dynamic imports and require() of the credential modules. */
export const CREDENTIAL_SYNTAX = [
  { selector: `ImportExpression[source.value=${DYNAMIC}]`, message: MESSAGE },
  {
    selector: `CallExpression[callee.name='require'][arguments.0.value=${DYNAMIC}]`,
    message: MESSAGE,
  },
];
