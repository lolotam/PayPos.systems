import { expect, it } from 'vitest';

import {
  previewCommand,
  serviceImportFixture,
  serviceWorkbook,
  type ImportRow,
} from './service-import.fixture.ts';

// ميزانية الأداء الموثّقة: معاينة 500 صف كاملة — تخزين وتحليل محمي ومطابقة وحفظ — وسطيّ
// خمس جولات مقيسة بعد تسخين واحدة أقل من 200ms (خطة 32b-2/32b-3، CLAUDE.md §6).

it('previews a full 500-row workbook under the 200 ms warm median', async () => {
  const f = await serviceImportFixture();
  try {
    await f.category('Hair', 'شعر');
    await f.category('Nails', 'أظافر');
    await f.service('Existing One');
    const rows: ImportRow[] = Array.from({ length: 500 }, (_: unknown, index: number) => [
      `Imported Service ${String(index + 1).padStart(3, '0')}`,
      index % 2 === 0 ? `خدمة ${index + 1}` : null,
      (index % 50) + 1,
      index % 3 === 0 ? 30 : null,
      index % 5 === 0 ? 'Hair' : index % 7 === 0 ? 'Nails' : null,
      index % 4 === 0 ? 'PCT' : index % 6 === 0 ? 'FIXED' : 'FOLLOW_PLAN',
      index % 4 === 0 ? 12.5 : index % 6 === 0 ? 1.5 : null,
      index % 8 === 0 ? 'no' : null,
    ]);
    const fileId = await f.upload(await serviceWorkbook(rows));
    const command = previewCommand(f, fileId);
    const warmupStart = performance.now();
    const warmup = await f.preview.execute(command);
    const warmupMs = performance.now() - warmupStart;
    expect(warmup.row_count).toBe(500);
    expect(warmup.error_count).toBe(0);
    const samples: number[] = [];
    for (let index = 0; index < 5; index += 1) {
      const start = performance.now();
      const result = await f.preview.execute(command);
      samples.push(performance.now() - start);
      expect(result.row_count).toBe(500);
      expect(result.error_count).toBe(0);
    }
    samples.sort((left, right) => left - right);
    const median = samples[2] ?? Number.POSITIVE_INFINITY;
    console.info(
      JSON.stringify({
        budget_ms: 200,
        warmup_ms: Math.round(warmupMs * 1000) / 1000,
        samples_ms: samples.map((sample) => Math.round(sample * 1000) / 1000),
        median_ms: Math.round(median * 1000) / 1000,
      }),
    );
    expect(median).toBeLessThan(200);
  } finally {
    await f.close();
  }
}, 120_000);
