import { seedReferenceData } from '../src/seed.ts';

const url = process.env['MIGRATION_DATABASE_URL'];
if (url === undefined || url === '') {
  throw new Error('MIGRATION_DATABASE_URL is not set — see .env.example');
}
await seedReferenceData(url);
console.log('reference data seeded');
