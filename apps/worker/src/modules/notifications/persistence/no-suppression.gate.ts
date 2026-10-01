import type { SuppressionGate } from '../ports/suppression-gate.port.ts';

export function noSuppressionGate(mode: 'fake' | 'live', production: boolean): SuppressionGate {
  if (mode !== 'fake' || production) throw new Error('NOTIFICATIONS_SUPPRESSION_REQUIRED');
  return { isSuppressed: async () => false };
}
