# Contract delta — permission overrides

Endpoints (shapes unchanged): `POST /v1/permissions/memberships/:membershipId/overrides` and the business-scoped
`POST /v1/businesses/:businessId/permissions/memberships/:membershipId/overrides`.

New error, same envelope `{ code, message_ar, message_en }`:

| code | HTTP | when |
|---|---|---|
| `PERMISSION_OWNER_ONLY` | 403 | effect `ALLOW`, permission_code ∈ {`read:files:business`, `manage:files:business`, `manage:document-types:company`}, and the editor is not the canonical active company owner |

`message_ar`: «صاحب الشركة فقط يقدر يمنح الصلاحية دي» · `message_en`: "Only the company owner can grant this permission".
No Zod or OpenAPI shape change.
