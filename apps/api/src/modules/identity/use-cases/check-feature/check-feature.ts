import type { AccessReader } from '../../ports/access-reader.port.ts';

// Checks a feature flag for a company the access step already verified (09 §12, SPEC §4).
export class CheckFeature {
  readonly #reader: AccessReader;

  constructor(reader: AccessReader) {
    this.#reader = reader;
  }

  /**
   * @param companyId the verified company
   * @param flag      the module's feature flag
   * @returns true when an unexpired override, or else the plan, enables it
   */
  execute(companyId: string, flag: string): Promise<boolean> {
    return this.#reader.isFeatureEnabled(companyId, flag);
  }
}
