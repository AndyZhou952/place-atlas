import type {
  MediaObjectStore,
  NewMediaObject,
  StoredMediaObject,
} from '@/product/application/media/media-object-store';

export class R2MediaObjectStore implements MediaObjectStore {
  readonly #bucket: R2Bucket;

  constructor(bucket: R2Bucket) {
    this.#bucket = bucket;
  }

  async get(objectKey: string): Promise<StoredMediaObject | undefined> {
    const object = await this.#bucket.get(objectKey);
    if (!object) return undefined;
    return { body: object.body, etag: object.httpEtag };
  }

  async put(object: NewMediaObject): Promise<void> {
    await this.#bucket.put(object.objectKey, object.bytes, {
      httpMetadata: { contentType: object.contentType },
      customMetadata: {
        mediaId: object.mediaId,
        visitId: object.visitId,
        sha256: object.contentSha256,
      },
    });
  }

  async delete(objectKey: string): Promise<void> {
    await this.#bucket.delete(objectKey);
  }
}
