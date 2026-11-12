import { readFileSync } from 'node:fs';

import type postgres from 'postgres';

const DRAFT = new URL(
  '../../../docs/specs/058-packages-sell-redeem/45-extension-migration.draft.sql',
  import.meta.url,
);

export async function ensurePackageExtensionDraft(owner: postgres.Sql): Promise<void> {
  const [existing] = await owner<{ relation: string | null }[]>`
    SELECT to_regclass('public.package_extensions') AS relation`;
  if (existing?.relation !== null && existing?.relation !== undefined) return;
  if (process.env['CI'] !== undefined) {
    throw new Error('PACKAGE_EXTENSION_FINAL_MIGRATION_REQUIRED');
  }
  await owner.unsafe(readFileSync(DRAFT, 'utf8'));
}
