import {
  allowedImageContentTypes,
  maxMediaCaptionLength,
  maxMediaFileBytes,
} from '../../features/atlas/media-constraints.ts';

export {
  allowedImageContentTypes,
  maxMediaCaptionLength,
  maxMediaFileBytes,
} from '../../features/atlas/media-constraints.ts';

export function normalizeMediaCaption(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new TypeError('Caption must be text.');
  const caption = value.trim().replace(/\s+/g, ' ');
  if (caption.length > maxMediaCaptionLength) {
    throw new TypeError(
      `Caption must be ${maxMediaCaptionLength} characters or fewer.`,
    );
  }
  return caption || undefined;
}

export function assertAllowedImage(
  contentType: string,
  bytes: Uint8Array,
): void {
  if (
    !allowedImageContentTypes.includes(
      contentType as (typeof allowedImageContentTypes)[number],
    )
  ) {
    throw new TypeError('Use a JPEG, PNG, WebP, or GIF image.');
  }
  if (!bytes.byteLength || bytes.byteLength > maxMediaFileBytes) {
    throw new TypeError('Each image must be between 1 byte and 8 MB.');
  }
  if (!hasMatchingSignature(contentType, bytes)) {
    throw new TypeError('The file contents do not match the image type.');
  }
}

function hasMatchingSignature(contentType: string, bytes: Uint8Array): boolean {
  if (contentType === 'image/jpeg') {
    return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (contentType === 'image/png') {
    return (
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47 &&
      bytes[4] === 0x0d &&
      bytes[5] === 0x0a &&
      bytes[6] === 0x1a &&
      bytes[7] === 0x0a
    );
  }
  if (contentType === 'image/webp') {
    return ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP';
  }
  return ascii(bytes, 0, 6) === 'GIF87a' || ascii(bytes, 0, 6) === 'GIF89a';
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.slice(start, end));
}
