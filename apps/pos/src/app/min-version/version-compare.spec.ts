import { describe, expect, it } from 'vitest';

import { isAllowedStoreUrl, isVersionBelowMinimum, parseAppVersion } from './version-compare';

describe('parseAppVersion (VER-T01)', () => {
  it('reads MAJOR.MINOR and MAJOR.MINOR.PATCH', () => {
    expect(parseAppVersion('1.3.0')).toEqual({ major: 1, minor: 3, patch: 0 });
    expect(parseAppVersion('1.10.2')).toEqual({ major: 1, minor: 10, patch: 2 });
    expect(parseAppVersion('12.0')).toEqual({ major: 12, minor: 0, patch: 0 });
  });

  it('reads nothing from a version that is not numbers only', () => {
    expect(parseAppVersion('1.3.0-beta')).toBeNull();
    expect(parseAppVersion('v1.3')).toBeNull();
    expect(parseAppVersion('')).toBeNull();
    expect(parseAppVersion('1..3')).toBeNull();
    expect(parseAppVersion('1')).toBeNull();
    expect(parseAppVersion('1.2.3.4')).toBeNull();
  });

  it('reads nothing from a number too big to be a version', () => {
    expect(parseAppVersion('99999999999999999999.0.0')).toBeNull();
  });
});

describe('isVersionBelowMinimum (VER-T01, VER-T02)', () => {
  it('compares the parts in order, so 1.10.0 is above 1.9.0', () => {
    expect(isVersionBelowMinimum('1.9.0', '1.10.0')).toBe(true);
    expect(isVersionBelowMinimum('1.10.0', '1.9.0')).toBe(false);
  });

  it('counts a missing patch as zero', () => {
    expect(isVersionBelowMinimum('1.3', '1.3.0')).toBe(false);
    expect(isVersionBelowMinimum('1.2', '1.3.0')).toBe(true);
    expect(isVersionBelowMinimum('1.3.0', '1.3')).toBe(false);
  });

  it('blocks only a version below the minimum', () => {
    expect(isVersionBelowMinimum('1.2.9', '1.3.0')).toBe(true);
    expect(isVersionBelowMinimum('1.3.0', '1.3.0')).toBe(false);
    expect(isVersionBelowMinimum('1.4.0', '1.3.0')).toBe(false);
    expect(isVersionBelowMinimum('2.0.0', '1.3.0')).toBe(false);
  });

  it('blocks nothing when a version cannot be read', () => {
    expect(isVersionBelowMinimum('1.3.0-beta', '1.3.0')).toBe(false);
    expect(isVersionBelowMinimum('1.3.0', '')).toBe(false);
  });
});

describe('isAllowedStoreUrl (VER-T03)', () => {
  it('accepts the three store hosts over https', () => {
    expect(isAllowedStoreUrl('https://apps.apple.com/app/id1')).toBe(true);
    expect(isAllowedStoreUrl('https://testflight.apple.com/join/abc')).toBe(true);
    expect(isAllowedStoreUrl('https://play.google.com/store/apps/details?id=x')).toBe(true);
  });

  it('refuses http, a lookalike host and another site', () => {
    expect(isAllowedStoreUrl('http://apps.apple.com/app/id1')).toBe(false);
    expect(isAllowedStoreUrl('https://apps.apple.com.evil.example/app/id1')).toBe(false);
    expect(isAllowedStoreUrl('https://evil.example/app/id1')).toBe(false);
    expect(isAllowedStoreUrl('https://play.google.com.evil.example/x')).toBe(false);
    expect(isAllowedStoreUrl('not a url')).toBe(false);
    expect(isAllowedStoreUrl('')).toBe(false);
  });
});
