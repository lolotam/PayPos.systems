import {
  endMembershipResult,
  inviteMemberInput,
  memberInvitation,
  memberInvitationPage,
  memberInvitationResult,
} from './member-invitation.js';

export const memberInvitationSchemas = [
  endMembershipResult,
  inviteMemberInput,
  memberInvitation,
  memberInvitationPage,
  memberInvitationResult,
];

const json = (name: string) => ({
  'application/json': { schema: { $ref: `#/components/schemas/${name}` } },
});
const parameter = (where: string, name: string, required: boolean, schema: object) => ({
  in: where,
  name,
  required,
  schema,
});
const company = parameter('header', 'x-company-id', true, { type: 'string', format: 'uuid' });
const invitation = parameter('path', 'invitationId', true, { type: 'string', format: 'uuid' });
const member = parameter('path', 'membershipId', true, { type: 'string', format: 'uuid' });
const pagination = [
  parameter('query', 'cursor', false, { type: 'string', format: 'uuid' }),
  parameter('query', 'limit', false, { type: 'integer', minimum: 1, maximum: 100, default: 20 }),
];

export const memberInvitationPaths = {
  '/v1/memberships/invitations': {
    post: {
      operationId: 'inviteMember',
      description:
        'Requires manage:memberships:company and the canonical company owner decided inside the write transaction. The set-password link is returned once and is never stored.',
      responses: {
        '201': { description: 'The invitation and its one-time link', content: json('MemberInvitationResult') },
        default: { description: 'The API error envelope', content: json('ErrorEnvelope') },
      },
      parameters: [company],
      requestBody: { required: true, content: json('InviteMemberInput') },
    },
    get: {
      operationId: 'listMemberInvitations',
      description: 'The company invitations; no link, no token and no plain email.',
      responses: {
        '200': { description: 'The invitation page', content: json('MemberInvitationPage') },
        default: { description: 'The API error envelope', content: json('ErrorEnvelope') },
      },
      parameters: [company, ...pagination],
    },
  },
  '/v1/memberships/invitations/{invitationId}/link': {
    post: {
      operationId: 'reissueMemberInvitationLink',
      description:
        'Only for a pending invitation created by the same owner, while the member never set a password; the earlier link stops working.',
      responses: {
        '200': { description: 'The new one-time link', content: json('MemberInvitationResult') },
        default: { description: 'The API error envelope', content: json('ErrorEnvelope') },
      },
      parameters: [company, invitation],
    },
  },
  '/v1/memberships/{membershipId}/end': {
    post: {
      operationId: 'endMembership',
      description:
        'Requires manage:memberships:company and the canonical company owner decided inside the write transaction. Ends the membership in this company only; the last active owner cannot be ended (409 LAST_OWNER). No request body.',
      responses: {
        '200': { description: 'The ended membership', content: json('EndMembershipResult') },
        '409': {
          description:
            'LAST_OWNER: the company would be left without an owner; STAFF_ACCESS_MANAGED_MEMBERSHIP: the membership is managed by employee staff access',
          content: json('ErrorEnvelope'),
        },
        default: { description: 'The API error envelope', content: json('ErrorEnvelope') },
      },
      parameters: [company, member],
    },
  },
};
