import { expect, it } from 'vitest';
import { acceptableLogoFile, LOGO_MAX_BYTES } from './logo-file';

it('accepts a png or jpeg inside the shared file cap', () => {
  expect(acceptableLogoFile({ type: 'image/png', size: 1 })).toBe(true);
  expect(acceptableLogoFile({ type: 'image/jpeg', size: LOGO_MAX_BYTES })).toBe(true);
  expect(acceptableLogoFile({ type: 'image/webp', size: 10 })).toBe(false);
  expect(acceptableLogoFile({ type: 'image/png', size: LOGO_MAX_BYTES + 1 })).toBe(false);
  expect(acceptableLogoFile(null)).toBe(false);
});
