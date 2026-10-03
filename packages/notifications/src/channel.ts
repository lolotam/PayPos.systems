export interface TemplateComponent {
  readonly type: 'header' | 'body' | 'button';
  readonly sub_type?: 'url';
  readonly index?: string;
  readonly parameters: readonly { readonly type: 'text'; readonly text: string }[];
}

export interface ChannelRequest {
  readonly phone: string;
  readonly locale: 'ar' | 'en';
  readonly providerTemplateName: string;
  readonly components: readonly TemplateComponent[];
  readonly deadline: Date | null;
}

export type ChannelResult =
  | { readonly kind: 'accepted'; readonly providerMessageId: string }
  | { readonly kind: 'expired' }
  | {
      readonly kind: 'refused';
      readonly code: 'CAPABILITY_UNAVAILABLE';
      readonly outcomeKnown: true;
    }
  | { readonly kind: 'rejected'; readonly code: 'PROVIDER_4XX'; readonly outcomeKnown: true }
  | {
      readonly kind: 'unknown';
      readonly code: 'PROVIDER_5XX' | 'NETWORK_UNKNOWN' | 'RESPONSE_INVALID';
      readonly outcomeKnown: false;
    };

/** قناة إرسال واحدة؛ مسؤولية الإعادة والتسجيل تبقى عند المستهلك. */
export interface Channel<Request = ChannelRequest> {
  /** يقدم طلبًا واحدًا فقط ويعيد دليل القبول أو الرفض أو عدم اليقين بدون جسم المزود. */
  send(request: Request): Promise<ChannelResult>;
}
