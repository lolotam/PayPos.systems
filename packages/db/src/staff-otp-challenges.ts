import { and, eq, sql } from 'drizzle-orm';
import {
  authOtpChallenges as challenges,
  authNotificationAttempts as attempts,
} from '../schema/identity-staff-otp.ts';
import { user } from '../schema/identity-auth.ts';
import type { OtpRuntime } from './staff-otp-runtime.ts';
import type { OtpChallengeRecord, OtpDeviceContext, OtpPreparation } from './staff-otp-types.ts';

export function otpChallenges(runtime: OtpRuntime) {
  return {
    mappingValid: (
      userId: string,
      hash: Uint8Array,
      identify: (phone: string) => Uint8Array,
      deadline?: Date,
    ) => mappingValid(runtime, { userId, hash, identify, deadline }),
    lookup: (phone: string, deadline: Date) => lookup(runtime, phone, deadline),
    prepare: (input: OtpPreparation) => prepare(runtime, input),
    find: (id: string, deadline?: Date) => find(runtime, id, deadline),
    consume: (
      id: string,
      device: OtpDeviceContext,
      compare: (c: OtpChallengeRecord) => boolean,
      identify: (phone: string) => Uint8Array,
      deadline?: Date,
    ) => consume(runtime, { id, device, compare, identify, deadline }),
  };
}

const lookup = (runtime: OtpRuntime, phone: string, deadline: Date) =>
  runtime.run(async (tx) => {
    const [found] = await tx
      .select({ id: user.id })
      .from(user)
      .where(and(eq(user.phoneNumber, phone), sql`${user.phoneBindingApprovedAt} IS NOT NULL`));
    return found?.id ?? null;
  }, deadline);

const prepare = (runtime: OtpRuntime, input: OtpPreparation) =>
  runtime.run(async (tx) => {
    const c = input.challenge;
    const now = await runtime.lock(tx, c.recipientHash);
    if (now >= input.preparationDeadline) return false;
    const blocked = await runtime.suppressed(tx, c.recipientHash);
    if (!blocked && input.eligible === false) return false;
    await tx
      .update(challenges)
      .set({ status: 'SUPERSEDED', codeMac: null, finishedAt: now, updatedAt: now })
      .where(and(eq(challenges.recipientHash, c.recipientHash), eq(challenges.status, 'ACTIVE')));
    await tx.insert(challenges).values({
      ...c,
      deviceContext: c.deviceContext,
      codeMac: blocked ? null : input.materializeMac(),
      userId: blocked ? null : c.userId,
      derivationKeyId: blocked ? null : c.derivationKeyId,
      verificationKeyId: blocked ? null : c.verificationKeyId,
      status: blocked ? 'SUPPRESSED' : 'ACTIVE',
      finishedAt: blocked ? now : null,
      updatedAt: now,
    });
    await tx.insert(attempts).values({
      id: input.attemptId,
      challengeId: c.id,
      recipientHash: c.recipientHash,
      hashKeyId: c.hashKeyId,
      userId: blocked ? null : c.userId,
      channel: 'WHATSAPP',
      templateKey: 'staff_otp',
      templateRevision: 1,
      locale: input.locale,
      providerTemplateName: input.providerTemplateName,
      status: blocked ? 'SUPPRESSED' : 'PREPARED',
      finishedAt: blocked ? now : null,
      sendDeadline: c.expiresAt,
      preparationDeadline: input.preparationDeadline,
      createdAt: c.createdAt,
      updatedAt: now,
    });
    return !blocked;
  }, input.preparationDeadline);

const find = (runtime: OtpRuntime, id: string, deadline?: Date) =>
  runtime.run(async (tx): Promise<OtpChallengeRecord | null> => {
    const [row] = await tx.select().from(challenges).where(eq(challenges.id, id));
    return row === undefined
      ? null
      : { ...row, deviceContext: row.deviceContext as OtpDeviceContext };
  }, deadline);

const consume = (
  runtime: OtpRuntime,
  input: {
    id: string;
    device: OtpDeviceContext;
    compare: (c: OtpChallengeRecord) => boolean;
    identify: (phone: string) => Uint8Array;
    deadline: Date | undefined;
  },
) =>
  runtime.run(async (tx): Promise<string | null> => {
    const { id, device, compare, identify } = input;
    const [hint] = await tx
      .select({ hash: challenges.recipientHash })
      .from(challenges)
      .where(eq(challenges.id, id));
    if (hint === undefined) return null;
    await runtime.lock(tx, hint.hash);
    const [row] = await tx.select().from(challenges).where(eq(challenges.id, id)).for('update');
    if (row === undefined || row.status !== 'ACTIVE') return null;
    const c = { ...row, deviceContext: row.deviceContext as OtpDeviceContext };
    const [bound] =
      row.userId === null
        ? []
        : await tx.select().from(user).where(eq(user.id, row.userId)).for('update');
    const mapped =
      bound?.phoneNumber !== null &&
      bound?.phoneNumber !== undefined &&
      bound.phoneBindingApprovedAt !== null &&
      Buffer.from(identify(bound.phoneNumber)).equals(row.recipientHash);
    const scope =
      JSON.stringify(Object.entries(c.deviceContext).sort()) ===
      JSON.stringify(Object.entries(device).sort());
    if (!scope) return null;
    const now = await runtime.now(tx);
    if (now >= row.expiresAt || !mapped) {
      await tx
        .update(challenges)
        .set({ status: 'EXPIRED', codeMac: null, finishedAt: now, updatedAt: now })
        .where(eq(challenges.id, id));
      return null;
    }
    const matched = compare(c);
    const failedAttempts = matched ? row.failedAttempts : row.failedAttempts + 1;
    const status = matched ? 'CONSUMED' : failedAttempts >= 5 ? 'EXHAUSTED' : 'ACTIVE';
    await tx
      .update(challenges)
      .set({
        status,
        failedAttempts,
        codeMac: status === 'ACTIVE' ? row.codeMac : null,
        consumedAt: matched ? now : null,
        finishedAt: status === 'ACTIVE' ? null : now,
        updatedAt: now,
      })
      .where(eq(challenges.id, id));
    if (matched && row.userId !== null)
      await tx.update(user).set({ phoneNumberVerified: true }).where(eq(user.id, row.userId));
    return matched ? row.userId : null;
  }, input.deadline);

const mappingValid = (
  runtime: OtpRuntime,
  input: {
    userId: string;
    hash: Uint8Array;
    identify: (phone: string) => Uint8Array;
    deadline: Date | undefined;
  },
) =>
  runtime.run(async (tx) => {
    const { userId, hash, identify } = input;
    const [row] = await tx
      .select({ phone: user.phoneNumber, approved: user.phoneBindingApprovedAt })
      .from(user)
      .where(eq(user.id, userId));
    return (
      row?.phone != null &&
      row.approved != null &&
      Buffer.from(identify(row.phone)).equals(Buffer.from(hash))
    );
  }, input.deadline);
