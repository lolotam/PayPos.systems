import { migrateDatabase } from '../src/migrations.ts';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`${name} is not set — see .env.example`);
  }
  return value;
}

await migrateDatabase(requireEnv('MIGRATION_DATABASE_URL'), {
  app: requireEnv('POSTGRES_APP_PASSWORD'),
  auth: requireEnv('POSTGRES_AUTH_PASSWORD'),
  dispatcher: requireEnv('POSTGRES_DISPATCHER_PASSWORD'),
});
console.log('migrations applied');
