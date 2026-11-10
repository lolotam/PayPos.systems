# #802 — Immutable commission-line projection identity

Baseline: `ff551062ce56a9a57cd6aa7a9abd6f67e1a2bbb2`. Issue: <https://github.com/lolotam/PayPos.systems/issues/802>.

## Requirements

- Read held heads by company and line ID, including stored business, session, branch, service and customer IDs. Never filter by the incoming identity, which could hide a mismatch.
- Discard equal/stale revisions first. Every strictly newer existing line must preserve all five identity columns or throw `CommissionLineEventInvalidError('IDENTITY_CHANGED', lineId)`.
- Reject before business timezone lookup or any period lock, with no partial batch effects. Keep normal payload/envelope validation, new-line acceptance, same-identity newer changes and legitimate period movement.
- Keep comparison pure in worker commissions domain, with required Arabic documentation. Update held-head types, local persistence projection and port documentation together.

## Acceptance and proof

Test each independently changed identity using valid event envelopes. Prove zero timezone/period calls, not merely rolled-back rows. Real PostgreSQL delivery must preserve heads, performer rows, statement states and consumer marks on failure, including mixed valid/invalid batches. Equal/stale conflicts remain ignored and can be marked delivered. Preserve convergence, cancellation, performer replacement, tenant isolation and period movement.

## Scope and non-goals

Only `apps/worker/src/modules/commissions/**` and this task's docs may change. No migrations, contracts, shared fixtures outside that module, auth, root configuration, lockfiles, workflows or global docs.

Expected authored additions plus deletions: 500 lines. More than 1000 requires rescoping. No correction-routing redesign or expanded immutable field set.
