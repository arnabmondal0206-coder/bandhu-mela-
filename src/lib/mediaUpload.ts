import { getDownloadURL, ref, uploadBytesResumable } from 'firebase/storage';
import { auth, storage } from './firebase';

export type UploadFolder = 'avatars' | 'covers' | 'posts' | 'stories' | 'reels' | 'chats';

export interface UploadMediaOptions {
  onProgress?: (progressPct: number, stage: string) => void;
}

const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif']);
const ALLOWED_VIDEO_TYPES = new Set(['video/mp4', 'video/webm', 'video/quicktime']);
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_VIDEO_BYTES = 25 * 1024 * 1024;

let cachedBucketStatus: { bucket: string; available: boolean; checkedAt: number } | null = null;

async function isFirebaseStorageBucketAvailable(): Promise<boolean> {
  const bucket = storage.app.options.storageBucket;
  if (!bucket) return false;

  const now = Date.now();
  if (cachedBucketStatus && cachedBucketStatus.bucket === bucket && now - cachedBucketStatus.checkedAt < 60_000) {
    return cachedBucketStatus.available;
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);
    const resp = await fetch(`https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket)}/o?maxResults=1`, {
      method: 'GET',
      signal: controller.signal,
    });
    clearTimeout(timer);
    // 404 explicitly indicates the Storage bucket has not been provisioned/initialized.
    // 200, 401, or 403 means the bucket exists and is governed by Storage rules.
    const available = resp.status !== 404;
    cachedBucketStatus = { bucket, available, checkedAt: now };
    return available;
  } catch {
    return false;
  }
}

async function compressImageIfNeeded(
  file: File,
  folder: UploadFolder
): Promise<{ blob: Blob; mimeType: string; name: string }> {
  if (!file.type.startsWith('image/') || file.type === 'image/gif') {
    return { blob: file, mimeType: file.type, name: file.name };
  }

  const maxDim = folder === 'avatars' ? 512 : folder === 'covers' ? 1440 : 1280;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    const targetW = Math.max(1, Math.round(bitmap.width * scale));
    const targetH = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      bitmap.close();
      return { blob: file, mimeType: file.type, name: file.name };
    }
    ctx.drawImage(bitmap, 0, 0, targetW, targetH);
    bitmap.close();

    const targetMime = 'image/webp';
    const compressed = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), targetMime, 0.82)
    );
    if (compressed && compressed.size > 0 && compressed.size < file.size) {
      return {
        blob: compressed,
        mimeType: targetMime,
        name: file.name.replace(/\.[^.]+$/, '') + '.webp',
      };
    }
  } catch {
    // Fallback cleanly to original image if canvas/createImageBitmap is unsupported
  }
  return { blob: file, mimeType: file.type, name: file.name };
}

function uploadWithStorageProgress(
  storagePath: string,
  blob: Blob,
  mimeType: string,
  onProgress?: (pct: number, stage: string) => void
): Promise<string> {
  return new Promise((resolve, reject) => {
    const storageRef = ref(storage, storagePath);
    const task = uploadBytesResumable(storageRef, blob, {
      contentType: mimeType || 'application/octet-stream',
      cacheControl: 'public,max-age=604800',
    });

    const timer = setTimeout(() => {
      try {
        task.cancel();
      } catch {
        // ignore
      }
      reject(new Error('STORAGE_TIMEOUT'));
    }, 8000);

    task.on(
      'state_changed',
      (snap) => {
        if (snap.totalBytes > 0) {
          const pct = Math.min(92, Math.max(8, Math.round((snap.bytesTransferred / snap.totalBytes) * 90)));
          onProgress?.(pct, `Uploading to cloud storage (${pct}%)...`);
        }
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
      async () => {
        clearTimeout(timer);
        try {
          const url = await getDownloadURL(task.snapshot.ref);
          resolve(url);
        } catch (err) {
          reject(err);
        }
      }
    );
  });
}

function uploadToServerFallbackWithProgress(
  blob: Blob,
  mimeType: string,
  folder: UploadFolder,
  idToken: string,
  onProgress?: (pct: number, stage: string) => void
): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/upload-binary', true);
    xhr.timeout = mimeType.startsWith('video/') ? 90_000 : 30_000;
    xhr.setRequestHeader('Authorization', `Bearer ${idToken}`);
    xhr.setRequestHeader('Content-Type', mimeType);
    xhr.setRequestHeader('X-Upload-Folder', folder);

    xhr.upload.onprogress = (evt) => {
      if (evt.lengthComputable && evt.total > 0) {
        const pct = Math.min(94, Math.max(8, Math.round((evt.loaded / evt.total) * 90)));
        onProgress?.(pct, `Uploading media (${pct}%)...`);
      }
    };

    xhr.onload = () => {
      let parsed: { url?: string; error?: string; verified?: boolean } = {};
      try {
        parsed = JSON.parse(xhr.responseText || '{}') as { url?: string; error?: string; verified?: boolean };
      } catch {
        // ignore JSON parse failure
      }
      if (xhr.status >= 200 && xhr.status < 300 && parsed.url && parsed.verified) {
        resolve(parsed.url);
      } else {
        reject(new Error(parsed.error || `Server upload failed (HTTP ${xhr.status}).`));
      }
    };

    xhr.onerror = () => reject(new Error('Network error while uploading media. Please check your connection.'));
    xhr.ontimeout = () => reject(new Error('Upload timed out on slow network. Try a smaller file or retry.'));
    xhr.send(blob);
  });
}

async function verifyMediaAccessible(url: string): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const resp = await fetch(url, { method: 'HEAD', signal: controller.signal, cache: 'no-store' });
    const ct = (resp.headers.get('content-type') || '').toLowerCase();
    if (resp.ok && !ct.includes('text/html')) {
      return;
    }
    if (resp.status === 405) {
      const rangeResp = await fetch(url, {
        method: 'GET',
        headers: { Range: 'bytes=0-0' },
        signal: controller.signal,
        cache: 'no-store',
      });
      const rct = (rangeResp.headers.get('content-type') || '').toLowerCase();
      if ((rangeResp.status === 200 || rangeResp.status === 206) && !rct.includes('text/html')) {
        return;
      }
    }
    throw new Error(`Uploaded file is not accessible yet (HTTP ${resp.status}).`);
  } finally {
    clearTimeout(timer);
  }
}

export async function uploadMediaFile(
  file: File,
  folder: UploadFolder,
  uid: string,
  options?: UploadMediaOptions
): Promise<string> {
  const onProgress = options?.onProgress;
  const rawType = (file.type || '').toLowerCase();
  const isImage = ALLOWED_IMAGE_TYPES.has(rawType);
  const isVideo = ALLOWED_VIDEO_TYPES.has(rawType);

  if (!isImage && !isVideo) {
    throw new Error('Unsupported file format. Please choose JPG, PNG, WebP, GIF, MP4, WebM, or MOV.');
  }

  if (isVideo && file.size > MAX_VIDEO_BYTES) {
    throw new Error('Video exceeds the 25MB upload limit. Please trim or compress it under 25MB.');
  }

  const user = auth.currentUser;
  if (!user || user.uid !== uid) {
    throw new Error('Please sign in again before uploading media.');
  }

  onProgress?.(4, 'Preparing media...');
  const prepared = await compressImageIfNeeded(file, folder);

  if (prepared.mimeType.startsWith('image/') && prepared.blob.size > MAX_IMAGE_BYTES) {
    throw new Error('Image exceeds the 10MB upload limit even after compression.');
  }

  const idToken = await user.getIdToken();
  const safeName = `${Date.now()}_${prepared.name.replace(/[^a-zA-Z0-9._-]/g, '').slice(-40) || 'media'}`;
  const storagePath = `${folder}/${uid}/${safeName}`;

  let uploadedUrl = '';

  const storageAvailable = await isFirebaseStorageBucketAvailable();
  if (storageAvailable) {
    try {
      uploadedUrl = await uploadWithStorageProgress(storagePath, prepared.blob, prepared.mimeType, onProgress);
    } catch (err) {
      const code = (err as { code?: string })?.code || '';
      if (code === 'storage/unauthorized' || code === 'storage/unauthenticated') {
        throw new Error('Upload denied. Please make sure your email address is verified.');
      }
      cachedBucketStatus = {
        bucket: String(storage.app.options.storageBucket || ''),
        available: false,
        checkedAt: Date.now(),
      };
    }
  }

  if (!uploadedUrl) {
    onProgress?.(8, 'Uploading via secure BANDHU MELA media server...');
    uploadedUrl = await uploadToServerFallbackWithProgress(
      prepared.blob,
      prepared.mimeType,
      folder,
      idToken,
      onProgress
    );
  }

  onProgress?.(96, 'Verifying stored file...');
  await verifyMediaAccessible(uploadedUrl);
  onProgress?.(100, 'Upload verified');

  return uploadedUrl;
}
