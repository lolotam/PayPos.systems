import {
  inviteMemberInput,
  memberInvitation,
  memberInvitationPage,
  memberInvitationResult,
} from './member-invitation.js';

export const memberInvitationSchemas = [
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
};
