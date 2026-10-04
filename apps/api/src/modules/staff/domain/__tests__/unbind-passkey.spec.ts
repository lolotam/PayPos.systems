import { describe, expect, it } from 'vitest';
import { bindingAcceptsProof, planPasskeyUnbind } from '../unbind-passkey.ts';
const binding = { id: 'binding-a', revision: 7, unboundAt: null };
const terms = { binding_id: 'binding-a', revision: 7, reason: '  Synthetic replacement  ' };
describe('manager unbind revision fence', () => {
  it('trims reason and invalidates the old revision', () => {
    expect(planPasskeyUnbind(binding, terms, false)).toEqual({
      revision: 8,
      reason: 'Synthetic replacement',
    });
    expect(bindingAcceptsProof(binding, { bindingId: binding.id, bindingRevision: 7 })).toBe(true);
    for (const row of [
      null,
      { ...binding, revision: 8 },
      { ...binding, unboundAt: new Date() },
      { ...binding, id: 'new-binding' },
    ])
      expect(bindingAcceptsProof(row, { bindingId: binding.id, bindingRevision: 7 })).toBe(false);
  });
  it.each(['', '  ', 'x'.repeat(501)])('rejects invalid reason length', (reason) => {
    expect(() => planPasskeyUnbind(binding, { ...terms, reason }, false)).toThrow(
      'VALIDATION_FAILED',
    );
  });
  it.each(['x', 'x'.repeat(500)])('accepts reason boundary', (reason) => {
    expect(planPasskeyUnbind(binding, { ...terms, reason }, false).reason).toBe(reason);
  });
  it('refuses self, stale screens, missing/ended binding and integer overflow', () => {
    expect(() => planPasskeyUnbind(binding, terms, true)).toThrow('PASSKEY_SELF_UNBIND');
    for (const row of [
      null,
      { ...binding, id: 'new' },
      { ...binding, revision: 8 },
      { ...binding, unboundAt: new Date() },
      { ...binding, revision: 2147483647 },
    ])
      expect(() => planPasskeyUnbind(row, terms, false)).toThrow('PASSKEY_REVISION_CONFLICT');
  });
});
