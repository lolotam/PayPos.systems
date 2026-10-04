import type { Sql } from 'postgres';

import { canonicalJson } from './canonical-json.ts';

/** مادة الاعتماد تبقى داخل واجهة الهوية وتحت قفل عدادها. */
export interface AssertionCredential {
  readonly credentialId: string;
  readonly publicKey: string;
  readonly counter: number;
  readonly transports: string | null;
}

/** استهلاك التحدي وتحديث العداد معاً؛ الرفض يصرف التحدي أيضاً ولا يعيده للتجربة. */
export function assertionConsumer(client: Sql) {
  return (input: {
    identifier: string;
    passkeyId: string;
    userId: string;
    scope: string;
    verify(challenge: string, credential: AssertionCredential): Promise<number | null>;
  }) =>
    client.begin(async (tx) => {
      const [row] = await tx<{ value: string; valid: boolean; id: string; expires_at: string }[]>`
      SELECT id,value,expires_at,expires_at>clock_timestamp() AS valid FROM verification
      WHERE identifier=${input.identifier} ORDER BY id LIMIT 1 FOR UPDATE`;
      if (row === undefined) return false;
      await tx`DELETE FROM verification WHERE id=${row.id}`;
      if (!row.valid) return false;
      const stored = assertionValue(row.value);
      if (stored === null || !sameScope(stored.scope, input.scope)) return false;
      const [credential] = await tx<
        { credential_id: string; public_key: string; counter: string; transports: string | null }[]
      >`
      SELECT credential_id,public_key,counter,transports FROM passkey
      WHERE id=${input.passkeyId} AND user_id=${input.userId} FOR UPDATE`;
      if (credential === undefined) return false;
      let counter: number | null;
      try {
        counter = await input.verify(stored.challenge, {
          credentialId: credential.credential_id,
          publicKey: credential.public_key,
          counter: Number(credential.counter),
          transports: credential.transports,
        });
      } catch {
        return false;
      }
      if (
        counter === null ||
        !Number.isSafeInteger(counter) ||
        counter < 0 ||
        counter > 4_294_967_295
      )
        return false;
      const [fresh] = await tx<
        { valid: boolean }[]
      >`SELECT clock_timestamp()<${row.expires_at} AS valid`;
      if (fresh?.valid !== true) return false;
      await tx`UPDATE passkey SET counter=${counter} WHERE id=${input.passkeyId}`;
      // Drizzle يحول parser التاريخ الخام إلى نص؛ الدليل يأخذ Date صريحاً حتى يرفض انتهاء العمر.
      return new Date(row.expires_at);
    });
}

function assertionValue(value: string): { scope: string; challenge: string } | null {
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !('scope' in parsed) ||
      !('challenge' in parsed) ||
      typeof parsed.scope !== 'string' ||
      typeof parsed.challenge !== 'string'
    )
      return null;
    return { scope: parsed.scope, challenge: parsed.challenge };
  } catch {
    return null;
  }
}

// النطاق يتقارن بمحتواه مش بترتيب مفاتيحه؛ نص مش JSON صالح بيرفض والتحدي بيفضل مصروف.
function sameScope(stored: string, presented: string): boolean {
  try {
    return canonicalJson(JSON.parse(stored)) === canonicalJson(JSON.parse(presented));
  } catch {
    return false;
  }
}
