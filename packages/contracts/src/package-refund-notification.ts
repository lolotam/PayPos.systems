import { z } from 'zod';
import { inAppBase } from './in-app-base.js';
import { displayParameter, moneyParameter } from './in-app-parameters.js';

/** ترتيب قالب package_refund_recorded ثابت؛ الجرس بلا سبب وبلا اسم عميل وبلا هوية مسترد. */
export const packageRefundRecordedParameters = z.tuple([
  displayParameter('package_name_ar'),
  displayParameter('package_name_en'),
  displayParameter('branch_name_ar'),
  displayParameter('branch_name_en'),
  z.strictObject({
    name: z.literal('sessions'),
    type: z.literal('text'),
    value: z.string().regex(/^(?:[1-9]\d?|1\d\d|2\d\d|3[0-5]\d|36[0-5])$/),
  }),
  moneyParameter('amount'),
  z.strictObject({
    name: z.literal('business_date'),
    type: z.literal('text'),
    value: z.iso.date(),
  }),
]);

/** مراجعة القالب 1 لأن نص الاسترداد ثابت؛ تغيير النص لاحقًا مراجعة جديدة حتى لا يُعاد تفسير الصفوف المخزنة. */
export const packageRefundRecordedRecipient = z.strictObject({
  ...inAppBase,
  template_key: z.literal('package_refund_recorded'),
  safe_parameters: packageRefundRecordedParameters,
});
