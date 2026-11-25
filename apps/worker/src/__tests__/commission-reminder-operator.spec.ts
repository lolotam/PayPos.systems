import { describe, expect, it } from 'vitest';

import {
  checkRecoveryPrerequisites,
  RECOVERY_FUNCTION_MISSING,
  RECOVERY_POLICY_MISSING,
  RECOVERY_PROBE_FAILED,
} from '../commission-reminder-operator.ts';

const OK_ROW = { function_ok: true, policy_ok: true };

describe('checkRecoveryPrerequisites', () => {
  it('passes when the function, its owner role, the policy and the probe are all there', async () => {
    const queries: string[] = [];
    const result = await checkRecoveryPrerequisites(async (text) => {
      queries.push(text);
      return [OK_ROW];
    });

    expect(result).toBeNull();
    expect(queries[0]).toContain('pg_proc');
    expect(queries[0]).toContain('to_regprocedure');
    expect(queries[0]).toContain('has_function_privilege');
    expect(queries[0]).toContain('pospay_recovery_company_reader');
    expect(queries[0]).toContain('companies_recovery_select');
    expect(queries[1]).toContain('recovery_company_ids');
  });

  it('uses the dispatcher probe callback when provided and refuses when it fails (P3-1)', async () => {
    const queries: string[] = [];
    const ok = await checkRecoveryPrerequisites(
      async (text) => {
        queries.push(text);
        return [OK_ROW];
      },
      async () => ['c1'],
    );
    expect(ok).toBeNull();
    expect(queries).toHaveLength(1);

    const fail = await checkRecoveryPrerequisites(
      async () => [OK_ROW],
      async () => Promise.reject(new Error('permission denied for function')),
    );
    expect(fail).toBe(RECOVERY_PROBE_FAILED);
  });
});

describe('checkRecoveryPrerequisites — failure modes', () => {
  it('refuses when the reading function is missing or owned by another role', async () => {
    const result = await checkRecoveryPrerequisites(async () => [
      { function_ok: false, policy_ok: true },
    ]);

    expect(result).toBe(RECOVERY_FUNCTION_MISSING);
  });

  it('refuses when the RLS policy on companies is missing', async () => {
    const result = await checkRecoveryPrerequisites(async () => [
      { function_ok: true, policy_ok: false },
    ]);

    expect(result).toBe(RECOVERY_POLICY_MISSING);
  });

  it('refuses when the probe call itself fails', async () => {
    let calls = 0;
    const result = await checkRecoveryPrerequisites(async () => {
      calls += 1;
      if (calls > 1) throw new Error('probe failed');
      return [OK_ROW];
    });

    expect(result).toBe(RECOVERY_PROBE_FAILED);
  });

  it('stops at the first missing prerequisite without touching the scheduler', async () => {
    let calls = 0;
    const result = await checkRecoveryPrerequisites(async () => {
      calls += 1;
      return [{ function_ok: false, policy_ok: true }];
    });

    expect(result).toBe(RECOVERY_FUNCTION_MISSING);
    expect(calls).toBe(1);
  });
});
