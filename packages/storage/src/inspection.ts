import { fileTypeFromBuffer } from 'file-type';
import sharp from 'sharp';
import {
  FileValidationError,
  validateContent,
  validateUpload,
  type UploadPolicy,
} from './domain/files.ts';

export async function inspectContent(
  bytes: Uint8Array,
  declared: { type: string; size: number },
  policy: UploadPolicy,
) {
  let type: string | undefined;
  try {
    type = (await fileTypeFromBuffer(bytes))?.mime;
  } catch {
    throw new FileValidationError('FILE_CONTENT_INVALID');
  }
  validateContent(policy, declared, { type, size: bytes.byteLength });
  if (!declared.type.startsWith('image/')) return { bytes, type: declared.type };
  try {
    const format = declared.type === 'image/jpeg' ? 'jpeg' : 'png';
    const encoded = await sharp(bytes, {
      limitInputPixels: 16_000_000,
      failOn: 'warning',
      animated: false,
    })
      .autoOrient()
      .toFormat(format)
      .toBuffer();
    validateUpload(policy, declared.type, encoded.byteLength);
    return { bytes: new Uint8Array(encoded), type: declared.type };
  } catch (error) {
    if (error instanceof FileValidationError) throw error;
    throw new FileValidationError('FILE_CONTENT_INVALID');
  }
}
