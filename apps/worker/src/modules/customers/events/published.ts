import {
  RATING_REQUEST_TEMPLATE_KEY,
  RATING_REQUEST_TEMPLATE_REVISION,
  ratingRequestReady,
  type RatingRequestReady,
} from '@pospay/contracts';

/** معاملات الرسالة الآمنة: اسم العميل الأول واسم النشاط والمنفذون. */
export interface RatingReadyParameters {
  readonly customerFirstName: string | null;
  readonly businessName: string;
  readonly performers: string;
}

/** مدخلات بناء حمولة حدث الجاهزية. */
export interface RatingRequestReadyInput {
  readonly eventId: string;
  readonly companyId: string;
  readonly businessId: string;
  readonly branchId: string | null;
  readonly ratingRequestId: string;
  readonly tokenKeyVersion: number;
  readonly phone: string;
  readonly locale: 'ar' | 'en';
  readonly parameters: RatingReadyParameters;
  readonly sendDeadline: Date | null;
}

/**
 * يبني حمولة «طلب التقييم جاهز»؛ اسم العميل الأول يُشطب لما مفيش اسم آمن للعرض.
 *
 * @param input هوية الطلب والمعلمات الآمنة ورقم العميل ولغته
 * @returns الحمولة بعد تحقق العقد
 */
export function ratingRequestReadyPayload(input: RatingRequestReadyInput): RatingRequestReady {
  const safeParameters = [
    ...(input.parameters.customerFirstName === null
      ? []
      : [
          {
            name: 'customer_first_name',
            type: 'text' as const,
            value: input.parameters.customerFirstName,
          },
        ]),
    { name: 'business_name', type: 'text' as const, value: input.parameters.businessName },
    { name: 'performers', type: 'text' as const, value: input.parameters.performers },
    { name: 'rating_request_id', type: 'text' as const, value: input.ratingRequestId },
  ];
  return ratingRequestReady.parse({
    event_id: input.eventId,
    company_id: input.companyId,
    business_id: input.businessId,
    branch_id: input.branchId,
    rating_request_id: input.ratingRequestId,
    token_key_version: input.tokenKeyVersion,
    notification_recipients: [
      {
        phone: input.phone,
        locale: input.locale,
        channel: 'whatsapp',
        template_key: RATING_REQUEST_TEMPLATE_KEY,
        template_revision: RATING_REQUEST_TEMPLATE_REVISION,
        safe_parameters: safeParameters,
        send_deadline: input.sendDeadline?.toISOString() ?? null,
      },
    ],
  });
}
