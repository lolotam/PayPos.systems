import { parseArgs } from 'node:util';

import { systemUuidV7 } from '@pospay/ids';

import { coverageIssuanceFailure } from '../src/commission-coverage-issuer.ts';
import { parseExpiry } from '../src/coverage-operator-input.ts';
import {
  setCommissionApprovalSwitch,
  showCommissionApprovalSwitch,
} from '../src/platform-commission-approval.ts';

// مسار operator فقط، بنفس اتصال platform:grant؛ البريد لا يخرج من حل الهوية إلى السجل أو الطباعة.

try {
  const { values } = parseArgs({
    options: {
      company: { type: 'string' },
      enable: { type: 'boolean' },
      disable: { type: 'boolean' },
      show: { type: 'boolean' },
      reason: { type: 'string' },
      'operator-email': { type: 'string' },
      expires: { type: 'string' },
    },
  });
  const companyId = values.company ?? '';
  const url = process.env['MIGRATION_DATABASE_URL'];
  if (
    !url ||
    !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(companyId) ||
    [values.enable, values.disable, values.show].filter(Boolean).length !== 1
  )
    throw new Error('COVERAGE_OPERATOR_INPUT_INVALID');
  if (values.show) {
    if (
      values.reason !== undefined ||
      values['operator-email'] !== undefined ||
      values.expires !== undefined
    )
      throw new Error('COVERAGE_OPERATOR_INPUT_INVALID');
    console.log(JSON.stringify(await showCommissionApprovalSwitch(url, companyId)));
  } else {
    if (
      !values.reason?.trim() ||
      !values['operator-email']?.trim() ||
      (values.disable && values.expires !== undefined)
    )
      throw new Error('COVERAGE_OPERATOR_INPUT_INVALID');
    const expiresAt = values.expires === undefined ? undefined : parseExpiry(values.expires);
    await setCommissionApprovalSwitch(
      url,
      {
        companyId,
        operatorEmail: values['operator-email'],
        reason: values.reason,
        enabled: values.enable === true,
        ...(expiresAt === undefined ? {} : { expiresAt }),
      },
      systemUuidV7(),
    );
    console.log(values.enable ? 'SWITCH_ENABLED_NEW_PROOF_REQUIRED' : 'SWITCH_DISABLED');
  }
} catch (error) {
  const failure = coverageIssuanceFailure(error);
  console.error(failure.code);
  if (failure.code === 'COVERAGE_OPERATOR_INPUT_INVALID')
    console.error('usage: --expires takes a full ISO-8601 instant with an explicit offset, e.g. 2026-12-01T12:00:00Z');
  process.exitCode = 1;
}
