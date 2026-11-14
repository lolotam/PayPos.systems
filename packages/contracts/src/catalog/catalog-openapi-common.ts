// أدوات بناء مسارات الكتالوج في OpenAPI: مرجع السكيما، ومعاملات المسار، ورمز الخطأ بلغتين.
export const json = (schema: string) => ({
  'application/json': { schema: { $ref: `#/components/schemas/${schema}` } },
});

export const parameters = [
  {
    in: 'header',
    name: 'x-company-id',
    required: true,
    schema: { type: 'string', format: 'uuid' },
  },
  { in: 'path', name: 'businessId', required: true, schema: { type: 'string', format: 'uuid' } },
];

export const serviceId = {
  in: 'path',
  name: 'serviceId',
  required: true,
  schema: { type: 'string', format: 'uuid' },
};

export const packageTypeId = { ...serviceId, name: 'packageTypeId' };
export const categoryId = { ...serviceId, name: 'categoryId' };
export const closingId = { ...serviceId, name: 'closingId' };
export const branchId = { ...serviceId, name: 'branchId' };
export const errors = { description: 'Bilingual refusal', content: json('ErrorEnvelope') };
