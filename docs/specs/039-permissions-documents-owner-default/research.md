# Research — 039 employee documents owner-only

- **Decision**: D1 — remove the three existing codes from GM/BM defaults. **Rationale**: owner answer OD-Q4 = B.
  **Alternatives**: D2 (new `read/manage:employee-documents:business` codes, keeps import for managers) — declined by
  the owner; D3 (remove read only) — semantically muddy.
- **Decision**: one reference-data migration that only DELETEs the five global rows (idempotent). **Rationale**:
  bundles are global rows resolved live (ADR-0025); the seed follows `ROLE_DEFAULTS`. **Alternatives**: grandfather
  personal ALLOWs for current managers — declined (OD-Q1 = A).
- **Decision**: eligibility through a new `OWNER_GRANTED_PERMISSIONS` list treated like `SCHEDULE_PERMISSIONS`
  (every human role eligible); the three codes are already in `deviceForbidden`. **Rationale**: OD-Q6 = A; one
  projection governs new and historical ALLOWs (ADR-0025).
- **Decision**: owner-only granting is a pure rule in `permissionEditFailure` on SAVE + ALLOW, fed by an
  `editorIsCompanyOwner` flag computed with `canonicalOwnerSql` over the editor's active memberships inside the same
  locked transaction. **Rationale**: OD-Q5 = A; same identity test as the owner-protection rule. DENY and revoke keep
  the existing rules (they only reduce access). **Alternatives**: a route guard — rejected, the decision needs the
  body and the locked snapshot.
- **Decision**: new error `PERMISSION_OWNER_ONLY` (403). **Rationale**: `PERMISSION_NOT_HELD` /
  `PERMISSION_ROLE_FORBIDDEN` would mislead the message shown to the editor.
- **Finding**: import upload needs `manage:files:business` + possession of `read:files:business`; template, preview
  and commit need `manage:employees:business` only. Tests cover GM-default 403 on upload and owner / granted success.
