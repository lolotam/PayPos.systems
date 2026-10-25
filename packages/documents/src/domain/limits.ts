import {
  DOCUMENT_BYTES_MAX_BYTES,
  DOCUMENT_HTML_MAX_BYTES,
  DOCUMENT_PDF_MAX_BYTES,
} from '@pospay/contracts';

import { DocumentTooLargeError } from './errors.ts';

/**
 * بيرفض HTML أطول من السقف قبل ما يتفتح له سياق متصفح.
 * الحد بالبايت مش بالحروف عشان النص العربي ما يتعدّاش الذاكرة وهو متخفي.
 *
 * @param html المستند الكامل
 * @returns لا شيء؛ بيرمي DocumentTooLargeError لو السقف اتكسر
 */
export function assertHtmlWithinLimit(html: string): void {
  if (Buffer.byteLength(html) > DOCUMENT_HTML_MAX_BYTES) throw new DocumentTooLargeError('html');
}

/**
 * بيرفض PDF أطول من السقف قبل ما يتكتب في Redis.
 * الملف مش تخزين؛ نسخة أكبر من السقف كانت هتقعد في الذاكرة لحد ما المفتاح يخلص.
 *
 * @param pdf بايتات الملف
 * @returns نفس البايتات لما تكون جوه السقف
 */
export function assertPdfWithinLimit(pdf: Uint8Array): Uint8Array {
  if (pdf.byteLength > DOCUMENT_PDF_MAX_BYTES) throw new DocumentTooLargeError('pdf');
  return pdf;
}

/**
 * بيرفض بايتات مستند أطول من السقف قبل ما تتكتب في Redis.
 * سقفها نفس سقف PDF عشان نسخة أكبر ما تقعدش في الذاكرة لحد ما المفتاح يخلص.
 *
 * @param bytes بايتات المستند
 * @returns نفس البايتات لما تكون جوه السقف
 */
export function assertBytesWithinLimit(bytes: Uint8Array): Uint8Array {
  if (bytes.byteLength > DOCUMENT_BYTES_MAX_BYTES) throw new DocumentTooLargeError('bytes');
  return bytes;
}
