import type {
  ClaimStateCode,
  ClaimStateFence,
  ClaimStatePage,
  ClaimStatePageEntry,
  ClaimStateReservations,
  ClaimStateResult,
  ClaimStateSnapshot,
  ClaimStateRetry,
  RatingClaimState,
} from '../../../ports/rating-claim-state.port.ts';

/** الشركة اللي الحالة المزيفة بتحرسها؛ الاختبار بيشتغل عليها. */
export const COMPANY = '01920000-0000-7000-8000-0000000000b2';

/**
 * حالة الجدولة في الذاكرة: بديل Redis في الاختبار، بتسجّل كل أمر في ترتيبه
 * وبتحتفظ بالصفحة والدورة كأنها في Redis.
 */
export class FakeState implements RatingClaimState {
  readonly calls: string[] = [];
  readonly settlements: { requestId: string; settlement: string }[] = [];
  version = 1;
  phase: 'IDLE' | 'SWEEP' = 'IDLE';
  sweepId: string | undefined;
  upperId: string | undefined;
  cursorId: string | undefined;
  page: ClaimStatePage | undefined;
  retries: Record<string, ClaimStateRetry> = {};
  reservations: readonly { requestId: string; workToken: string }[] = [];
  acquireCode: ClaimStateCode = 'OK';
  settlePageCode: ClaimStateCode = 'OK';
  /** الميزانية اللي الدور بعتّها مع الصفحة، عشان الاختبار يتأكد إنها ميزانيته هو. */
  enrollMaxEntries: number | undefined;

  private snapshot(): ClaimStateSnapshot {
    return {
      companyId: COMPANY,
      incarnation: 'incarnation-1',
      version: this.version,
      ownerToken: 'owner-1',
      nextTicket: 1,
      phase: this.phase,
      ...(this.sweepId === undefined ? {} : { sweepId: this.sweepId }),
      ...(this.upperId === undefined ? {} : { upperId: this.upperId }),
      ...(this.cursorId === undefined ? {} : { cursorId: this.cursorId }),
      ...(this.page === undefined ? {} : { page: this.page }),
      retries: this.retries,
      overflowCount: 0,
      reconcileRequired: false,
    };
  }

  async acquire(): Promise<ClaimStateResult<ClaimStateSnapshot>> {
    this.calls.push('acquire');
    if (this.acquireCode !== 'OK') return { code: this.acquireCode, version: this.version };
    this.version += 1;
    return { code: 'OK', version: this.version, value: this.snapshot() };
  }

  async renew(): Promise<ClaimStateResult<ClaimStateSnapshot>> {
    this.calls.push('renew');
    this.version += 1;
    return { code: 'OK', version: this.version, value: this.snapshot() };
  }

  async release(): Promise<ClaimStateResult<ClaimStateSnapshot>> {
    this.calls.push('release');
    this.version += 1;
    return { code: 'OK', version: this.version, value: this.snapshot() };
  }

  async begin(
    fence: ClaimStateFence,
    sweepId: string,
    upperId: string | null,
  ): Promise<ClaimStateResult<ClaimStateSnapshot>> {
    this.calls.push('begin');
    if (fence.companyId !== COMPANY) return { code: 'STALE', version: this.version };
    this.phase = 'SWEEP';
    this.sweepId = sweepId;
    this.upperId = upperId ?? undefined;
    this.version += 1;
    return { code: 'OK', version: this.version, value: this.snapshot() };
  }

  async enrollPage(
    fence: ClaimStateFence,
    sweepId: string,
    fromId: string | null,
    pageId: string,
    entries: readonly ClaimStatePageEntry[],
    exhausted: boolean,
    maxEntries: number,
  ): Promise<ClaimStateResult<ClaimStateSnapshot>> {
    this.calls.push('enrollPage');
    if (fence.companyId !== COMPANY) return { code: 'STALE', version: this.version };
    this.enrollMaxEntries = maxEntries;
    // الحد جاي من ميزانية الدور نفسها، فالصفحة الأكبر منه مرفوضة زي ما Redis
    // بيعمل بالظبط: كود LIMIT، والدور بيقف من غير ما يطالب بأي بند.
    if (entries.length > maxEntries) return { code: 'LIMIT', version: this.version };
    const last = entries[entries.length - 1];
    this.page = {
      pageId,
      sweepId,
      exhausted,
      entries,
      ...(fromId === null ? {} : { fromId }),
      ...(last === undefined ? {} : { throughId: last.requestId }),
    };
    if (last !== undefined) this.cursorId = last.requestId;
    this.version += 1;
    return { code: 'OK', version: this.version, value: this.snapshot() };
  }

  async reserveRetries(
    fence: ClaimStateFence,
    limit: number,
    workTokens: readonly string[],
  ): Promise<ClaimStateResult<ClaimStateReservations>> {
    this.calls.push('reserveRetries');
    if (fence.companyId !== COMPANY) return { code: 'STALE', version: this.version };
    this.version += 1;
    return {
      code: 'OK',
      version: this.version,
      value: {
        reservations: this.reservations.slice(0, Math.min(limit, workTokens.length)),
      },
    };
  }

  async settlePage(
    fence: ClaimStateFence,
    pageId: string,
    workToken: string,
    settlement: string,
  ): Promise<ClaimStateResult<ClaimStateSnapshot>> {
    this.calls.push('settlePage');
    if (fence.companyId !== COMPANY) return { code: 'STALE', version: this.version };
    if (this.settlePageCode !== 'OK') return { code: this.settlePageCode, version: this.version };
    if (this.page !== undefined && this.page.pageId !== pageId) {
      return { code: 'STALE', version: this.version };
    }
    const entry = this.page?.entries.find((item) => item.workToken === workToken);
    if (entry !== undefined) {
      this.settlements.push({ requestId: entry.requestId, settlement });
      const entries = this.page?.entries.filter((item) => item.workToken !== workToken) ?? [];
      this.page = this.page === undefined ? undefined : { ...this.page, entries };
    }
    this.version += 1;
    return { code: 'OK', version: this.version, value: this.snapshot() };
  }

  async settleRetry(
    fence: ClaimStateFence,
    requestId: string,
    workToken: string,
    settlement: string,
  ): Promise<ClaimStateResult<ClaimStateSnapshot>> {
    this.calls.push('settleRetry');
    if (fence.companyId !== COMPANY) return { code: 'STALE', version: this.version };
    const reservation = this.reservations.find((item) => item.requestId === requestId);
    if (reservation !== undefined && reservation.workToken !== workToken) {
      return { code: 'STALE', version: this.version };
    }
    this.settlements.push({ requestId, settlement });
    this.version += 1;
    return { code: 'OK', version: this.version, value: this.snapshot() };
  }

  async finish(): Promise<ClaimStateResult<ClaimStateSnapshot>> {
    this.calls.push('finish');
    this.phase = 'IDLE';
    this.page = undefined;
    this.version += 1;
    return { code: 'OK', version: this.version, value: this.snapshot() };
  }

  async read(): Promise<ClaimStateResult<ClaimStateSnapshot>> {
    this.calls.push('read');
    return { code: 'OK', version: this.version, value: this.snapshot() };
  }
}
