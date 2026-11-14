import { afterAll, beforeAll, expect, it } from 'vitest';

import {
  serviceCategoryClosingFixture,
  type SeededCategory,
  type ServiceCategoryClosingFixture,
} from './service-category-closing.fixture.ts';

let f: ServiceCategoryClosingFixture;

beforeAll(async () => {
  f = await serviceCategoryClosingFixture();
});

afterAll(async () => {
  await f?.close();
});

it('closes every open service of the category and audits the category and each service', async () => {
  const category = await f.category({ open: 301 });
  const closingId = await f.closing(category, { action: 'close' });
  const outcome = await f.useCase.execute(f.company, closingId);

  expect(outcome).toEqual({ kind: 'completed', servicesChanged: 301 });
  expect(await f.closingRow(closingId)).toMatchObject({
    status: 'completed',
    services_changed: 301,
    error_code: null,
  });
  const services = await f.serviceRows(category.categoryId);
  expect(services).toHaveLength(301);
  expect(
    services.every(
      (service) =>
        service['closed_at'] !== null && service['closed_by_category_id'] === category.categoryId,
    ),
  ).toBe(true);

  const audits = await f.auditRows(category.categoryId);
  expect(audits.filter((audit) => audit['entity'] === 'service')).toHaveLength(301);
  expect(audits.filter((audit) => audit['entity'] === 'service_category')).toHaveLength(1);
  expect(audits.every((audit) => audit['actor_user_id'] === f.userId)).toBe(true);
});

it('reopens only the services the category itself closed', async () => {
  const category = await f.category({ marked: 4, closedAlone: 2, closed: true });
  const closingId = await f.closing(category, { action: 'reopen' });
  await f.useCase.execute(f.company, closingId);

  expect(await f.closingRow(closingId)).toMatchObject({
    status: 'completed',
    services_changed: 4,
    error_code: null,
  });
  const services = await f.serviceRows(category.categoryId);
  const marked = services.filter((service) =>
    category.markedServiceIds.includes(service['id'] as string),
  );
  const closedAlone = services.filter((service) =>
    category.closedAloneServiceIds.includes(service['id'] as string),
  );
  expect(marked.every((service) => service['closed_at'] === null)).toBe(true);
  expect(marked.every((service) => service['closed_by_category_id'] === null)).toBe(true);
  expect(closedAlone.every((service) => service['closed_at'] !== null)).toBe(true);
  expect(closedAlone.every((service) => service['closed_by_category_id'] === null)).toBe(true);
});

it('changes nothing when the same completed job runs again', async () => {
  const category = await f.category({ open: 3 });
  const closingId = await f.closing(category, { action: 'close' });
  await f.useCase.execute(f.company, closingId);
  const auditsBefore = (await f.auditRows(category.categoryId)).length;

  expect(await f.useCase.execute(f.company, closingId)).toEqual({ kind: 'noop' });

  expect(await f.closingRow(closingId)).toMatchObject({
    status: 'completed',
    services_changed: 3,
    error_code: null,
  });
  expect((await f.auditRows(category.categoryId)).length).toBe(auditsBefore);
});

const failureCases = [
  {
    name: 'a revision the manager no longer confirms',
    code: 'SERVICE_CATEGORY_REVISION_CONFLICT',
    category: { open: 3 },
    closing: (fixture: ServiceCategoryClosingFixture, category: SeededCategory) =>
      fixture.closing(category, { action: 'close', expectedRevision: category.revision + 1 }),
  },
  {
    name: 'a category closed by someone else',
    code: 'SERVICE_CATEGORY_ALREADY_CLOSED',
    category: { open: 3, closed: true },
    closing: (fixture: ServiceCategoryClosingFixture, category: SeededCategory) =>
      fixture.closing(category, { action: 'close' }),
  },
  {
    name: 'a category that is already open',
    code: 'SERVICE_CATEGORY_NOT_CLOSED',
    category: { open: 3 },
    closing: (fixture: ServiceCategoryClosingFixture, category: SeededCategory) =>
      fixture.closing(category, {
        action: 'reopen',
        expectedServiceCount: category.openServiceIds.length,
      }),
  },
  {
    name: 'a count the manager no longer confirms',
    code: 'SERVICE_CATEGORY_COUNT_CHANGED',
    category: { open: 3 },
    closing: (fixture: ServiceCategoryClosingFixture, category: SeededCategory) =>
      fixture.closing(category, {
        action: 'close',
        expectedServiceCount: category.openServiceIds.length + 1,
      }),
  },
  {
    name: 'a job past its deadline',
    code: 'SERVICE_CATEGORY_CLOSING_EXPIRED',
    category: { open: 3 },
    closing: (fixture: ServiceCategoryClosingFixture, category: SeededCategory) =>
      fixture.closing(category, {
        action: 'close',
        deadlineAt: new Date('2026-11-14T09:59:30.000Z'),
      }),
  },
];

it.each(failureCases)(
  'fails $name with its code and changes nothing',
  async ({ code, category, closing }) => {
    const seeded = await f.category(category);
    const closingId = await closing(f, seeded);
    const categoryBefore = await f.categoryRow(seeded.categoryId);
    const servicesBefore = await f.serviceRows(seeded.categoryId);

    await f.useCase.execute(f.company, closingId);

    expect(await f.closingRow(closingId)).toMatchObject({
      status: 'failed',
      services_changed: null,
      error_code: code,
    });
    expect(await f.categoryRow(seeded.categoryId)).toEqual(categoryBefore);
    expect(await f.serviceRows(seeded.categoryId)).toEqual(servicesBefore);
    expect(await f.auditRows(seeded.categoryId)).toEqual([]);
  },
);

it('writes the generic failure on a pending row and leaves a completed row untouched', async () => {
  const pending = await f.category({ open: 2 });
  const pendingId = await f.closing(pending, { action: 'close' });
  await f.useCase.fail(f.company, pendingId, 'SERVICE_CATEGORY_CLOSING_FAILED');
  expect(await f.closingRow(pendingId)).toMatchObject({
    status: 'failed',
    error_code: 'SERVICE_CATEGORY_CLOSING_FAILED',
  });

  const done = await f.category({ open: 2 });
  const doneId = await f.closing(done, { action: 'close' });
  await f.useCase.execute(f.company, doneId);
  await f.useCase.fail(f.company, doneId, 'SERVICE_CATEGORY_CLOSING_FAILED');
  expect(await f.closingRow(doneId)).toMatchObject({
    status: 'completed',
    services_changed: 2,
    error_code: null,
  });
});

it('touches nothing when the job id belongs to another company', async () => {
  const category = await f.category({ open: 3 });
  const closingId = await f.closing(category, { action: 'close' });

  await f.useCase.execute(f.otherCompany, closingId);

  expect(await f.closingRow(closingId)).toMatchObject({
    status: 'pending',
    services_changed: null,
    error_code: null,
  });
  const services = await f.serviceRows(category.categoryId);
  expect(services.every((service) => service['closed_at'] === null)).toBe(true);
  expect(await f.auditRows(category.categoryId)).toEqual([]);
});
