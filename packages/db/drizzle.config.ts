import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './schema/index.ts',
  out: './migrations',
  migrations: { prefix: 'index' },
  dbCredentials: { url: process.env['MIGRATION_DATABASE_URL'] ?? '' },
});
