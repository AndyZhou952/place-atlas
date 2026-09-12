export interface StoredMediaObject {
  readonly body: ReadableStream<Uint8Array>;
  readonly etag?: string;
}

export interface NewMediaObject {
  readonly objectKey: string;
  readonly bytes: Uint8Array;
  readonly contentType: string;
  readonly mediaId: string;
  readonly visitId: string;
  readonly contentSha256: string;
}

export interface MediaObjectStore {
  get(objectKey: string): Promise<StoredMediaObject | undefined>;
  put(object: NewMediaObject): Promise<void>;
  delete(objectKey: string): Promise<void>;
}
