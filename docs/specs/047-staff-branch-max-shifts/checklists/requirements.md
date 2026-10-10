# Specification Quality Checklist: Max shifts per day becomes a per-branch setting

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-10-10
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] Business sections contain no implementation details; implementation decisions appear only under **Slice design**
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [ ] No [NEEDS CLARIFICATION] markers remain — three business rules are open as `TODO(spec) → MB-Q1 … MB-Q3`
- [x] Requirements are testable and unambiguous (apart from the three open rules, each with its listed options)
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified
- [x] **Slice design** complete: schema, API contract, permissions, events and test plan filled; the parts that depend on MB-Q2 are marked

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [ ] Feature meets measurable outcomes defined in Success Criteria — after MB-Q1 … MB-Q3
- [x] No implementation details leak into specification

## Notes

- Not ready for `/speckit-plan` until the owner answers MB-Q1 … MB-Q3 (`owner-questions.ar.md`).
- MS-Q2 … MS-Q6 and S020-SHIFTS from spec 042 stay binding and are not re-asked.
