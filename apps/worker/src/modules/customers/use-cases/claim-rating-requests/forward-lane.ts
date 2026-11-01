import { settleClaim, type ClaimSettlement } from '../../domain/rating-claim-scheduling.ts';
import type { ClaimStatePage, ClaimStatePageEntry } from '../../ports/rating-claim-state.port.ts';
import type { RatingClaimsTurnState } from './rating-claims-turn-state.ts';

/**
 * المسار الأمامي: بيكمل صفحة مسجّلة أو بيسجّل صفحة جديدة، وبيقفل الجولة لما تخلص.
 *
 * الصفحة المسجّلة ليها أولوية على أي صفحة جديدة، عشان ما نطالبش بطلب مش
 * مسجّل، ولأن الصفحة المسجّلة هي شغل الدور اللي فات.
 */
export async function runForwardLane<Transaction>(
  turn: RatingClaimsTurnState<Transaction>,
): Promise<void> {
  const journal = turn.snapshot.page;
  if (journal !== undefined && journal.entries.length > 0) {
    await workPage(turn, journal);
    return;
  }
  const sweepId = await startSweep(turn);
  if (sweepId === null) return;
  const upperId = turn.snapshot.upperId;
  if (upperId === undefined) {
    await finishSweep(turn, sweepId);
    return;
  }
  const cursorId = turn.snapshot.cursorId ?? null;
  const requestIds = await turn.ports.transactions.pageIds(
    turn.companyId,
    cursorId,
    upperId,
    turn.budget.forward,
  );
  const exhausted =
    requestIds.length < turn.budget.forward || requestIds[requestIds.length - 1] === upperId;
  const entries = requestIds.map((requestId) => ({ requestId, workToken: turn.ids.newId() }));
  const pageId = turn.ids.newId();
  const enrolled = await turn.ports.state.enrollPage(
    turn.fence,
    sweepId,
    cursorId,
    pageId,
    entries,
    exhausted,
    turn.budget.forward,
  );
  turn.accept(enrolled);
  if (enrolled.code !== 'OK') {
    turn.halt(enrolled.code);
    return;
  }
  await workPage(turn, { pageId, sweepId, exhausted, entries });
}

/** يخدم بنود الصفحة، ويسوّي كل بند بعد ما معاملته تقفل. */
async function workPage<Transaction>(
  turn: RatingClaimsTurnState<Transaction>,
  page: ClaimStatePage,
): Promise<void> {
  for (const entry of page.entries) {
    if (turn.limitReached) return;
    await turn.renewLease();
    // التجديد نفسه ممكن يكشف سقف الدور، فمفيش بند بيتلمس بعد السقف؛
    // والدور بيقف لوحده من غير مطالبة من غير سور.
    if (turn.halted || turn.limitReached) return;
    const settlement = await settleEntry(turn, page.pageId, entry);
    if (settlement === null) return;
    turn.counts[settlement] += 1;
    turn.forwardVisits += 1;
  }
  if (page.exhausted && !turn.halted) await finishSweep(turn, page.sweepId);
}

/**
 * يسوّي بند واحد من الصفحة.
 *
 * الطلب اللي أصله في خريطة الإعادة بيتسلم وتسوية DELEGATED من غير ما نلمس الخريطة، وباقي
 * البند بيمشي في مسار المطالبة نفسه. الفيضان نتيجة مسجّلة، والدور بيكمّل.
 */
async function settleEntry<Transaction>(
  turn: RatingClaimsTurnState<Transaction>,
  pageId: string,
  entry: ClaimStatePageEntry,
): Promise<ClaimSettlement | null> {
  if (turn.snapshot.retries[entry.requestId] !== undefined) {
    const delegated = await turn.ports.state.settlePage(
      turn.fence,
      pageId,
      entry.workToken,
      'DELEGATED',
    );
    turn.accept(delegated);
    if (delegated.code === 'OVERFLOW') {
      turn.reportOverflow(delegated);
      return 'DELEGATED';
    }
    if (delegated.code !== 'OK') {
      turn.halt(delegated.code);
      return null;
    }
    return 'DELEGATED';
  }
  const observed = await turn.observe(entry.requestId);
  const settlement = settleClaim(observed.observation);
  const settled = await turn.ports.state.settlePage(
    turn.fence,
    pageId,
    entry.workToken,
    settlement,
    observed.storedDueAt,
  );
  turn.accept(settled);
  if (settled.code === 'OVERFLOW') {
    turn.reportOverflow(settled);
    return settlement;
  }
  if (settled.code !== 'OK') {
    turn.halt(settled.code);
    return null;
  }
  return settlement;
}

/** يبدأ الجولة الأمامية لو ما فيهاش جولة شغالة، ويقطّع الحد الأعلى مرة واحدة. */
async function startSweep<Transaction>(
  turn: RatingClaimsTurnState<Transaction>,
): Promise<string | null> {
  if (turn.snapshot.phase === 'SWEEP') {
    const sweepId = turn.snapshot.sweepId;
    if (sweepId === undefined) {
      turn.halt('CORRUPT');
      return null;
    }
    return sweepId;
  }
  const upperId = await turn.ports.transactions.upperId(turn.companyId);
  const sweepId = turn.ids.newId();
  const begun = await turn.ports.state.begin(turn.fence, sweepId, upperId);
  turn.accept(begun);
  if (begun.code !== 'OK') {
    turn.halt(begun.code);
    return null;
  }
  return sweepId;
}

/** يقفل الجولة الأمامية ويرجّع الحالة للـ IDLE مع حفظ الإعادات. */
async function finishSweep<Transaction>(
  turn: RatingClaimsTurnState<Transaction>,
  sweepId: string,
): Promise<void> {
  const finished = await turn.ports.state.finish(turn.fence, sweepId);
  turn.accept(finished);
  if (finished.code !== 'OK') turn.halt(finished.code);
}
