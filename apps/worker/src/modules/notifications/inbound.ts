import type { startWhatsappInbound } from './whatsapp-inbound.module.ts';

/** استقبال الواتساب — القراءة والصيانة فقط؛ هو القدر الوحيد اللي بيقرا صندوق الواتساب. */
export type Inbound = ReturnType<typeof startWhatsappInbound>;
