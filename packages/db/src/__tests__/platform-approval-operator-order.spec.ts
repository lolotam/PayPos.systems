import { readFileSync } from 'node:fs';

import { expect, it } from 'vitest';

// ترتيب معاملة أمر المشغّل (بلا قاعدة بيانات): حل هوية المشغّل وفحص منحته منصّتان بعد قفل صف
// الحالة وبقبل أي bump — إبطال تُسحب أثناء انتظار القفل لابد أن تُرفض، لا أن تعدي القفل.
// سباق الإلغاء الفعلي أثناء الانتظار يبقى اختبار تكامل على Postgres؛ هذا يثبت الترتيب الثابت.

const source = readFileSync(
  new URL('../platform-commission-approval.ts', import.meta.url),
  'utf8',
)
  // التعليقات لا تُحسب: الترتيب المهم هو ترتيب الجمل الفعلية في معاملة begin.
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|\s)\/\/[^\n]*/g, '$1');

const beginBody = source.slice(source.indexOf('await client.begin'));
const lockIndex = beginBody.indexOf('FOR UPDATE');
const operatorIndex = beginBody.indexOf('assertPlatformOperator(tx');
const bumpIndex = beginBody.indexOf('SET generation = generation + 1');
const auditIndex = beginBody.indexOf('platform_audit_log');

it('resolves the operator identity after the state-row lock and before the bump and audit', () => {
  expect(lockIndex).toBeGreaterThan(-1);
  expect(operatorIndex).toBeGreaterThan(-1);
  expect(bumpIndex).toBeGreaterThan(-1);
  expect(auditIndex).toBeGreaterThan(-1);
  expect(operatorIndex, 'operator check must follow the state-row lock').toBeGreaterThan(lockIndex);
  expect(bumpIndex, 'the generation bump must follow the operator check').toBeGreaterThan(
    operatorIndex,
  );
  expect(auditIndex, 'the audit row must follow the operator check').toBeGreaterThan(operatorIndex);
});

it('compares the grant expiry with clock_timestamp() taken after the lock, never with now()', () => {
  // clock_timestamp() هو الزمن الفعلي بعد انتظار القفل؛ now() يتجمد على بداية المعاملة فتعدى
  // منحة تنتهي أثناء الانتظار. الفحص محصور في جملة platform_grants نفسها: لو سقطت شرط الانتهاء
  // كلها يفشل، ولا يقفز إلى clock_timestamp() في جملة لاحقة في الملف.
  const from = source.indexOf('FROM platform_grants');
  const limitAt = source.indexOf('LIMIT 1', from);
  expect(from).toBeGreaterThan(-1);
  expect(limitAt).toBeGreaterThan(from);
  const grantQuery = source.slice(from, limitAt + 'LIMIT 1'.length);
  expect(grantQuery).toContain('clock_timestamp()');
  expect(grantQuery, 'the post-lock expiry check must not use now()').not.toContain('now()');
});
