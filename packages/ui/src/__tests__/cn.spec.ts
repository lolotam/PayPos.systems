import { expect, it } from 'vitest';

import { cn } from '../shared/cn.js';

it('merges conflicting logical utilities while preserving independent sides and variants', () => {
  expect(cn('ps-2 pe-3', ['ps-4'], { 'font-bold': true, hidden: false }, null)).toBe(
    'pe-3 ps-4 font-bold',
  );
  expect(cn('md:ms-2 ms-1', 'md:ms-4')).toBe('ms-1 md:ms-4');
});
