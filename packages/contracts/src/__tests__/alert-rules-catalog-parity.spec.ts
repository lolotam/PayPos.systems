import { expect, it } from 'vitest';

// الاختبار ده هو الحارس الوحيد إن كتالوج الأنواع في العقد زي الدومين بالظبط (spec 060 D-B13، 057-3b):
// لو حد زوّد نوع في طرف ونسي التاني، الـ parity هنا يقع فوراً.
// @pospay/domain مش معلنة كاعتماد للحزمة دي (dependencies فيها zod بس)، فالمصدر بيتقري نسبياً.
import {
  ALERT_CHANNELS,
  ALERT_KIND_DEFINITIONS,
  ALERT_KINDS,
  ALERT_RECIPIENT_ROLES,
} from '../../../domain/src/alert-rules.js';
import { alertChannel, alertKind, alertRecipientRole, setAlertRulesInput } from '../index.js';

it('the contract alertKind enum equals the domain ALERT_KINDS exactly, in order', () => {
  expect(alertKind.options).toEqual([...ALERT_KINDS]);
  expect(alertKind.options).toContain('DISCOUNT_SELF_APPROVED');
});

it('recipient roles and channels enums equal the domain lists', () => {
  expect(alertRecipientRole.options).toEqual([...ALERT_RECIPIENT_ROLES]);
  expect(alertChannel.options).toEqual([...ALERT_CHANNELS]);
});

it('the 057-3b kind defaults to owner only with no timing, like the domain definition (DA-Q10, DA-Q11)', () => {
  const definition = ALERT_KIND_DEFINITIONS.DISCOUNT_SELF_APPROVED;
  expect(definition.defaults).toEqual({
    enabled: true,
    recipientRoles: ['owner'],
    channels: ['IN_APP'],
    delayMinutes: null,
    leadMinutes: null,
  });
});

const ruleInput = (kind: (typeof ALERT_KINDS)[number]) => ({
  kind,
  enabled: true,
  recipient_roles: ['owner' as const],
  channels: ['IN_APP' as const],
  delay_minutes: null,
  lead_minutes: null,
  expected_revision: null,
  expected_rule_id: null,
});

it('a batch of all 15 kinds is accepted', () => {
  const result = setAlertRulesInput.safeParse({ rules: ALERT_KINDS.map(ruleInput) });
  expect(result.success).toBe(true);
});

it('a batch of 16 rules is rejected by the array-size bound itself, not only by kind uniqueness', () => {
  const rules = [...ALERT_KINDS.map(ruleInput), ruleInput('DISCOUNT_SELF_APPROVED')];
  const result = setAlertRulesInput.safeParse({ rules });
  expect(result.success).toBe(false);
  if (result.success) throw new Error('a 16-rule batch must not parse');
  // النوع المكرر بيرفض برضه، فالحارس هنا قصدُه حد المصفوفة نفسه: لو max(15) اتشال، مش هيطلع غير رفض التكرار.
  expect(result.error.issues).toContainEqual(
    expect.objectContaining({ code: 'too_big', path: ['rules'], maximum: 15 }),
  );
});
