import type { IdGenerator, Tx } from '@pospay/db';
import { createPackageSlots, moneyToString, parseMoney } from '@pospay/domain';
import { sql } from 'drizzle-orm';
import type { PackageCommitPreview } from '../domain/package-import-commit.ts';
import type { PackageCommitRow } from '../ports/package-import-commit.port.ts';

type ServiceName = { id: string; name_en: string; name_ar: string | null };

export async function insertPackageImport(
  context: {
    tx: Tx;
    ids: IdGenerator;
    company: string;
    preview: PackageCommitPreview;
    names: ReadonlyMap<string, ServiceName>;
  },
  row: PackageCommitRow,
  at: string,
) {
  const { tx, ids, company, preview, names } = context;
  const id = ids.newId();
  const inserted = await tx.execute<{ id: string }>(sql`INSERT INTO package_entitlements
    (company_id,id,business_id,customer_id,provenance,name_en,name_ar,price_paid,
     recorded_by,recorded_by_membership_id,external_ref,import_batch_id,import_row,expires_on,created_at)
    VALUES (${company},${id},${preview.business_id},${row.customer_id},'IMPORTED',${row.name_en},${row.name_ar},
      ${row.price_paid},${preview.created_by},${preview.commit_membership_id},${row.external_ref},${preview.id},
      ${row.import_row},${row.expires_on},${at})
    ON CONFLICT ON CONSTRAINT package_entitlements_external_ref_key DO NOTHING RETURNING id`);
  if (inserted.length === 0) return false;
  const components = row.components.map((component, index) => ({
    ...component,
    id: ids.newId(),
    position: index + 1,
  }));
  // حارس التركيب يقفل إضافة المكونات بعد أول جلسة، لذلك كل المكونات تسبق أول دفعة جلسات.
  await tx.execute(sql`INSERT INTO package_components
    (company_id,id,business_id,entitlement_id,service_id,position,name_en,name_ar,list_price_snapshot,sessions_total,component_value)
    VALUES ${sql.join(
      components.map((c) => {
        const name = names.get(c.service_id);
        if (name === undefined) throw new Error('PACKAGE_COMMIT_SERVICE_NOT_LOCKED');
        return sql`(${company},${c.id},${preview.business_id},${id},${c.service_id},${c.position},
        ${name.name_en},${name.name_ar},${c.list_price_snapshot},${c.sessions},${c.component_value})`;
      }),
      sql`, `,
    )}`);
  for (const c of components) {
    // المكوّن لا يتجاوز 365 جلسة، فكل دفعة تظل تحت حد معاملات PostgreSQL دون تجميع ملايين الجلسات.
    const slots = createPackageSlots(parseMoney(c.component_value), c.sessions, c.remaining, {
      base: parseMoney(c.base_unit_value),
      last: parseMoney(c.last_unit_value),
    });
    await tx.execute(sql`INSERT INTO package_session_slots
      (company_id,id,business_id,entitlement_id,component_id,ordinal,unit_value,state)
      VALUES ${sql.join(
        slots.map(
          (slot) => sql`(${company},${ids.newId()},${preview.business_id},${id},${c.id},
        ${slot.ordinal},${moneyToString(slot.unitValue)},${slot.state})`,
        ),
        sql`, `,
      )}`);
  }
  return true;
}
