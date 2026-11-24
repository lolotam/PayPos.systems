import { parseArgs } from 'node:util';

import { systemUuidV7 } from '@pospay/ids';

import { coverageIssuanceFailure } from '../src/commission-coverage-issuer.ts';
import {
  setCommissionApprovalSwitch,
  showCommissionApprovalSwitch,
} from '../src/platform-commission-approval.ts';

// مسار operator فقط، بنفس اتصال platform:grant؛ البريد لا يخرج من حل الهوية إلى السجل أو الطباعة.

// لحظة ISO-8601 كاملة بoffset صريح فقط: لا تاريخ بدون وقت ولا وقت بدون Z أو offset رقمي.
const ISO_INSTANT =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/;

/**
 * يقبل لحظة ISO-8601 كاملة بoffset صريح ويرفض كل غيرها، ويعيد الإعادة (round-trip) فترفض التواريخ
 * الملفوفة مثل 31 فبراير أو ساعة 25 لأن Date.UTC يطبّعها لقيمة أخرى؛ ساعة الجهاز لا تُستشار أبداً.
 */
function parseExpiry(value: string): Date {
  const match = ISO_INSTANT.exec(value);
  if (match === null || match[8] === undefined) throw new Error('COVERAGE_OPERATOR_INPUT_INVALID');
  const [, year, month, day, hour, minute, second, fraction, offset] = match;
  const offsetMinutes =
    offset === 'Z'
      ? 0
      : (offset[0] === '-' ? -1 : 1) *
        (Number(offset.slice(1, 3)) * 60 + Number(offset.slice(4, 6)));
  const millisecond = fraction === undefined ? 0 : Number(fraction.padEnd(3, '0').slice(0, 3));
  const wall =
    Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute),
      Number(second), millisecond) -
    offsetMinutes * 60_000;
  const shifted = new Date(wall + offsetMinutes * 60_000);
  const rounded =
    shifted.getUTCFullYear() !== Number(year) ||
    shifted.getUTCMonth() !== Number(month) - 1 ||
    shifted.getUTCDate() !== Number(day) ||
    shifted.getUTCHours() !== Number(hour) ||
    shifted.getUTCMinutes() !== Number(minute) ||
    shifted.getUTCSeconds() !== Number(second) ||
    shifted.getUTCMilliseconds() !== millisecond;
  if (rounded || Math.abs(offsetMinutes) > 14 * 60)
    throw new Error('COVERAGE_OPERATOR_INPUT_INVALID');
  return new Date(wall);
}

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
