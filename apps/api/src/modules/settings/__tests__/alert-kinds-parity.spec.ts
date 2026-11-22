import { expect, it } from 'vitest';
import { ALERT_KINDS_LIST } from '@pospay/db';
import { alertKind } from '@pospay/contracts';
import { ALERT_KINDS } from '@pospay/domain';

// FR-B16: قائمة أنواع التنبيهات لازم تكون متطابقة في الطبقات التلاتة — الـ domain (مصدر القرار)،
// الـ contracts (الشاشة بتكتب بيها)، و CHECK القاعدة. لو واحدة زادت لوحدها، إما الشاشة هتعرض نوع
// قاعدته مش بتتحفظ، أو القاعدة هترفض نوع الشاشة بتعرضه.
it('the alert kind list is identical in domain, contracts and the SQL CHECK', () => {
  const kinds = [...ALERT_KINDS];
  expect([...alertKind.options]).toEqual(kinds);
  const sqlKinds = (ALERT_KINDS_LIST.match(/'([A-Z_]+)'/g) ?? []).map((quoted) => quoted.slice(1, -1));
  expect(sqlKinds).toEqual(kinds);
});
