import { systemUuidV7 } from '@pospay/ids';
import { approvePhoneBinding } from '@pospay/auth';
import { phoneLockKey } from '@pospay/notifications';

try {
  await approvePhoneBinding({
    databaseUrl: process.env['AUTH_DATABASE_URL'] ?? '',
    userId: process.env['STAFF_PHONE_USER_ID'] ?? '',
    phone: process.env['STAFF_PHONE_NUMBER'] ?? '',
    operator: process.env['OPERATOR_ID'] ?? '',
    ownershipVerified: process.env['STAFF_PHONE_OWNERSHIP_VERIFIED'] === 'true',
    approved: process.env['STAFF_PHONE_BINDING_APPROVED'] === 'true',
    ids: systemUuidV7(),
    phoneLockKey,
  });
  console.log('approved phone binding recorded');
} catch {
  console.error('phone binding refused');
  process.exitCode = 1;
}
