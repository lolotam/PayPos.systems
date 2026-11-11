import { afterAll, beforeAll, expect, it } from 'vitest';
import { ids, must, type SessionFixture } from './session.fixture.ts';
import { packageLine } from './package-redemption.fixture.ts';
import { sessionPlace } from '../persistence/session-place.adapter.ts';
import {
  CustomerPackagesQueryHandler,
  type CustomerPackageScope,
} from '../queries/customer-packages.query.ts';
import {
  timeScenarioFixture,
  type TimeScenarioFixtureResult,
} from './customer-packages-scenarios.fixture.ts';

let fixture: TimeScenarioFixtureResult;
let f: SessionFixture;
let handler: CustomerPackagesQueryHandler;
let at: Date;

beforeAll(async () => {
  fixture = await timeScenarioFixture();
  f = fixture.f;
  at = new Date('2026-10-15T08:00:00.000Z');
  // ربط المعالج بمحول المكان الحقيقي الذي يستخرج توقيت الفرع الفعلي
  handler = new CustomerPackagesQueryHandler(
    f.db,
    {
      place: (tx, scope) =>
        sessionPlace(tx, scope.companyId, scope.businessId, scope.branchId).branchTimezone(),
    },
    { now: () => at },
  );
});

afterAll(async () => {
  await f?.close();
});

it('evaluates expiry day inclusively in branch-local time', async () => {
  const pacificScope: CustomerPackageScope = {
    companyId: f.company,
    userId: f.userId,
    businessId: f.business,
    branchId: fixture.pacificBranch,
    customerId: f.customer,
  };

  // منتصف نهار يوم الانتهاء في توقيت كيريباتي (+14) يوافق 2026-11-09T22:00:00Z
  at = new Date('2026-11-09T22:00:00.000Z');
  const pageOnExpiry = await handler.execute(pacificScope, { limit: 20 });
  const t1OnExpiry = must(pageOnExpiry.items.find((i) => i.id === fixture.packageT1));
  expect(t1OnExpiry.expired).toBe(false);
  expect(t1OnExpiry.used_up).toBe(false);

  // اليوم التالي في توقيت كيريباتي (+14) يوافق 2026-11-10T22:00:00Z -> منتهية وترتب أخيراً
  at = new Date('2026-11-10T22:00:00.000Z');
  const pageAfterExpiry = await handler.execute(pacificScope, { limit: 20 });
  const t1AfterExpiry = must(pageAfterExpiry.items.find((i) => i.id === fixture.packageT1));
  expect(t1AfterExpiry.expired).toBe(true);
  expect(pageAfterExpiry.items[pageAfterExpiry.items.length - 1]?.id).toBe(fixture.packageT1);
});

it('proves branch timezone override wins at midnight rollover', async () => {
  const pacificScope: CustomerPackageScope = {
    companyId: f.company,
    userId: f.userId,
    businessId: f.business,
    branchId: fixture.pacificBranch,
    customerId: f.customer,
  };
  const kuwaitScope: CustomerPackageScope = {
    ...pacificScope,
    branchId: f.branch,
  };

  // منتصف الليل الفاصل بين 10 و11 نوفمبر في كيريباتي (+14) يوافق تماماً 2026-11-10T10:00:00Z
  // قبل منتصف الليل بدقيقة في كيريباتي (23:59): اليوم لا يزال 10 نوفمبر -> غير منتهية
  at = new Date('2026-11-10T09:59:00.000Z');
  const beforeMidnight = await handler.execute(pacificScope, { limit: 20 });
  expect(must(beforeMidnight.items.find((i) => i.id === fixture.packageT1)).expired).toBe(false);

  // بعد منتصف الليل بدقيقة في كيريباتي (00:01): دخل 11 نوفمبر -> منتهية
  at = new Date('2026-11-10T10:01:00.000Z');
  const afterMidnight = await handler.execute(pacificScope, { limit: 20 });
  expect(must(afterMidnight.items.find((i) => i.id === fixture.packageT1)).expired).toBe(true);

  // في نفس اللحظة بالضبط، توقيت الكويت (+3) لا يزال 13:01 ظهر يوم 10 نوفمبر -> غير منتهية
  const kuwaitAtSameInstant = await handler.execute(kuwaitScope, { limit: 20 });
  expect(must(kuwaitAtSameInstant.items.find((i) => i.id === fixture.packageT1)).expired).toBe(false);
});

it('handles rank changes between pagination requests (D5 policy) cleanly to termination', async () => {
  at = new Date('2026-10-15T08:00:00.000Z');
  const scope: CustomerPackageScope = {
    companyId: f.company,
    userId: f.userId,
    businessId: f.business,
    branchId: f.branch,
    customerId: f.customer,
  };

  // قراءة الصفحة الأولى
  const page1 = await handler.execute(scope, { limit: 1 });
  expect(page1.items[0]?.id).toBe(fixture.packagesD.d1);
  expect(page1.items[0]?.used_up).toBe(false);
  expect(page1.next_cursor).not.toBeNull();

  // استهلاك كامل جلسات الباقة d2 اللاحقة عبر فحص الاستقبال فتتغير رتبتها من 0 إلى 1
  await f.create.execute({
    ...f.context(ids.newId()),
    input: f.body([packageLine(f, fixture.packagesD.d2)]),
  });

  // متابعة التصفح بالمؤشر: يستمر بدون خطأ وينتهي بـ next_cursor: null
  const pages = [page1];
  let cursor = page1.next_cursor;
  while (cursor !== null) {
    const nextPage = await handler.execute(scope, { limit: 1, cursor });
    pages.push(nextPage);
    cursor = nextPage.next_cursor;
  }

  expect(cursor).toBeNull();
  // الباقة d2 تظهر في إحدى الصفحات اللاحقة معبرة عن حالتها المستهلكة في وقت طلبها
  const d2Page = must(pages.find((p) => p.items.some((i) => i.id === fixture.packagesD.d2)));
  const d2Item = must(d2Page.items.find((i) => i.id === fixture.packagesD.d2));
  expect(d2Item.used_up).toBe(true);
});
