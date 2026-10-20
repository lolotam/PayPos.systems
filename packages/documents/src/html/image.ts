import { raw, type HtmlFragment } from './fragment.ts';

const IMAGE_MIMES = ['image/png', 'image/jpeg'] as const;

export type ImageMime = (typeof IMAGE_MIMES)[number];

function isImageMime(mime: string): mime is ImageMime {
  return (IMAGE_MIMES as readonly string[]).includes(mime);
}

/**
 * صورة مضمّنة كـ data URI. مفيش src خارجي، والنوعين المسموحين بس هما اللي الطباعة بتحتاجهم.
 *
 * @param bytes بايتات الصورة
 * @param mime image/png أو image/jpeg
 * @returns قطعة data URI جاهزة تتحط في src
 */
export function imageDataUri(bytes: Uint8Array, mime: ImageMime): HtmlFragment {
  if (!isImageMime(mime)) throw new Error('DOCUMENT_IMAGE_MIME');
  return raw(`data:${mime};base64,${Buffer.from(bytes).toString('base64')}`);
}
