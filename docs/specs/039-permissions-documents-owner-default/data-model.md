# Data model — 039

No table or column changes.

## role_permissions (global system-role rows)

| role | read:files:business | manage:files:business | manage:document-types:company |
|---|---|---|---|
| owner (`…0101`) | ✅ kept | ✅ kept | ✅ kept |
| general_manager (`…0102`) | ❌ deleted | ❌ deleted | ❌ deleted |
| business_manager (`…0104`) | ❌ deleted | ❌ deleted | — (never stored) |

## Eligibility (systemRolePolicy, not stored)

All three codes: eligible on all 13 human system roles; Device never. Custom roles: unchanged PR 7 policy.

## permission_overrides

Rows unchanged. New rule when saving an ALLOW of the three codes: the editor must be the canonical active company
owner (membership on the global owner role, COMPANY scope of this company, active now).
