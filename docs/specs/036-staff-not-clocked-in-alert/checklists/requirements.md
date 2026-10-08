# Specification Quality Checklist: Not-clocked-in alert

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-10-08
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] Business sections contain no implementation details; implementation decisions appear only under **Slice design**
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [ ] No [NEEDS CLARIFICATION] markers remain — NC-Q1…NC-Q12 are PENDING (FR-006 carries the marker; FR-003–FR-005 defer to NC-Q6–NC-Q12)
- [x] Requirements are testable and unambiguous (once the NC answers land)
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified
- [x] **Slice design** complete: schema changes, API contract (none: worker job), permissions, events, and the test plan

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [ ] Feature meets measurable outcomes defined in Success Criteria — pending the NC answers
- [x] No implementation details leak into specification

## Notes

- 20-minute delay and "manager" recipient are decided by PRD D-47; the switch and master switch by D-47 / SPEC §12
  (shipped in PR 62).
- Tenant discovery (Slice design option (a), `CompanyCreated`) is a technical decision needing an ADR, not an owner
  question.
- `.specify/extensions.yml` does not exist, so no before/after hooks ran.
