export const allowedImageContentTypes = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
] as const;

// Keep an individual Worker request comfortably below its memory/body budget.
// The web client chunks larger user selections into requests of this size.
export const maxMediaFilesPerRequest = 4;
export const maxMediaFilesPerSelection = 24;
export const maxMediaFileBytes = 8 * 1024 * 1024;
export const maxMediaCaptionLength = 160;

export function chunkMediaSelection<T>(
  values: readonly T[],
  size = maxMediaFilesPerRequest,
): T[][] {
  if (!Number.isInteger(size) || size < 1) {
    throw new TypeError('Upload chunk size must be a positive integer.');
  }
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}
