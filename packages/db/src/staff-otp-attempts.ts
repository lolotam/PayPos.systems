import { and, eq, sql } from 'drizzle-orm';
import {
  authOtpChallenges as challenges,
  authNotificationAttempts as attempts,
} from '../schema/identity-staff-otp.ts';
import { user } from '../schema/identity-auth.ts';
import type { OtpRuntime } from './staff-otp-runtime.ts';
import type {
  OtpAttemptRecord,
  OtpChallengeRecord,
  OtpDeviceContext,
  OtpExecutionResult,
} from './staff-otp-types.ts';
import type { Tx } from './with-tenant.ts';

async function locked(runtime: OtpRuntime, tx: Tx, challengeId: string, attemptId: string) {
  const [hint] = await tx
    .select({ hash: challenges.recipientHash })
    .from(challenges)
    .where(eq(challenges.id, challengeId));
  if (hint === undefined) return null;
  const now = await runtime.lock(tx, hint.hash);
  const [challenge] = await tx
    .select()
    .from(challenges)
    .where(eq(challenges.id, challengeId))
    .for('update');
  const [attempt] = await tx
    .select()
    .from(attempts)
    .where(and(eq(attempts.id, attemptId), eq(attempts.challengeId, challengeId)))
    .for('update');
  return challenge === undefined || attempt === undefined ? null : { now, challenge, attempt };
}

export function otpAttempts(runtime: OtpRuntime) {
  return {
    release: (
      challengeId: string,
      attemptId: string,
      deadline: Date,
      ready: () => Promise<boolean>,
    ) => release(runtime, challengeId, attemptId, deadline, ready),
    pending: (challengeId: string, attemptId: string) => pending(runtime, challengeId, attemptId),
    timeout: (challengeId: string, attemptId: string) => timeout(runtime, challengeId, attemptId),
    failPreparation: (challengeId: string, attemptId: string, deadline: Date) =>
      failPreparation(runtime, challengeId, attemptId, deadline),
    claim: (challengeId: string, attemptId: string, executionId: string) =>
      claim(runtime, challengeId, attemptId, executionId),
    materialize: (challengeId: string, attemptId: string, executionId: string) =>
      materialize(runtime, challengeId, attemptId, executionId),
    finish: (
      challengeId: string,
      attemptId: string,
      executionId: string | null,
      result: OtpExecutionResult,
    ) => finish(runtime, challengeId, attemptId, executionId, result),
  };
}

const release = (
  runtime: OtpRuntime,
  challengeId: string,
  attemptId: string,
  deadline: Date,
  ready: () => Promise<boolean>,
) =>
  runtime.run(async (tx) => {
    const found = await locked(runtime, tx, challengeId, attemptId);
    if (found === null || found.attempt.status !== 'PREPARED') return false;
    const blocked = await runtime.suppressed(tx, found.challenge.recipientHash);
    const [clock] = await tx.execute<{ now: Date }>(sql`SELECT clock_timestamp() AS now`);
    if (clock === undefined) throw new Error('OTP_DATABASE_UNAVAILABLE');
    const now = new Date(clock.now);
    if (blocked) {
      await tx
        .update(challenges)
        .set({ status: 'SUPPRESSED', codeMac: null, finishedAt: now, updatedAt: now })
        .where(and(eq(challenges.id, challengeId), eq(challenges.status, 'ACTIVE')));
      await tx
        .update(attempts)
        .set({ status: 'SUPPRESSED', finishedAt: now, updatedAt: now })
        .where(eq(attempts.id, attemptId));
      return false;
    }
    if (
      now >= found.attempt.preparationDeadline ||
      now >= found.challenge.expiresAt ||
      found.challenge.status !== 'ACTIVE' ||
      !(await ready())
    )
      return false;
    await tx
      .update(attempts)
      .set({ status: 'PENDING', authorizedAt: now, updatedAt: now })
      .where(eq(attempts.id, attemptId));
    return true;
  }, deadline);

const pending = (runtime: OtpRuntime, challengeId: string, attemptId: string) =>
  runtime.run(async (tx): Promise<OtpAttemptRecord | null> => {
    const [row] = await tx
      .select()
      .from(attempts)
      .where(and(eq(attempts.id, attemptId), eq(attempts.challengeId, challengeId)));
    return row === undefined ? null : { ...row, locale: row.locale as 'ar' | 'en' };
  });

const timeout = (runtime: OtpRuntime, challengeId: string, attemptId: string) =>
  runtime.run(async (tx): Promise<string | null> => {
    const found = await locked(runtime, tx, challengeId, attemptId);
    if (found === null) return null;
    if (found.attempt.status === 'PREPARED' && found.now >= found.attempt.preparationDeadline) {
      await tx
        .update(attempts)
        .set({
          status: 'FAILED',
          failureCode: 'PREPARATION_WINDOW_ENDED',
          outcomeKnown: true,
          finishedAt: found.now,
          updatedAt: found.now,
        })
        .where(eq(attempts.id, attemptId));
      return 'FAILED';
    }
    return found.attempt.status;
  });

const failPreparation = (
  runtime: OtpRuntime,
  challengeId: string,
  attemptId: string,
  deadline: Date,
) =>
  runtime.run(async (tx) => {
    const found = await locked(runtime, tx, challengeId, attemptId);
    if (found?.attempt.status !== 'PREPARED') return;
    await tx
      .update(attempts)
      .set({
        status: 'FAILED',
        failureCode: 'PREPARATION_FAILED',
        outcomeKnown: false,
        finishedAt: found.now,
        updatedAt: found.now,
      })
      .where(eq(attempts.id, attemptId));
  }, deadline);

const claim = (runtime: OtpRuntime, challengeId: string, attemptId: string, executionId: string) =>
  runtime.run(async (tx) => {
    const found = await locked(runtime, tx, challengeId, attemptId);
    if (
      found === null ||
      found.attempt.status !== 'PENDING' ||
      found.challenge.status !== 'ACTIVE' ||
      found.now >= found.challenge.expiresAt ||
      found.now >= found.attempt.sendDeadline
    )
      return false;
    await tx
      .update(attempts)
      .set({ status: 'SENDING', executionId, sendingAt: found.now, updatedAt: found.now })
      .where(eq(attempts.id, attemptId));
    return true;
  });

const materialize = (
  runtime: OtpRuntime,
  challengeId: string,
  attemptId: string,
  executionId: string,
) =>
  runtime.run(async (tx): Promise<{ challenge: OtpChallengeRecord; phone: string } | null> => {
    const found = await locked(runtime, tx, challengeId, attemptId);
    if (
      found === null ||
      found.attempt.status !== 'SENDING' ||
      found.attempt.executionId !== executionId ||
      found.challenge.status !== 'ACTIVE' ||
      found.now >= found.challenge.expiresAt ||
      found.challenge.userId === null
    )
      return null;
    const [bound] = await tx
      .select({ phone: user.phoneNumber, approved: user.phoneBindingApprovedAt })
      .from(user)
      .where(eq(user.id, found.challenge.userId));
    if (bound?.phone === null || bound?.phone === undefined || bound.approved === null) return null;
    return {
      challenge: {
        ...found.challenge,
        deviceContext: found.challenge.deviceContext as OtpDeviceContext,
      },
      phone: bound.phone,
    };
  });

const finish = (
  runtime: OtpRuntime,
  challengeId: string,
  attemptId: string,
  executionId: string | null,
  result: OtpExecutionResult,
) =>
  runtime.run(async (tx) => {
    const found = await locked(runtime, tx, challengeId, attemptId);
    if (
      found === null ||
      !['PENDING', 'SENDING'].includes(found.attempt.status) ||
      found.attempt.executionId !== executionId
    )
      return;
    await tx
      .update(attempts)
      .set({
        status: result.status,
        failureCode: result.failureCode,
        outcomeKnown: result.outcomeKnown,
        providerMessageDigest:
          result.providerMessageDigest === undefined
            ? null
            : Buffer.from(result.providerMessageDigest),
        finishedAt: found.now,
        updatedAt: found.now,
      })
      .where(eq(attempts.id, attemptId));
  });
