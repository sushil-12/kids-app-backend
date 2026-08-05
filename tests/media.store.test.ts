import { describe, it, expect, beforeAll } from 'vitest';

// The S3 store's own logic: object keys, public URLs and what a presigned URL
// actually commits the uploader to. The AWS SDK signs locally, so none of this
// touches the network or needs a real bucket.
//
// Config is read at module load, so the env has to be in place before the
// import — hence the dynamic import inside beforeAll.

type Store = typeof import('../src/services/media.store').mediaStore;

let store: Store;

beforeAll(async () => {
  process.env.S3_BUCKET = 'brightmind-media';
  process.env.S3_REGION = 'ap-southeast-2';
  process.env.AWS_ACCESS_KEY_ID = 'AKIATEST';
  process.env.AWS_SECRET_ACCESS_KEY = 'secret';
  process.env.S3_KEY_PREFIX = 'brightmind';
  delete process.env.S3_PUBLIC_BASE_URL;

  const configModule = await import('../src/config');
  // Sanity: if this is false the rest of the file is testing the wrong store.
  expect(configModule.isS3Configured(configModule.config)).toBe(true);

  ({ mediaStore: store } = await import('../src/services/media.store'));
});

describe('S3 media store', () => {
  it('reports that uploads are available', () => {
    expect(store.canUpload).toBe(true);
  });

  it('builds a tidy, collision-proof object key from a messy file name', async () => {
    const signed = await store.presignUpload({
      filename: 'Crow Drinks Water!.PNG',
      mime: 'image/png',
      byteLength: 2048,
      folder: 'thirsty-crow',
    });

    expect(signed.storageKey).toMatch(
      /^brightmind\/images\/thirsty-crow\/crow-drinks-water-[0-9a-f]{8}\.png$/,
    );
  });

  it('gives two uploads of the same name different keys', async () => {
    const a = await store.presignUpload({ filename: 'cover.png', mime: 'image/png', byteLength: 10 });
    const b = await store.presignUpload({ filename: 'cover.png', mime: 'image/png', byteLength: 10 });
    // A replaced picture must get a new URL, or a cached copy of the old one
    // would keep showing.
    expect(a.storageKey).not.toBe(b.storageKey);
  });

  it('addresses objects by their virtual-hosted S3 URL when no CDN is set', async () => {
    const signed = await store.presignUpload({ filename: 'a.png', mime: 'image/png', byteLength: 10 });
    expect(signed.publicUrl).toBe(
      `https://brightmind-media.s3.us-east-2.amazonaws.com/${signed.storageKey}`,
    );
  });

  it('signs both the content type and the length', async () => {
    const signed = await store.presignUpload({
      filename: 'a.png',
      mime: 'image/png',
      byteLength: 2048,
    });
    const headers = new URL(signed.uploadUrl).searchParams.get('X-Amz-SignedHeaders');

    // Without these, a URL signed for a small PNG would accept a 2 GB file, or
    // an HTML document a browser would render from our own domain.
    expect(headers).toContain('content-type');
    expect(headers).toContain('content-length');
  });

  it('expires the upload window quickly', async () => {
    const signed = await store.presignUpload({ filename: 'a.png', mime: 'image/png', byteLength: 10 });
    expect(signed.expiresInSeconds).toBeLessThanOrEqual(900);
    expect(new URL(signed.uploadUrl).searchParams.get('X-Amz-Expires')).toBe('900');
  });

  it('sanitises a path-traversal attempt in the folder name', async () => {
    const signed = await store.presignUpload({
      filename: 'a.png',
      mime: 'image/png',
      byteLength: 10,
      folder: '../../etc',
    });
    // The key must stay inside our prefix no matter what the caller sends.
    expect(signed.storageKey.startsWith('brightmind/images/')).toBe(true);
    expect(signed.storageKey).not.toContain('..');
  });

  it('keeps unnamed files addressable', async () => {
    const signed = await store.presignUpload({ filename: '!!!.png', mime: 'image/png', byteLength: 10 });
    expect(signed.storageKey).toMatch(/\/image-[0-9a-f]{8}\.png$/);
  });
});
