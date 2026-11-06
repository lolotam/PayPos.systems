import { z } from 'zod';
import { ownServiceLines } from './own-service-lines.js';

const errorContent = {
  'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } },
};
export const ownServiceLinesPaths = {
  '/v1/staff/me/service-lines': {
    get: {
      operationId: 'ownServiceLines',
      description:
        'Own current-performer lines in the session business. Hidden columns are absent. Device branch proves current authority only. line_id (UUID v7) and cancelled_at are context fields: hiding time does not hide recording/cancellation instants. Cursor is line_id only; a removed, foreign or other-month anchor returns uniform 400; restart from page one. Cancelled anchors remain valid. Cache-Control: no-store.',
      security: [{ PersonalStaffSession: [] }, { KioskStaffSession: [], DeviceToken: [] }],
      parameters: [
        {
          in: 'query',
          name: 'month',
          required: false,
          schema: { type: 'string', pattern: '^[1-9][0-9]{3}-(0[1-9]|1[0-2])$' },
        },
        {
          in: 'query',
          name: 'cursor',
          required: false,
          schema: { type: 'string', format: 'uuid' },
        },
        {
          in: 'query',
          name: 'limit',
          required: false,
          schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
        },
        {
          in: 'header',
          name: 'x-private-view-window-id',
          required: false,
          schema: { type: 'string' },
        },
      ],
      responses: {
        '200': {
          description: 'Own lines, newest business date, occurrence instant and line id first',
          headers: { 'Cache-Control': { schema: { type: 'string', enum: ['no-store'] } } },
          content: {
            'application/json': {
              schema: z.toJSONSchema(ownServiceLines, {
                target: 'openapi-3.0',
                io: 'input',
                metadata: z.registry(),
              }),
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
