import { expect, it } from 'vitest';
import { overrideRuleText } from '../override-rule-text';

it('shows a fixed amount in KWD with three decimals and a thousands separator', () => {
  expect(overrideRuleText({ kind: 'FIXED', value: '1234.500' }, 'en')).toBe('1,234.500');
  expect(overrideRuleText({ kind: 'FIXED', value: '1234.500' }, 'ar')).toBe('1,234.500');
});

it('shows a percentage as a percent string, not as basis points', () => {
  expect(overrideRuleText({ kind: 'PCT', value: 1500 }, 'en')).toBe('15.00%');
  expect(overrideRuleText({ kind: 'PCT', value: 1 }, 'ar')).toBe('0.01%');
  expect(overrideRuleText({ kind: 'PCT', value: 10_000 }, 'en')).toBe('100.00%');
});

it('uses the catalog labels for the two kinds without a value, in both languages', () => {
  expect(overrideRuleText({ kind: 'FOLLOW_PLAN' }, 'en')).toBe('Follow plan');
  expect(overrideRuleText({ kind: 'FOLLOW_PLAN' }, 'ar')).toBe('حسب الخطة');
  expect(overrideRuleText({ kind: 'ZERO' }, 'en')).toBe('No commission');
  expect(overrideRuleText({ kind: 'ZERO' }, 'ar')).toBe('بدون عمولة');
});
