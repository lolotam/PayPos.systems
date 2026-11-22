# 62-2e Employee document number implementation plan

1. Add the nullable column and unvalidated constraint in `0237`. Validate the constraint in the separate `0238` migration.
2. Accept the number when recording or replacing a document. The list and business lookup use one read-only PostgreSQL snapshot for authorization and document rows. Use a canonical business UUID for access decisions.
3. Add the upload input, the document table column and the on-demand bell lookup. Reset the bell's read on known access or document changes. Wait for the upload's document refresh and refetch after connectivity returns. Clear the form number after success and preserve it on failure so the user can retry.
4. Regenerate OpenAPI and the Admin, Menu and POS clients. Verify old document lists and verify that uploads without a number send the prior request shape.

```text
pnpm --filter @pospay/api exec vitest run --no-file-parallelism src/modules/staff/__tests__/employee-document-numbers-http.spec.ts src/modules/staff/__tests__/employee-documents.spec.ts src/modules/staff/__tests__/employee-document-number-privacy.spec.ts src/modules/staff/__tests__/employee-documents-rls.spec.ts
pnpm --filter @pospay/admin exec vitest run src/notifications/ui/document-number-bell.spec.tsx src/staff/api/employee-document-refresh-access.spec.tsx src/staff/api/employee-document-notification-race.spec.tsx src/staff/ui/employee-document-form.spec.tsx
pnpm migration-chain:check
```

Run the PostgreSQL suites on an isolated lane. The production browser job verifies the staff route and download popup lifecycle. Keep the existing migration order and obtain the independent authorization before applying these migrations on a target.

Roll out the number-capable API before the Admin version that offers number entry. When rolling back the API, roll Admin back first to preserve number entry. Uploads with the number left blank work against either API version.

[Original design and acceptance cases](https://github.com/lolotam/PayPos.systems/tree/67499fe0e108006f231c7deb301a16fdc154ae2c/docs/specs/060-ratings-and-staff-app/61-2a-62-2e/plan.md#4-row-62-2e--design).
