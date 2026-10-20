import type { TenantWrappers } from '@pospay/db';
import type postgres from 'postgres';
import { expect } from 'vitest';
import { applyChange, performer, type Person } from '../../../../../../packages/db/test/service-line-performer-change.ts';
import { ids, must } from './session.fixture.ts';

/** ما يحتاجه زرع تغيير المنفّذين: الشركة والنطاق وعضوية صاحب التغيير. */
export type PerformerChangeHost = {
  db: TenantWrappers;
  h: { owner: postgres.Sql };
  company: string;
  business: string;
  branch: string;
  changerUserId: string;
  changerMembershipId: string;
};

/**
 * يستبدل مجموعة منفّذات سطر بتغيير حقيقي في تاريخ تغيير المنفّذين.
 * الكتابة تمر على applyChange وحده، فالمسار المحمي والتريغرات تطبقان كما في الكاتب الحقيقي.
 *
 * @param host الشركة والنطاق وعضوية صاحب التغيير
 * @param sessionId هوية الزيارة التي ينتمي إليها السطر
 * @param lineId هوية السطر الذي تُستبدل منفّذاته
 * @param fromRevision النسخة التي يجب أن يكون عليها السطر
 * @param next المجموعة الجديدة كاملة، مرتبةً بالأرقام
 * @returns يكتمل التغيير ويرتفع نسخ السطر
 */
export async function replacePerformers(
  host: PerformerChangeHost,
  sessionId: string,
  lineId: string,
  fromRevision: number,
  next: readonly Person[],
): Promise<void> {
  const [line] = await host.h.owner`SELECT service_id,revision FROM service_lines WHERE company_id=${host.company} AND id=${lineId}`;
  const current = must(line);
  expect(Number(current['revision'])).toBe(fromRevision);
  const before = await livePeople(host, lineId);
  await host.db.withTenant(
    host.company,
    (tx) =>
      applyChange(
        tx,
        {
          company: host.company,
          business: host.business,
          branch: host.branch,
          userId: host.changerUserId,
          membershipId: host.changerMembershipId,
          sessionId,
          serviceId: String(current['service_id']),
        },
        ids,
        {
          lineId,
          previous: fromRevision,
          revision: fromRevision + 1,
          before,
          live: next,
          after: next,
          warning: next.some((person) => person.clock || person.leave),
        },
      ),
    { userId: host.changerUserId },
  );
}

/**
 * يبني شخصاً من صف الموظفة كما هو الآن، ورابطه هو رابطه الحالي وقت التغيير.
 *
 * @param host الشركة التي تنتمي إليها الموظفة
 * @param employeeId هوية الموظفة
 * @param ordinal رقم الترتيب في السطر الجديد
 * @param share نسبة الحصة بال basis points
 * @returns صف المنفّذة كما يُزرع في السطر والتاريخ
 */
export async function employeePerson(
  host: PerformerChangeHost,
  employeeId: string,
  ordinal = 1,
  share = 10000,
): Promise<Person> {
  const [row] = await host.h.owner`SELECT name_en,name_ar,user_id FROM employees WHERE company_id=${host.company} AND id=${employeeId}`;
  const employee = must(row);
  return performer(employeeId, {
    ordinal,
    share,
    userId: textOrNull(employee['user_id']),
    nameEn: String(employee['name_en']),
    nameAr: textOrNull(employee['name_ar']),
    snapshotted: true,
  });
}

async function livePeople(host: PerformerChangeHost, lineId: string): Promise<Person[]> {
  const rows = await host.h.owner`SELECT employee_id,performer_ordinal,share_bps,linked_user_id,linked_user_snapshotted,
    name_en,name_ar,not_clocked_in_warning,approved_leave_warning
    FROM line_performers WHERE company_id=${host.company} AND line_id=${lineId} ORDER BY performer_ordinal`;
  return rows.map((row) =>
    performer(String(row['employee_id']), {
      ordinal: Number(row['performer_ordinal']),
      share: Number(row['share_bps']),
      userId: textOrNull(row['linked_user_id']),
      nameEn: String(row['name_en']),
      nameAr: textOrNull(row['name_ar']),
      snapshotted: row['linked_user_snapshotted'] === true,
      clock: row['not_clocked_in_warning'] === true,
      leave: row['approved_leave_warning'] === true,
    }),
  );
}

function textOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}
