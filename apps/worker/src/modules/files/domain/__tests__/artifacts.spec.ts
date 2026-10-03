import { expect, it } from 'vitest';
import { candidateCleanupAfter, nextArtifactCleanup, stagingExpiry } from '../artifacts.ts';

it('rechecks staging strictly after the full PUT lifetime, then reconciles daily', () => {
  const created = new Date('2026-10-03T00:00:00Z'),
    expiry = stagingExpiry(created);
  expect(expiry).toEqual(new Date('2026-10-03T00:02:01Z'));
  expect(nextArtifactCleanup('STAGING', expiry, created)).toEqual(expiry);
  expect(nextArtifactCleanup('STAGING', expiry, expiry)).toEqual(new Date('2026-10-04T00:02:01Z'));
});
it('waits twenty minutes beyond the verification deadline for candidate IO, retaining tombstones', () => {
  const until = new Date('2026-10-03T00:02:00Z');
  expect(candidateCleanupAfter(until)).toEqual(new Date('2026-10-03T00:22:00Z'));
  expect(nextArtifactCleanup('CANDIDATE', until, until)).toEqual(new Date('2026-10-04T00:02:00Z'));
});
