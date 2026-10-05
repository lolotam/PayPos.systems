# Specification Quality Checklist: Customers — find or create

**Created**: 2026-10-03
**Feature**: [spec.md](../spec.md)

- [x] One independently testable reception use case; no UI or orders work.
- [x] Requirements and acceptance scenarios CUS-01…08 are concrete and verifiable.
- [x] Company identity, masked phone, concurrency and audit guarantees cite the governing decisions.
- [x] Slice design contains schema, RLS, indexes, FK, API contract, permissions, events and tests.
- [x] No unknown business rule is silently inferred.
- [x] Selected country/national normalization and future archive/restoration cite owner decision 2026-10-03.
- [x] Existing name/locale and opt-out are preserved.
- [ ] Country selector list (PR 35) and seeded-role grants (PR 7a) resolved by owner.

The unchecked item belongs to the named follow-up PRs. Deletion and restoration writes are outside PR 34; the future delete slice must preserve identity and unconditional phone uniqueness.
