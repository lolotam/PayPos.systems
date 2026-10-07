import { t } from '@pospay/i18n';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import { ServiceRuleValueField } from './service-rule-value-field';

vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));

it.each([
  ['12.5', '12.500'],
  ['99999999999.999', '99999999999.999'],
  ['1.2345', '1.2345'],
])('normalizes FIXED %s without rounding or floating-point conversion', (input, expected) => {
  const onChange = vi.fn();
  render(
    <ServiceRuleValueField
      kind="FIXED"
      value={{ kind: 'FIXED', value: input }}
      onChange={onChange}
    />,
  );
  fireEvent.blur(screen.getByLabelText(t('en', 'catalogServices.ruleFixed')));
  expect(onChange).toHaveBeenCalledWith({ kind: 'FIXED', value: expected });
});
