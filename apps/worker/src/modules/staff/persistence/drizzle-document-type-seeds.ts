import type { Tx } from '@pospay/db';
import { t } from '@pospay/i18n';
import { sql } from 'drizzle-orm';
import type { DocumentTypeSeeds } from '../ports/document-type-seeds.port.ts';

export function createDocumentTypeSeeds(tx: Tx): DocumentTypeSeeds {
  return {
    insertMissing: async (types) => {
      const rows = types.map(({ name_key, ...type }) => ({
        ...type,
        name_en: t('en', `employeeDocuments.${name_key}`),
        name_ar: t('ar', `employeeDocuments.${name_key}`),
      }));
      const inserted =
        await tx.execute(sql`INSERT INTO document_types(company_id,id,code,name_en,name_ar,alert_days,requires_expiry)
        SELECT app_company_id(), t.id, t.code, t.name_en, t.name_ar, t.alert_days, t.requires_expiry
        FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb)
          AS t(id uuid, code text, name_en text, name_ar text, alert_days int, requires_expiry boolean)
        ON CONFLICT (company_id, code) DO NOTHING RETURNING id`);
      return inserted.length;
    },
  };
}
