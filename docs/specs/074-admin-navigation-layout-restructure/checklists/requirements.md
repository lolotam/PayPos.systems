# Specification Quality Checklist: Admin navigation — three switchable styles

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-11-21
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] Business sections contain no implementation details; implementation decisions appear only under **Slice design**
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified
- [x] **Slice design** complete: schema changes (tables, RLS policies, indexes, tenant-qualified FKs), API contract (endpoint, Zod schema, `Idempotency-Key`, error codes), permissions (`action:resource:scope`, feature flag), events, and the test plan (domain unit, integration scenario IDs, RLS negative, `EXPLAIN`) — each filled or marked [NEEDS CLARIFICATION]

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Notes

- Validated on 2026-11-21 by the session that wrote the spec, then checked with the docs-guard skill and debated once with Codex (`gpt-6.2-astra`, medium): verdict "agree with changes", nine findings, all applied (`debate-codex-astra.md`).
- FR-022 / NAV-Q14 was answered on 2026-11-21 (by business type and role). The per-entry table of business types and roles is still to be written in step 1.
- Business rules BR-001 to BR-005 are the owner's answers, recorded verbatim in `owner-questions.ar.md` (NAV-Q1, NAV-Q6, NAV-Q7, NAV-Q8, NAV-Q10, NAV-Q12).
- Still open and not blocking: NAV-Q4 (`--primary` difference) and NAV-Q11 (cashier app). Answered on 2026-11-21: NAV-Q5, NAV-Q14, NAV-Q15, NAV-Q16.
- One point the spec states as an assumption, not verified: whether existing reads can supply navigation counts.
- Audit: the owner approved a recorded exception for a user changing their own style (NAV-Q16); CLAUDE.md §8 is amended in step 0b.
- The MergePilot panel reviewed the PR on 2026-11-21 (50 findings); the documentation findings were applied and the prototype findings are fixed or listed in `prototypes/README.md`.
- The schema row adds a column to a global identity table. ADR-0003 must be amended before the migration is written.
