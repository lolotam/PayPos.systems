import { createHash } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { GetPackageImportTemplateUseCase } from '../use-cases/get-package-import-template/get-package-import-template.usecase.ts';
import { createPackageImportTemplateBuilder } from '../persistence/package-import-template.ts';
import { createPackageImportTemplateTransactions } from '../persistence/package-import-template.transactions.ts';
import { commitUseCase, postCommit, readyPreview } from './package-import-commit.fixture.ts';
import {
  packagePreviewRequestFixture,
  type PackagePreviewRequestFixture,
} from './package-preview-request.fixture.ts';

// الزمن في ملف مستقل بقاعدة نظيفة: الاختبارات الأخرى تستبدل الأذونات والميزات وتؤسس شركات، فتلوّث القياس الدافئ.
// القياس على حالة الاستخدام مباشرة (وسيط دافئ) كما في طلب المعاينة؛ مسار HTTP يُختبر مرة واحدة كدخان،
// فلا يتذبذب الاختبار على مشغّلات CI بسبب تكلفة Better Auth التي لا علاقة لها بزمن الاستعلام.
let f: PackagePreviewRequestFixture;
beforeAll(async () => {
  f = await packagePreviewRequestFixture();
});
afterAll(async () => {
  await f?.close();
});
const median = (times: number[]) =>
  times.toSorted((a, b) => a - b)[Math.floor(times.length / 2)] ?? Infinity;

it('serves the template and the commit request over HTTP once (smoke)', async () => {
  const template = await f.h.app.inject({
    method: 'GET',
    url: `/v1/businesses/${f.businessId}/packages/import/template`,
    headers: f.headers,
  });
  expect(template.statusCode).toBe(200);
  const commit = await postCommit(f, await readyPreview(f), 'smoke-0');
  expect(commit.statusCode).toBe(202);
});

it('keeps the warm template use case below 200 ms', async () => {
  const useCase = new GetPackageImportTemplateUseCase(
    createPackageImportTemplateTransactions(f.database),
    createPackageImportTemplateBuilder(),
  );
  const actor = { companyId: f.companyId, userId: f.userId, businessId: f.businessId };
  await useCase.execute(actor);
  const times: number[] = [];
  for (let run = 0; run < 7; run++) {
    const start = performance.now();
    await useCase.execute(actor);
    times.push(performance.now() - start);
  }
  process.stdout.write(
    `PACKAGE_IMPORT_TEMPLATE_WARM ${JSON.stringify({ warm_ms: times, median_ms: median(times) })}\n`,
  );
  expect(median(times)).toBeLessThan(200);
});

it('keeps the warm first commit request use case below 200 ms', async () => {
  const useCase = commitUseCase(f, () => new Date());
  const command = (previewId: string, key: string) => ({
    companyId: f.companyId,
    userId: f.userId,
    businessId: f.businessId,
    previewId,
    key,
    fingerprint: createHash('sha256').update(`${key}:${previewId}`).digest('hex'),
  });
  const ids: string[] = [];
  for (let run = 0; run < 7; run++) ids.push(await readyPreview(f));
  await useCase.execute(command(ids[0] as string, 'warm-0'));
  const times: number[] = [];
  for (const [index, id] of ids.slice(1).entries()) {
    const start = performance.now();
    await useCase.execute(command(id, `warm-${index + 1}`));
    times.push(performance.now() - start);
  }
  process.stdout.write(
    `PACKAGE_IMPORT_COMMIT_REQUEST_WARM ${JSON.stringify({ warm_ms: times, median_ms: median(times) })}\n`,
  );
  expect(median(times)).toBeLessThan(200);
});
