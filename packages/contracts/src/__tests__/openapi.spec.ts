import { describe, expect, it } from 'vitest';

import committed from '../../openapi/openapi.json' with { type: 'json' };
import { buildOpenApiDocument } from '../openapi.js';

const expectedSchemas = [
  'Branch',
  'Business',
  'BusinessSettings',
  'Calendar',
  'CashierPinVerified',
  'ClaimDeviceInput',
  'Company',
  'CreateBranchInput',
  'CreateBusinessInput',
  'CreateCompanyInput',
  'Currency',
  'DeliveryLogItem',
  'DeliveryLogPage',
  'DeliveryLogQuery',
  'DeviceIdentity',
  'DeviceRegistration',
  'DeviceToken',
  'ErrorEnvelope',
  'GeoPoint',
  'InAppNotification',
  'InAppNotificationPage',
  'InAppNotificationQuery',
  'Language',
  'MembershipPageQuery',
  'MembershipPermissions',
  'MyWorkspacesResponse',
  'NotificationReadResult',
  'NotificationUnreadCount',
  'OpeningHours',
  'PageQuery',
  'PairingCode',
  'PermissionMembership',
  'PermissionMembershipPage',
  'PermissionOverride',
  'PermissionOverrideInput',
  'PermissionOverridePage',
  'Plan',
  'RegisterDeviceInput',
  'TaxRule',
  'TimeZone',
  'UpdateBusinessSettingsInput',
  'VerifyCashierPinInput',
  'VerticalType',
  'WhatsappEnvelope',
  'WhatsappHandshake',
  'WhatsappWebhookAcknowledgement',
  'WorkspaceBranch',
  'WorkspaceBusiness',
  'WorkspaceCompany',
];

describe('openapi/openapi.json', () => {
  it('matches the contracts — run `pnpm contracts:openapi` after changing a schema', () => {
    expect(buildOpenApiDocument()).toEqual(committed);
  });

  it('publishes every schema with no $id inside a component', () => {
    const schemas = (buildOpenApiDocument()['components'] as { schemas: Record<string, object> })
      .schemas;
    expect(Object.keys(schemas).sort()).toEqual(expectedSchemas);
    for (const schema of Object.values(schemas)) {
      expect(schema).not.toHaveProperty('$id');
    }
  });

  it('publishes currency and timezone as closed enums, so generated clients reject unknown values', () => {
    const schemas = (
      buildOpenApiDocument()['components'] as { schemas: Record<string, { enum?: string[] }> }
    ).schemas;
    expect(schemas['Currency']?.enum).toContain('KWD');
    expect(schemas['Currency']?.enum).not.toContain('ZZZ');
    expect(schemas['TimeZone']?.enum).toContain('Asia/Kuwait');
    expect(schemas['TimeZone']?.enum).not.toContain('Asia/Atlantis');
  });
});
