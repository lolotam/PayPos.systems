# #774 — Localized catalog missing-value placeholder

Baseline: `ff551062ce56a9a57cd6aa7a9abd6f67e1a2bbb2`. Issue: <https://github.com/lolotam/PayPos.systems/issues/774>.

## Requirements

Add `catalogServices.missingValue` with the visible em dash `—` to both locales. Replace the missing duration and category literals in `ServiceTableRow` using `t(locale, 'catalogServices.missingValue')`. Preserve populated values, category labels, LTR numeric islands, RTL behavior and all layout.

## Acceptance

Rendered tests exercise both locales and both missing cells; Arabic renders under RTL. Preserve visible populated-duration/category, closed-category and filtering regressions. Do not test merely that translation mocks were called. This is a behavior-preserving localization cleanup; a visible baseline may already pass before the key is added.

## Exact write scope

- `apps/admin/src/catalog/ui/service-table-row.tsx`
- `apps/admin/src/catalog/ui/services-list.spec.tsx`
- `packages/i18n/src/catalog-services.ts`
- This task's docs only.

No redesign, new wording, global provider/locale edits, API/database behavior, shared configuration, lockfile, workflows, contracts or global docs. Expected authored additions plus deletions: 100 lines; more than 200 requires rescoping.
