import { PRIVATE_VIEW_WINDOW_HEADER } from './private-view.js';

const json = (schema: string) => ({
  'application/json': { schema: { $ref: `#/components/schemas/${schema}` } },
});

const envelope = { description: 'The API error envelope', content: json('ErrorEnvelope') };

const windowHeader = {
  in: 'header',
  name: PRIVATE_VIEW_WINDOW_HEADER,
  required: true,
  schema: { type: 'string', maxLength: 64 },
};

// مسارات نافذة العرض الخاص (spec 060 D-A13): الفتح بPIN، واللمس يطوّل الخمول، والقفل بينهي النافذة.
export const privateViewPaths = {
  '/v1/staff/me/private-view': {
    post: {
      operationId: 'openPrivateView',
      security: [{ DeviceToken: [], KioskStaffSession: [] }],
      description:
        'Opens the private-view window for the signed-in operator after a fresh PIN. The PIN proves the operator only; it is never stored, logged or returned. The window is bound to the session, the operator and the device, and the same attempt counter as the PIN sign-in counts it.',
      requestBody: { required: true, content: json('PrivateViewOpenInput') },
      responses: {
        '200': { description: 'The opened window', content: json('PrivateViewWindow') },
        '400': envelope,
        '401': {
          description:
            'PIN_INVALID (wrong PIN, or locked out) or UNAUTHENTICATED (the session ended during the opening)',
          content: json('ErrorEnvelope'),
        },
        '403': envelope,
        '503': { description: 'NOT_READY', content: json('ErrorEnvelope') },
        default: envelope,
      },
    },
  },
  '/v1/staff/me/private-view/touch': {
    post: {
      operationId: 'touchPrivateView',
      security: [{ DeviceToken: [], KioskStaffSession: [] }],
      description:
        'Keeps the private-view window alive and answers the two remaining times. The window id travels in the header; a missing, malformed or expired window answers 403 PRIVATE_VIEW_EXPIRED and never a 400.',
      parameters: [windowHeader],
      responses: {
        '200': { description: 'The remaining times', content: json('PrivateViewTouch') },
        '401': envelope,
        '403': { description: 'PRIVATE_VIEW_EXPIRED or FORBIDDEN', content: json('ErrorEnvelope') },
        '503': { description: 'NOT_READY', content: json('ErrorEnvelope') },
        default: envelope,
      },
    },
  },
  '/v1/staff/me/private-view/close': {
    post: {
      operationId: 'closePrivateView',
      security: [{ DeviceToken: [], KioskStaffSession: [] }],
      description:
        'Closes the private-view window. The answer is 204 whether the window was there or not, so it never tells the caller whether a window id was live.',
      parameters: [windowHeader],
      responses: {
        '204': { description: 'The window is closed; nothing else is said about it' },
        '401': envelope,
        '403': { description: 'FORBIDDEN', content: json('ErrorEnvelope') },
        '503': { description: 'NOT_READY', content: json('ErrorEnvelope') },
        default: envelope,
      },
    },
  },
};
