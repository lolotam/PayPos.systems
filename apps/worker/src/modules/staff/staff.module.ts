import type { IdGenerator } from '@pospay/db';
import { companyCreatedConsumer } from './events/handlers/on-company-created.handler.ts';
import { createDocumentTypeSeeds } from './persistence/drizzle-document-type-seeds.ts';
import { SeedDocumentTypes } from './use-cases/seed-document-types/seed-document-types.ts';

export function createStaffDocumentDefaults(ids: IdGenerator) {
  return companyCreatedConsumer((tx) => new SeedDocumentTypes(createDocumentTypeSeeds(tx), ids));
}
