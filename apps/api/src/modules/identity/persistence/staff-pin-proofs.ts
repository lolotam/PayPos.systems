import { createHash, randomBytes } from 'node:crypto';

import type { StaffPinProofIssuer } from '../ports/staff-pins.port.ts';

// 32 بايت عشوائية بتولّد 43 حرف base64url — الدليل ما يتخمنش، والدالة pure جوه المحوّل.
const PROOF_BYTES = 32;

/**
 * بصمة الدليل: SHA-256 hex — نفس الدالة اللي بتتحقق منها القاعدة وبتقارن البصمة المخزنة.
 *
 * @param proof الدليل كما وصل أو كما اتولد
 * @returns بصمة الدليل hex
 */
function digest(proof: string): string {
  return createHash('sha256').update(proof, 'utf8').digest('hex');
}

/**
 * مولّد أدلة تغيير الرقم السري — هو الوحيد في الهوية اللي يعمل عشوائية تشفيرية، والـuse case
 * بيوصله جاهز (CLAUDE.md §4.2 و§8).
 *
 * @returns مولّد بيصدر دليلاً مع بصمته، وبيحسب بصمة دليل واصل من العميل
 */
export function createStaffPinProofIssuer(): StaffPinProofIssuer {
  return {
    issue: () => {
      const proof = randomBytes(PROOF_BYTES).toString('base64url');
      return { proof, hash: digest(proof) };
    },
    digest,
  };
}
