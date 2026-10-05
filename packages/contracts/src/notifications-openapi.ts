const json = (schema: string) => ({
  'application/json': { schema: { $ref: `#/components/schemas/${schema}` } },
});

function operation(operationId: string, status: string, description: string, response: string) {
  return {
    operationId,
    responses: {
      [status]: { description, content: json(response) },
      default: { description: 'The API error envelope', content: json('ErrorEnvelope') },
    },
  };
}

export const notificationPaths = {
  '/v1/me/notifications': {
    get: inboxOperation('listMyNotifications', 'InAppNotificationPage', true),
  },
  '/v1/me/notifications/unread-count': {
    get: inboxOperation('countMyUnreadNotifications', 'NotificationUnreadCount'),
  },
  '/v1/me/notifications/{id}/read': {
    post: inboxOperation('readMyNotification', 'NotificationReadResult', false, true),
  },
  '/v1/me/notifications/read-all': {
    post: inboxOperation('readAllMyNotifications', 'NotificationReadResult'),
  },
  '/v1/notifications/delivery-log': {
    get: logOperation('listCompanyNotificationDeliveries'),
  },
  '/v1/businesses/{businessId}/notifications/delivery-log': {
    get: logOperation('listBusinessNotificationDeliveries', 'businessId'),
  },
  '/v1/branches/{branchId}/notifications/delivery-log': {
    get: logOperation('listBranchNotificationDeliveries', 'branchId'),
  },
};

function inboxOperation(operationId: string, response: string, paginated = false, single = false) {
  return {
    ...operation(operationId, '200', 'Personal notifications in the selected company', response),
    parameters: [
      {
        in: 'header',
        name: 'x-company-id',
        required: true,
        schema: { type: 'string', format: 'uuid' },
      },
      ...(paginated
        ? [
            { in: 'query', name: 'cursor', required: false, schema: { type: 'string' } },
            {
              in: 'query',
              name: 'limit',
              required: false,
              schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
            },
          ]
        : []),
      ...(single
        ? [{ in: 'path', name: 'id', required: true, schema: { type: 'string', format: 'uuid' } }]
        : []),
    ],
  };
}

function logOperation(operationId: string, scope?: string) {
  return {
    ...operation(
      operationId,
      '200',
      'Provider submission log for the guarded scope',
      'DeliveryLogPage',
    ),
    parameters: [
      {
        in: 'header',
        name: 'x-company-id',
        required: true,
        schema: { type: 'string', format: 'uuid' },
      },
      { in: 'query', name: 'cursor', required: false, schema: { type: 'string' } },
      {
        in: 'query',
        name: 'limit',
        required: false,
        schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
      },
      ...(scope === undefined
        ? []
        : [
            { in: 'path', name: scope, required: true, schema: { type: 'string', format: 'uuid' } },
          ]),
    ],
  };
}
