import config, { allowDatabaseFacade } from '@pospay/config/eslint';

export default [
  ...config,
  allowDatabaseFacade(['createAuthDatabase', 'createStaffOtpDatabase'], { credentials: true }),
  {
    // PP-58.3: the staging identity read is the one auth file allowed to reach the operator subpath of @pospay/db.
    files: ['src/operator/staging-staff-identity.ts'],
    ...allowDatabaseFacade(['createAuthDatabase'], { credentials: true, operator: true }),
  },
];
