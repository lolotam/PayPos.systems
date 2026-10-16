# Specification Quality Checklist: 35d — Edit the price/discount of a saved service line

**Purpose**: Validate completeness and quality of [spec-35d.md](../spec-35d.md) before planning the writer (35d-4)
**Created**: 2026-10-16
**Feature**: [spec-35d.md](../spec-35d.md)

## Content Quality

- [x] Business sections contain no implementation details; implementation decisions appear only under **Slice design** (and the decisions record)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders (scenarios use the salon example)
- [x] All mandatory sections completed

## Requirement Completeness

- [ ] No [NEEDS CLARIFICATION] markers remain (one `TODO(spec)`: ED-Q14, FR-014)
- [x] Requirements are testable and unambiguous (LE-01…LE-23, FR-001…FR-019)
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded (cancel 37, performer changes 37b, approvals 38–41, commissions 50 excluded)
- [x] Dependencies and assumptions identified
- [ ] **Slice design** complete: schema (35d-3b), API contract (edit + history), permissions, events, test plan — the edit-response shape for a caller without branch-read is an open contract item (ED-Q14, gates 35d-4)

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into the user scenarios

## Notes

- One owner question is PENDING (ED-Q14, edit response shape for a caller without branch-read; `TODO(spec)` in FR-014; gates 35d-4). Answered owner questions (ED-Q1…ED-Q13) are not re-opened; the three technical gates (#250, #252, #255) are decided in the spec and ADR-0045.
- The `TODO(spec)` comment in `packages/db/schema/orders.ts` (issue #255) is removed by sub-PR 35d-3b, not by this docs-only PR.
