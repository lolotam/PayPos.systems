import { z } from 'zod';
import { ownAttendance } from './own-attendance.js';
const errorContent = {
  'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } },
};
export const ownAttendancePaths = {
  '/v1/staff/me/attendance': {
    get: {
      operationId: 'ownAttendance',
      description:
        'Own attendance only, live employee, membership, own permission and staff feature. STAFF_POS requires a live private-view window. No correction metadata. Cache-Control: no-store.',
      parameters: [
        {
          in: 'query',
          name: 'month',
          required: false,
          schema: { type: 'string', pattern: '^[1-9][0-9]{3}-(0[1-9]|1[0-2])$' },
        },
        {
          in: 'header',
          name: 'x-private-view-window-id',
          required: false,
          schema: { type: 'string' },
        },
      ],
      security: [{ PersonalStaffSession: [] }, { KioskStaffSession: [], DeviceToken: [] }],
      responses: {
        '200': {
          description: 'Own current attendance times and exception kinds only',
          headers: {
            'Cache-Control': { schema: { type: 'string', enum: ['no-store'] } },
          },
          content: {
            'application/json': {
              schema: z.toJSONSchema(ownAttendance, { target: 'openapi-3.0', io: 'input' }),
            },
          },
        },
        '400': { description: 'VALIDATION_FAILED', content: errorContent },
        '401': { description: 'UNAUTHENTICATED', content: errorContent },
        '403': { description: 'FORBIDDEN or PRIVATE_VIEW_EXPIRED', content: errorContent },
        '422': { description: 'MY_PERIOD_OUT_OF_RANGE', content: errorContent },
      },
    },
  },
};
