import type { Tx } from '@pospay/db';
import { parseMoney } from '@pospay/domain';
import { readPackageTypeForSale, readSessionServices } from '../../catalog/index.ts';
import type { CatalogReaderPort } from '../ports/session-readers.port.ts';
import type { SalePackageComponent } from '../domain/package-sale-types.ts';
import { SessionError } from '../domain/session-error.ts';
import type { SessionRule, SessionService } from '../domain/session-types.ts';

type CatalogService = Awaited<ReturnType<typeof readSessionServices>>[number];

function mapService(row: CatalogService): SessionService {
  let rule: SessionRule;
  switch (row.rule.kind) {
    case 'FOLLOW_PLAN': rule = { kind: 'FOLLOW_PLAN' }; break;
    case 'ZERO': rule = { kind: 'ZERO' }; break;
    case 'PCT': rule = { kind: 'PCT', value: row.rule.value }; break;
    case 'FIXED': rule = { kind: 'FIXED', value: parseMoney(row.rule.value) }; break;
    default: { const unreachable: never = row.rule; throw new Error(`Invalid rule ${unreachable}`); }
  }
  // علامة الإغلاق من الكتالوج مش من حقول سطر الجلسة، فالسطر بياخد حقوله المعلومة بس.
  return {
    id: row.id,
    name_en: row.name_en,
    name_ar: row.name_ar,
    price: parseMoney(row.price),
    rule,
    counts: row.counts,
    revision: row.revision,
  };
}

export function catalogReader(tx: Tx, companyId: string, businessId: string): CatalogReaderPort {
  return {
    lock: async (ids) => { await readSessionServices(tx, companyId, businessId, ids, true); },
    read: async (ids) => {
      const rows = await readSessionServices(tx, companyId, businessId, ids);
      const closed = rows.find((row) => row.closed_at !== null);
      if (closed !== undefined)
        throw new SessionError('SERVICE_CLOSED', { service_id: closed.id });
      return rows.map(mapService);
    },
    readPackageTypeForSale: async (packageTypeId) => {
      const type = await readPackageTypeForSale(tx, companyId, businessId, packageTypeId);
      if (type === null) return null;
      const serviceIds = type.components.map((component) => component.service_id);
      await readSessionServices(tx, companyId, businessId, serviceIds, true);
      const services = new Map<string, SessionService>(
        (await readSessionServices(tx, companyId, businessId, serviceIds)).map(
          (row): [string, SessionService] => [row.id, mapService(row)],
        ),
      );
      const components: SalePackageComponent[] = type.components.map((component) => {
        const service = services.get(component.service_id);
        if (service === undefined) throw new Error('Package component service missing');
        return { service_id: component.service_id, sessions: component.sessions, position: component.position, service };
      });
      return {
        id: type.id,
        name_en: type.name_en,
        name_ar: type.name_ar,
        price: parseMoney(type.price),
        validity_days: type.validity_days,
        revision: type.revision,
        components,
      };
    },
  };
}
