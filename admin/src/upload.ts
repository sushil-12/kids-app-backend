import { api } from './api';
import type { MediaAsset, MediaConfig } from './types';

// Uploading a picture, in three steps:
//
//   1. ask the backend for a presigned PUT
//   2. send the file straight to S3 — the bytes never touch our API, so a 15 MB
//      illustration doesn't sit in the server's memory or block a request
//   3. register the result so the picture joins the reusable library
//
// If step 3 fails the object is in the bucket but not in the library; that's a
// stray file, not a broken pack, and it's why the backend keeps a delete path.

interface Presigned {
  uploadUrl: string;
  publicUrl: string;
  storageKey: string;
  expiresInSeconds: number;
}

export async function loadMediaConfig(): Promise<MediaConfig> {
  return api.get<MediaConfig>('/v1/admin/media/config');
}

export async function uploadImage(
  file: File,
  opts: { folder?: string; onProgress?: (fraction: number) => void } = {},
): Promise<MediaAsset> {
  const signed = await api.post<Presigned>('/v1/admin/media/presign', {
    filename: file.name,
    mime: file.type,
    byteLength: file.size,
    folder: opts.folder,
  });

  await putToS3(signed.uploadUrl, file, opts.onProgress);

  return api.post<MediaAsset>('/v1/admin/media', {
    storageKey: signed.storageKey,
    url: signed.publicUrl,
    mime: file.type,
    byteLength: file.size,
    originalName: file.name,
    folder: opts.folder,
  });
}

/** XHR rather than fetch, purely for upload progress — a 15 MB PNG on a slow
 *  connection is long enough that a silent spinner feels broken. */
function putToS3(
  url: string,
  file: File,
  onProgress?: (fraction: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url, true);
    // Must match the signed Content-Type exactly, or S3 rejects the signature.
    xhr.setRequestHeader('Content-Type', file.type);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve();
      // The usual cause is bucket CORS not allowing PUT from this origin.
      reject(
        new Error(
          `S3 rejected the upload (${xhr.status}). If this is a fresh bucket, check its CORS rules allow PUT from ${window.location.origin}.`,
        ),
      );
    };
    xhr.onerror = () =>
      reject(
        new Error(
          `Could not reach S3. This is almost always bucket CORS — it must allow PUT from ${window.location.origin}.`,
        ),
      );
    xhr.send(file);
  });
}

export function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
