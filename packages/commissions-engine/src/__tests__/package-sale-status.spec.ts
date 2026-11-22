import { describe, expect, it } from 'vitest';

import { projectPackageSaleStatus } from '../package-sale-status.ts';

describe('projectPackageSaleStatus', () => {
  it('turns the stored SOLD status into the engine ACTIVE status', () => {
    expect(projectPackageSaleStatus('SOLD')).toBe('ACTIVE');
  });

  it('keeps a cancelled sale out of pricing', () => {
    expect(projectPackageSaleStatus('CANCELLED')).toBe('CANCELLED');
  });

  it('treats any unknown stored status as cancelled so an unknown value never prices money', () => {
    expect(projectPackageSaleStatus('REFUNDED')).toBe('CANCELLED');
  });
});
