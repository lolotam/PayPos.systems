import { randomBytes, randomInt } from 'node:crypto';

import type { Redis } from 'ioredis';

import type { Clock } from '../../../shared/ports/clock.port.ts';
import type { PairingCodes } from '../ports/devices.port.ts';

// 10 minutes, single use (Waleed, 2026-09-23). Eight characters from an alphabet without look-alikes (no 0/O, 1/I/L):
// 32^8 ≈ 10^12 codes, and the register route is rate-limited.
export const PAIRING_CODE_TTL_SECONDS = 600;
// The reservation of a claimed code outlives a slow registration by at most this long.
const CLAIM_TTL_SECONDS = 30;
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const LENGTH = 8;
const CODE_SHAPE = /^[A-Z0-9]{8}$/;

// المفاتيح: كود الربط نفسه، ومؤشر الفرع على الكود الحي، وحجز الطلب أثناء التسجيل.
// المؤشر بالـ (company_id, branch_id) هو اللي بيخلي كود شركة ما يبوصلش شركة تانية (ADR-0003 §4 path B).
const pairingKey = (code: string): string => `pairing:${code}`;
const branchKey = (companyId: string, branchId: string): string =>
  `pairing_branch:${companyId.toLowerCase()}:${branchId.toLowerCase()}`;
const inflightKey = (code: string): string => `pairing_inflight:${code}`;

// Issue: the new code becomes the branch's live code and the old live code dies in the same atomic step.
const ISSUE_SCRIPT = `
  if redis.call('EXISTS', KEYS[1]) == 1 then return 'COLLISION' end
  local prefix = string.sub(KEYS[1], 1, #KEYS[1] - #('pairing:' .. ARGV[1]))
  local oldCode = redis.call('GET', KEYS[2])
  if oldCode and oldCode ~= ARGV[1] then
    redis.call('DEL', prefix .. 'pairing:' .. oldCode)
  end
  redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3])
  redis.call('SET', KEYS[2], ARGV[1], 'EX', ARGV[3])
  return 'OK'`;

// Claim: the code must exist, must still be the branch's live code, and is reserved for one registration.
const CLAIM_SCRIPT = `
  local raw = redis.call('GET', KEYS[1])
  if not raw then return nil end
  local companyId, branchId = string.match(raw, '^([^|]+)|([^|]+)$')
  if not companyId or not branchId then return nil end
  local prefix = string.sub(KEYS[1], 1, #KEYS[1] - #('pairing:' .. ARGV[1]))
  if redis.call('GET', prefix .. 'pairing_branch:' .. companyId .. ':' .. branchId) ~= ARGV[1] then
    redis.call('DEL', KEYS[1])
    return nil
  end
  local reserved = redis.call('SET', KEYS[2], ARGV[2], 'EX', ARGV[3], 'NX')
  if not reserved then return nil end
  return raw`;

// Consume: the code must exist, still be the branch's live code, and still be reserved by this claimant.
const CONSUME_SCRIPT = `
  if redis.call('EXISTS', KEYS[1]) == 0 then
    if redis.call('GET', KEYS[3]) == ARGV[2] then redis.call('DEL', KEYS[3]) end
    return 0
  end
  if redis.call('GET', KEYS[2]) ~= ARGV[1] then
    if redis.call('GET', KEYS[3]) == ARGV[2] then redis.call('DEL', KEYS[3]) end
    return 0
  end
  if redis.call('GET', KEYS[3]) ~= ARGV[2] then return 0 end
  redis.call('DEL', KEYS[1], KEYS[2], KEYS[3])
  return 1`;

// Release: the reservation goes back when the database transaction gave up before the consume.
const RELEASE_SCRIPT = `
  if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end
  return 0`;

function randomCode(): string {
  return Array.from({ length: LENGTH }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
}

/**
 * @param redis the API's Redis client
 * @param clock the clock the expiry is reported against
 * @returns pairing codes kept in Redis: issuing replaces the branch's live code, claiming reserves one
 *          registration, and consuming deletes the code only for the reservation that owns it
 */
export function createRedisPairingCodes(redis: Redis, clock: Clock): PairingCodes {
  return {
    issue: async (target) => issueCode(redis, target, clock),
    claim: async (code) => claimCode(redis, code),
    consume: async (input) => consumeCode(redis, input),
    release: async (code, claimId) => {
      await redis.eval(RELEASE_SCRIPT, 1, inflightKey(code), claimId);
    },
  };
}

async function issueCode(
  redis: Redis,
  target: { companyId: string; branchId: string },
  clock: Clock,
): Promise<{ code: string; expiresAt: Date }> {
  for (;;) {
    const code = randomCode();
    const answer = await redis.eval(
      ISSUE_SCRIPT,
      2,
      pairingKey(code),
      branchKey(target.companyId, target.branchId),
      code,
      `${target.companyId.toLowerCase()}|${target.branchId.toLowerCase()}`,
      String(PAIRING_CODE_TTL_SECONDS),
    );
    if (answer === 'OK') {
      return {
        code,
        expiresAt: new Date(clock.now().getTime() + PAIRING_CODE_TTL_SECONDS * 1000),
      };
    }
  }
}

async function claimCode(
  redis: Redis,
  code: string,
): Promise<{ companyId: string; branchId: string; claimId: string } | null> {
  if (!CODE_SHAPE.test(code)) return null;
  const claimId = randomBytes(16).toString('hex');
  const raw = await redis.eval(
    CLAIM_SCRIPT,
    2,
    pairingKey(code),
    inflightKey(code),
    code,
    claimId,
    String(CLAIM_TTL_SECONDS),
  );
  if (typeof raw !== 'string') return null;
  const separator = raw.indexOf('|');
  if (separator < 1) return null;
  return { companyId: raw.slice(0, separator), branchId: raw.slice(separator + 1), claimId };
}

async function consumeCode(
  redis: Redis,
  input: { code: string; companyId: string; branchId: string; claimId: string },
): Promise<boolean> {
  const answer = await redis.eval(
    CONSUME_SCRIPT,
    3,
    pairingKey(input.code),
    branchKey(input.companyId, input.branchId),
    inflightKey(input.code),
    input.code,
    input.claimId,
  );
  return answer === 1;
}
