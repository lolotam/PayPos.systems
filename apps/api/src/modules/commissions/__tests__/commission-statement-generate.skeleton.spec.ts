import { describe, it } from 'vitest';

// تجهيز 51-1 PR 2: هياكل اختبار بس، من غير كود إنتاج؛ كل بند هيتحوّل لاختبار حقيقي مع use case الـ generate والـ GET.

describe('CM-27 generate a month that has ended', () => {
  it.todo(
    'creates the DRAFT row and returns per employee: commission per source, sales, card tips, cash tips, corrections, total and payable',
  );
  it.todo('shows a negative commission total as negative and pays zero commission (CS-Q7)');
  it.todo(
    'lists the blocking issues NO_PLAN, NO_SALARY and the unresolved blocked corrections by employee',
  );
});

describe('CM-28b GET of a month never generated (current_fingerprint IS NULL, research R6)', () => {
  it.todo(
    'returns the computed view with generated: false and leaves no statement row, no fingerprint and no lock behind',
  );
});

describe('CM-28c the two GET response shapes (FR-025, two Zod schemas, never optional fields on one)', () => {
  it.todo(
    'gives a business-wide reader both fingerprints, reviewed_* and the changed-since-review flag with its cause',
  );
  it.todo(
    'gives a branch-scoped reader the status and her filtered rows only: no fingerprint of any kind, no changed flag or cause',
  );
  it.todo(
    'leaves a branch reader response unchanged when a customer of another branch is renamed, while the business-wide response shows STATEMENT',
  );
  it.todo(
    'picks the shape with the same predicate as the guards, so a union of branch grants covering every branch gets the branch-scoped shape',
  );
});

describe('the read path that feeds the input fingerprint (from review round 1 of 1a-i)', () => {
  it.todo(
    'passes the revision of the selected salary row (commission_salaries.revision) into the canonical input, proven by a revision-only change moving the fingerprint',
  );
  it.todo(
    'proves and reports a correction of a line whose projection head is missing before any behaviour is chosen',
  );
  it.todo(
    'proves the statement fingerprint through the real serializer on read: built rows equal stored rows',
  );
  it.todo(
    'loads the projection heads of EVERY line id the statement rows refer to, including lines of earlier months and cancelled lines, in the same transaction (never restricted to the target month or to ACTIVE); a test with historical and cancelled heads proves it',
  );
  it.todo(
    'a required line head that is missing blocks approval instead of freezing a correction row without detail (migration 0183 allowing NULL detail is not a licence)',
  );
  it.todo(
    'guarantees unique source rows (employee_id, source_ref) and unique attachment keys (employee_id, branch_id, attached_from); the builder StatementDuplicateKeyError is only the second line of defence',
  );
  it.todo(
    'the service, customer and branch name readers return every referenced id, including historical and deleted ones, with the D-21 placeholder when a name was erased (never null); the builder refuses a missing required name with a RangeError. Also add this line to the delivery docs when PR 2 is written',
  );
});

describe('CM-29 a month that has not ended', () => {
  it.todo('refuses generate with 422 COMMISSION_PERIOD_NOT_ENDED and keeps the estimate readable');
});

describe('CM-33 and CM-33d the generate part', () => {
  it.todo('refuses generate without review:commissions:business with 403');
  it.todo(
    'lets the default holders (owner, general manager, business manager) generate, and the owner grant and revoke take effect on the next request',
  );
  it.todo(
    'refuses a branch manager who holds review, and a business-wide holder with a DENY, with the uniform 403 and no audit entry',
  );
});
