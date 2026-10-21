// بنّاءات الرد والطلب المشتركين اللي قائمة المسارات في openapi.ts بتستخدمها.
export const json = (schema: string) => ({
  'application/json': { schema: { $ref: `#/components/schemas/${schema}` } },
});

export function operation(
  operationId: string,
  status: '200' | '201' | '202',
  description: string,
  response: string,
  body?: string,
) {
  return {
    operationId,
    ...(body === undefined ? {} : { requestBody: { required: true, content: json(body) } }),
    responses: {
      [status]: { description, content: json(response) },
      default: { description: 'The API error envelope', content: json('ErrorEnvelope') },
    },
  };
}
