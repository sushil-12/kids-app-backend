// Where pack media lives.
//
// Two kinds of media, one seam:
//
//   Narration   generated here (ElevenLabs), so we own the bytes and have to
//               put them somewhere.
//   Artwork     uploaded by an admin. Bytes never pass through this API — the
//               portal asks for a presigned PUT and sends the file straight to
//               S3 — but we record the object so it can be reused across packs
//               and deleted when it isn't.
//
// S3 is used when it's fully configured; otherwise narration falls back to
// inline Postgres storage and artwork stays paste-a-URL-only. That fallback is
// what lets a developer run the whole stack, seed it, and record nothing, with
// no cloud credentials at all — and it's why every caller goes through this
// interface instead of reaching for the SDK directly.
//
// Switching S3 on later is safe: existing Postgres-backed clips keep their
// inline bytes and keep serving from /v1/media/narration/:id.mp3, and packs
// already published with that URL keep working. Only new recordings go to the
// bucket.

import { randomUUID } from 'node:crypto';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import pino from 'pino';
import { config, isS3Configured } from '../config';
import { getClipById, upsertClip, NarrationClipInput } from '../db/pack.repo';

const logger = pino({ level: config.LOG_LEVEL });

/** Image types the portal may upload. Deliberately narrow: the signature binds
 *  the content type, so anything not on this list can't be pushed to the
 *  bucket even with a valid presigned URL. */
export const UPLOADABLE_IMAGE_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/svg+xml',
] as const;

const EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
  'audio/mpeg': 'mp3',
};

export interface StoredMedia {
  bytes: Buffer;
  mime: string;
}

export interface StoredNarration {
  id: string;
  /** The URL written into the pack. */
  url: string;
}

export interface PresignedUpload {
  /** PUT the file here, with exactly this Content-Type. */
  uploadUrl: string;
  /** Where the object will be readable once the PUT succeeds. */
  publicUrl: string;
  storageKey: string;
  expiresInSeconds: number;
}

export interface MediaStore {
  /** Whether artwork can be uploaded (vs. paste-a-URL only). */
  readonly canUpload: boolean;

  /** Persists a narration clip and returns the URL to put in the pack. */
  putNarration(input: NarrationClipInput): Promise<StoredNarration>;

  /** Reads an inline clip back for serving. Null when the id is unknown, or
   *  when the clip lives in object storage (the route redirects instead). */
  getNarration(id: string): Promise<StoredMedia | null>;

  /** Fallback URL through this API, for clips stored inline. */
  narrationUrl(id: string): string;

  /** A short-lived URL the portal can PUT one image to. */
  presignUpload(input: {
    filename: string;
    mime: string;
    byteLength: number;
    folder?: string;
  }): Promise<PresignedUpload>;

  /** Stores image bytes the SERVER already holds, rather than handing out a
   *  presigned URL for the browser to PUT.
   *
   *  Only one flow needs this: importing a GIF found in the portal's search.
   *  The bytes live on a third-party CDN, an admin approves the clip, and we
   *  copy it into our own bucket so a child's device never fetches children's
   *  content from someone else's host — and so the picture can't be swapped or
   *  removed out from under a published pack. */
  putImage(input: {
    bytes: Buffer;
    mime: string;
    filename: string;
    folder?: string;
  }): Promise<StoredImage>;

  /** Removes an object. Missing objects are not an error — the point is that
   *  the bucket ends up without it. */
  deleteObject(storageKey: string): Promise<void>;
}

export interface StoredImage {
  storageKey: string;
  url: string;
  mime: string;
  byteLength: number;
}

function sanitizeName(filename: string): string {
  const base = filename.replace(/\.[^.]+$/, '');
  return (
    base
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'image'
  );
}

function extensionFor(mime: string, filename: string): string {
  const known = EXTENSIONS[mime];
  if (known) return known;
  const guess = /\.([a-z0-9]{1,5})$/i.exec(filename)?.[1];
  return guess ? guess.toLowerCase() : 'bin';
}

class UploadsUnavailableError extends Error {
  constructor() {
    super('Artwork uploads need S3 — set S3_BUCKET, AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY');
    this.name = 'UploadsUnavailableError';
  }
}

// ── Postgres (no cloud credentials needed) ─────────────────────────────────

class PgMediaStore implements MediaStore {
  readonly canUpload = false;

  async putNarration(input: NarrationClipInput): Promise<StoredNarration> {
    const clip = await upsertClip({ ...input, storageKey: null, url: null });
    // The clip is addressed by row id, which only exists after the write.
    return { id: clip.id, url: this.narrationUrl(clip.id) };
  }

  async getNarration(id: string): Promise<StoredMedia | null> {
    const clip = await getClipById(id);
    if (!clip?.bytes) return null;
    return { bytes: Buffer.from(clip.bytes), mime: clip.mime };
  }

  narrationUrl(id: string): string {
    return `${config.PUBLIC_BASE_URL.replace(/\/+$/, '')}/v1/media/narration/${id}.mp3`;
  }

  async presignUpload(): Promise<PresignedUpload> {
    throw new UploadsUnavailableError();
  }

  async putImage(): Promise<StoredImage> {
    // Same reason as presignUpload: there is nowhere to put a picture. The
    // route surfaces this as "paste an image URL instead".
    throw new UploadsUnavailableError();
  }

  async deleteObject(): Promise<void> {
    // Nothing is stored outside the database, so there is nothing to remove.
  }
}

// ── S3 ─────────────────────────────────────────────────────────────────────

class S3MediaStore implements MediaStore {
  readonly canUpload = true;

  private readonly client: S3Client;
  private readonly bucket: string;

  constructor() {
    this.bucket = config.S3_BUCKET!;
    this.client = new S3Client({
      region: config.S3_REGION,
      credentials: {
        accessKeyId: config.AWS_ACCESS_KEY_ID!,
        secretAccessKey: config.AWS_SECRET_ACCESS_KEY!,
      },
    });
  }

  private key(...parts: string[]): string {
    return [config.S3_KEY_PREFIX, ...parts].filter(Boolean).join('/');
  }

  /** Public address of an object — the CDN if one is configured, else the
   *  virtual-hosted S3 URL. This string is written into published packs, so it
   *  must stay stable: to move behind a CDN later, point the CDN at the same
   *  bucket rather than rewriting content. */
  publicUrl(storageKey: string): string {
    const encoded = storageKey.split('/').map(encodeURIComponent).join('/');
    if (config.S3_PUBLIC_BASE_URL) return `${config.S3_PUBLIC_BASE_URL}/${encoded}`;
    return `https://${this.bucket}.s3.${config.S3_REGION}.amazonaws.com/${encoded}`;
  }

  async putNarration(input: NarrationClipInput): Promise<StoredNarration> {
    // Only the synthesizer calls this, and it always has fresh audio; a null
    // here would mean a caller trying to "store" a clip it never generated.
    if (!input.bytes) throw new Error('putNarration called with no audio');

    // Keyed by the content hash, so identical audio is one object no matter how
    // many times it's regenerated, and a re-record writes a NEW key — which is
    // what lets clip URLs be served immutable.
    const storageKey = this.key('narration', `${input.contentHash.slice(0, 32)}.mp3`);
    const url = this.publicUrl(storageKey);

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: storageKey,
        Body: input.bytes,
        ContentType: input.mime,
        CacheControl: 'public, max-age=31536000, immutable',
      }),
    );

    const clip = await upsertClip({
      ...input,
      // The row keeps the metadata; S3 keeps the audio.
      bytes: null,
      storageKey,
      url,
    });
    return { id: clip.id, url };
  }

  async getNarration(id: string): Promise<StoredMedia | null> {
    const clip = await getClipById(id);
    if (!clip) return null;
    // Clips recorded before S3 was switched on still have inline bytes.
    if (clip.bytes) return { bytes: Buffer.from(clip.bytes), mime: clip.mime };
    if (!clip.storageKey) return null;

    try {
      const object = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: clip.storageKey }),
      );
      const bytes = Buffer.from(await object.Body!.transformToByteArray());
      return { bytes, mime: clip.mime };
    } catch (err) {
      logger.error({ id, key: clip.storageKey, err }, 'narration clip missing from bucket');
      return null;
    }
  }

  narrationUrl(id: string): string {
    return `${config.PUBLIC_BASE_URL.replace(/\/+$/, '')}/v1/media/narration/${id}.mp3`;
  }

  /** Object key for one picture, shared by the presigned and server-side paths
   *  so imported GIFs and uploaded art land in the same place. */
  private imageKey(filename: string, mime: string, folder?: string): string {
    const safeFolder = (folder ?? 'packs').replace(/[^a-z0-9-]/gi, '') || 'packs';
    return this.key(
      'images',
      safeFolder,
      // A random segment keeps two uploads of "cover.png" from colliding, and
      // means a replaced picture gets a new URL rather than being masked by a
      // cached copy of the old one.
      `${sanitizeName(filename)}-${randomUUID().slice(0, 8)}.${extensionFor(mime, filename)}`,
    );
  }

  async presignUpload(input: {
    filename: string;
    mime: string;
    byteLength: number;
    folder?: string;
  }): Promise<PresignedUpload> {
    const storageKey = this.imageKey(input.filename, input.mime, input.folder);

    const expiresInSeconds = 900;
    const uploadUrl = await getSignedUrl(
      this.client,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: storageKey,
        ContentType: input.mime,
        ContentLength: input.byteLength,
        CacheControl: 'public, max-age=31536000, immutable',
      }),
      {
        expiresIn: expiresInSeconds,
        // content-length is signed by default; content-type is NOT unless it's
        // named here. Both matter: without them a signed URL for a small PNG
        // would happily accept a 2 GB file, or an HTML document that a browser
        // would then render from our own domain. The uploader must send
        // exactly these headers or S3 rejects the signature.
        signableHeaders: new Set(['content-type', 'content-length']),
      },
    );

    return {
      uploadUrl,
      publicUrl: this.publicUrl(storageKey),
      storageKey,
      expiresInSeconds,
    };
  }

  async putImage(input: {
    bytes: Buffer;
    mime: string;
    filename: string;
    folder?: string;
  }): Promise<StoredImage> {
    const storageKey = this.imageKey(input.filename, input.mime, input.folder);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: storageKey,
        Body: input.bytes,
        ContentType: input.mime,
        CacheControl: 'public, max-age=31536000, immutable',
      }),
    );
    return {
      storageKey,
      url: this.publicUrl(storageKey),
      mime: input.mime,
      byteLength: input.bytes.length,
    };
  }

  async deleteObject(storageKey: string): Promise<void> {
    try {
      await this.client.send(
        new DeleteObjectCommand({ Bucket: this.bucket, Key: storageKey }),
      );
    } catch (err) {
      // The caller's intent is "this object should not exist". Log and move on
      // rather than blocking the database cleanup on a bucket hiccup.
      logger.warn({ storageKey, err }, 'could not delete object from bucket');
    }
  }
}

export const mediaStore: MediaStore = isS3Configured(config)
  ? new S3MediaStore()
  : new PgMediaStore();

if (!isS3Configured(config)) {
  logger.warn(
    'S3 is not configured — narration will be stored in Postgres and artwork stays paste-a-URL only',
  );
}
