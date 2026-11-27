import { describe, expect, it } from 'vitest';

import { buildOpenApiDocument } from '../openapi.js';
import { setBranchOpeningHoursInput } from './branch.js';

const day = (weekday: number, opens = '09:00', closes = '17:00') => ({
  weekday,
  intervals: [{ opens, closes }],
});

describe('setBranchOpeningHoursInput', () => {
  it('accepts a week of hours and an explicit null that clears them', () => {
    expect(setBranchOpeningHoursInput.safeParse({ opening_hours: [day(1), day(2)] }).success).toBe(
      true,
    );
    expect(setBranchOpeningHoursInput.safeParse({ opening_hours: null }).success).toBe(true);
  });

  it('refuses a missing key, an unknown key and overlapping intervals', () => {
    expect(setBranchOpeningHoursInput.safeParse({}).success).toBe(false);
    expect(setBranchOpeningHoursInput.safeParse({ opening_hours: [], extra: 1 }).success).toBe(
      false,
    );
    const overlapping = {
      weekday: 1,
      intervals: [
        { opens: '09:00', closes: '13:00' },
        { opens: '12:00', closes: '15:00' },
      ],
    };
    expect(setBranchOpeningHoursInput.safeParse({ opening_hours: [overlapping] }).success).toBe(
      false,
    );
  });

  it('refuses a repeated weekday and a malformed clock', () => {
    expect(setBranchOpeningHoursInput.safeParse({ opening_hours: [day(1), day(1)] }).success).toBe(
      false,
    );
    expect(
      setBranchOpeningHoursInput.safeParse({ opening_hours: [day(1, '9:00', '17:00')] }).success,
    ).toBe(false);
  });

  it('publishes SetBranchOpeningHoursInput.opening_hours as a nullable array without allOf in OpenAPI 3.0.3', () => {
    const components = buildOpenApiDocument()['components'] as {
      schemas: Record<string, { properties?: Record<string, Record<string, unknown>> }>;
    };
    const openingHoursProp =
      components.schemas['SetBranchOpeningHoursInput']?.properties?.['opening_hours'];
    expect(openingHoursProp).toMatchObject({ type: 'array', nullable: true });
    expect(openingHoursProp).not.toHaveProperty('allOf');
  });
});
