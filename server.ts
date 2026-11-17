import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;
const UPLOADS_DIR = path.resolve(__dirname, 'uploads');

if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

const ALLOWED_MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
};

const ALLOWED_UPLOAD_FOLDERS = new Set([
  'avatars',
  'covers',
  'posts',
  'stories',
  'reels',
  'chats',
]);

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_VIDEO_BYTES = 25 * 1024 * 1024;

const BOOTSTRAP_OWNER_EMAIL = 'arnabmondal0206@gmail.com';
const BOOTSTRAP_OWNER_UID = '7eDEh2lWmhORezODM5kisxXX3mz2';
const OWNER_LOCK_FILE = path.resolve(__dirname, '.bandhu-owner-lock.json');

interface FirebaseProjectMeta {
  apiKey: string;
  projectId: string;
  firestoreDatabaseId: string;
}

function loadFirebaseProjectMeta(): FirebaseProjectMeta {
  let fileCfg: Partial<FirebaseProjectMeta> = {};
  try {
    const configPath = path.resolve(__dirname, 'firebase-applet-config.json');
    if (fs.existsSync(configPath)) {
      fileCfg = JSON.parse(fs.readFileSync(configPath, 'utf8')) as Partial<FirebaseProjectMeta>;
    }
  } catch {
    // ignore
  }
  return {
    apiKey: process.env.FIREBASE_API_KEY || fileCfg.apiKey || '',
    projectId: process.env.FIREBASE_PROJECT_ID || fileCfg.projectId || '',
    firestoreDatabaseId: process.env.FIRESTORE_DATABASE_ID || fileCfg.firestoreDatabaseId || '(default)',
  };
}

const FIREBASE_META = loadFirebaseProjectMeta();
const FIREBASE_API_KEY = FIREBASE_META.apiKey;

interface VerifiedFirebaseUser {
  uid: string;
  email: string;
  emailVerified: boolean;
  idToken: string;
}

interface OwnerLockRecord {
  ownerUid: string;
  role: 'super_admin_owner';
  locked: true;
  verifiedAt: string;
}

function readOwnerLockFile(): OwnerLockRecord | null {
  try {
    if (!fs.existsSync(OWNER_LOCK_FILE)) return null;
    const parsed = JSON.parse(fs.readFileSync(OWNER_LOCK_FILE, 'utf8')) as Partial<OwnerLockRecord>;
    if (parsed.ownerUid && parsed.role === 'super_admin_owner' && parsed.locked === true) {
      return parsed as OwnerLockRecord;
    }
  } catch {
    // ignore malformed lock
  }
  return null;
}

function writeOwnerLockFile(uid: string): OwnerLockRecord {
  const existing = readOwnerLockFile();
  if (existing) {
    if (existing.ownerUid !== uid) {
      throw Object.assign(new Error('Original owner identity is already permanently locked.'), { status: 403 });
    }
    return existing;
  }
  const record: OwnerLockRecord = {
    ownerUid: uid,
    role: 'super_admin_owner',
    locked: true,
    verifiedAt: new Date().toISOString(),
  };
  fs.writeFileSync(OWNER_LOCK_FILE, JSON.stringify(record, null, 2), { mode: 0o600 });
  return record;
}

async function fetchOwnerRegistryFromFirestore(
  idToken: string
): Promise<{ exists: boolean; uid?: string; email?: string; role?: string; locked?: boolean }> {
  if (!FIREBASE_META.projectId) {
    return { exists: false };
  }
  const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
    FIREBASE_META.projectId
  )}/databases/${encodeURIComponent(FIREBASE_META.firestoreDatabaseId)}/documents/ownerRegistry/original`;

  const resp = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${idToken}` },
  });
  if (resp.status === 404) {
    return { exists: false };
  }
  if (!resp.ok) {
    throw Object.assign(new Error('Unable to query owner registry from Firestore backend.'), { status: 502 });
  }
  const docJson = (await resp.json()) as {
    fields?: {
      uid?: { stringValue?: string };
      email?: { stringValue?: string };
      role?: { stringValue?: string };
      locked?: { booleanValue?: boolean };
    };
  };
  return {
    exists: true,
    uid: docJson.fields?.uid?.stringValue || '',
    email: docJson.fields?.email?.stringValue || '',
    role: docJson.fields?.role?.stringValue || '',
    locked: Boolean(docJson.fields?.locked?.booleanValue),
  };
}

async function verifyFirebaseIdToken(authHeader?: string): Promise<VerifiedFirebaseUser> {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw Object.assign(new Error('Sign in required for authenticated request.'), { status: 401 });
  }
  const idToken = authHeader.slice(7).trim();
  if (!idToken) {
    throw Object.assign(new Error('Invalid authorization token.'), { status: 401 });
  }
  if (!FIREBASE_API_KEY) {
    throw Object.assign(new Error('Server authentication configuration missing.'), { status: 500 });
  }

  const resp = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(FIREBASE_API_KEY)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken }),
    }
  );
  if (!resp.ok) {
    throw Object.assign(new Error('Your login session expired. Please sign in again.'), { status: 401 });
  }
  const payload = (await resp.json()) as {
    users?: Array<{ localId?: string; email?: string; emailVerified?: boolean; disabled?: boolean }>;
  };
  const user = payload.users?.[0];
  if (!user?.localId) {
    throw Object.assign(new Error('Unable to verify user identity.'), { status: 401 });
  }
  if (user.disabled) {
    throw Object.assign(new Error('This account has been disabled.'), { status: 403 });
  }
  if (!user.emailVerified) {
    throw Object.assign(new Error('Please verify your email address before continuing.'), { status: 403 });
  }
  return {
    uid: user.localId,
    email: (user.email || '').toLowerCase(),
    emailVerified: Boolean(user.emailVerified),
    idToken,
  };
}

async function verifyOriginalOwnerRequest(authHeader?: string): Promise<{
  verified: true;
  isOriginalOwner: true;
  ownerUid: string;
  role: 'super_admin_owner';
  locked: true;
  idToken: string;
}> {
  const user = await verifyFirebaseIdToken(authHeader);
  if (!user.emailVerified || user.email !== BOOTSTRAP_OWNER_EMAIL || user.uid !== BOOTSTRAP_OWNER_UID) {
    throw Object.assign(new Error('Restricted to original platform owner.'), { status: 403 });
  }

  const existingLock = readOwnerLockFile();
  if (existingLock && existingLock.ownerUid !== user.uid) {
    throw Object.assign(new Error('Original owner UID mismatch detected.'), { status: 403 });
  }

  const registry = await fetchOwnerRegistryFromFirestore(user.idToken);
  if (!registry.exists || !registry.uid) {
    throw Object.assign(
      new Error('Owner registry document not yet claimed in Firestore. Claim /ownerRegistry/original first.'),
      { status: 409 }
    );
  }
  if (
    registry.uid !== user.uid ||
    registry.uid !== BOOTSTRAP_OWNER_UID ||
    registry.role !== 'super_admin_owner' ||
    registry.locked !== true ||
    registry.email?.toLowerCase() !== BOOTSTRAP_OWNER_EMAIL
  ) {
    throw Object.assign(new Error('Original owner registry verification failed.'), { status: 403 });
  }

  writeOwnerLockFile(user.uid);
  return {
    verified: true,
    isOriginalOwner: true,
    ownerUid: user.uid,
    role: 'super_admin_owner',
    locked: true,
    idToken: user.idToken,
  };
}

const VALID_DOC_ID_RE = /^[a-zA-Z0-9_-]{1,128}$/;

function getFirestoreDbPath(): string {
  if (!FIREBASE_META.projectId) {
    throw Object.assign(new Error('Firebase project configuration is missing.'), { status: 500 });
  }
  return `projects/${FIREBASE_META.projectId}/databases/${FIREBASE_META.firestoreDatabaseId}`;
}

function getFirestoreRestBase(): string {
  return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
    FIREBASE_META.projectId
  )}/databases/${encodeURIComponent(FIREBASE_META.firestoreDatabaseId)}`;
}

type FirestoreFieldValue =
  | { stringValue: string }
  | { booleanValue: boolean }
  | { integerValue: string }
  | { doubleValue: number }
  | { timestampValue: string }
  | { nullValue: null }
  | { arrayValue: { values?: FirestoreFieldValue[] } }
  | { mapValue: { fields?: Record<string, FirestoreFieldValue> } };

function decodeFirestoreValue(val?: FirestoreFieldValue): unknown {
  if (!val) return undefined;
  if ('stringValue' in val) return val.stringValue;
  if ('booleanValue' in val) return val.booleanValue;
  if ('integerValue' in val) return Number(val.integerValue);
  if ('doubleValue' in val) return val.doubleValue;
  if ('timestampValue' in val) return Date.parse(val.timestampValue) || val.timestampValue;
  if ('nullValue' in val) return null;
  if ('arrayValue' in val) return (val.arrayValue.values || []).map((v) => decodeFirestoreValue(v));
  if ('mapValue' in val) return decodeFirestoreFields(val.mapValue.fields);
  return undefined;
}

function decodeFirestoreFields(fields?: Record<string, FirestoreFieldValue>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!fields) return out;
  for (const [k, v] of Object.entries(fields)) {
    out[k] = decodeFirestoreValue(v);
  }
  return out;
}

function encodeStringField(value: string): FirestoreFieldValue {
  return { stringValue: value };
}

function encodeBoolField(value: boolean): FirestoreFieldValue {
  return { booleanValue: value };
}

function encodeIntField(value: number): FirestoreFieldValue {
  return { integerValue: String(Math.trunc(Number(value) || 0)) };
}

function encodeDoubleField(value: number): FirestoreFieldValue {
  return { doubleValue: Number(value) || 0 };
}

async function firestoreGetDoc(
  docPath: string,
  idToken: string
): Promise<{ exists: boolean; id: string; updateTime?: string; data: Record<string, unknown> }> {
  const encodedPath = docPath
    .split('/')
    .map((s) => encodeURIComponent(s))
    .join('/');
  const resp = await fetch(`${getFirestoreRestBase()}/documents/${encodedPath}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${idToken}` },
  });
  if (resp.status === 404) {
    return { exists: false, id: docPath.split('/').pop() || '', data: {} };
  }
  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw Object.assign(
      new Error(`Firestore read rejected (${resp.status})${errText ? `: ${errText.slice(0, 140)}` : ''}`),
      { status: resp.status === 403 ? 403 : 502 }
    );
  }
  const docJson = (await resp.json()) as {
    name?: string;
    updateTime?: string;
    fields?: Record<string, FirestoreFieldValue>;
  };
  return {
    exists: true,
    id: (docJson.name || docPath).split('/').pop() || '',
    updateTime: docJson.updateTime,
    data: decodeFirestoreFields(docJson.fields),
  };
}

async function firestoreListCollection(
  collectionName: string,
  idToken: string,
  maxDocs = 500
): Promise<Array<{ id: string; data: Record<string, unknown> }>> {
  const results: Array<{ id: string; data: Record<string, unknown> }> = [];
  let pageToken = '';

  while (results.length < maxDocs) {
    const qs = new URLSearchParams({ pageSize: '100' });
    if (pageToken) qs.set('pageToken', pageToken);
    const resp = await fetch(
      `${getFirestoreRestBase()}/documents/${encodeURIComponent(collectionName)}?${qs.toString()}`,
      {
        method: 'GET',
        headers: { Authorization: `Bearer ${idToken}` },
      }
    );
    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      throw Object.assign(
        new Error(`Firestore list failed (${resp.status})${errText ? `: ${errText.slice(0, 140)}` : ''}`),
        { status: resp.status === 403 ? 403 : 502 }
      );
    }
    const payload = (await resp.json()) as {
      documents?: Array<{ name?: string; fields?: Record<string, FirestoreFieldValue> }>;
      nextPageToken?: string;
    };
    for (const d of payload.documents || []) {
      const id = (d.name || '').split('/').pop() || '';
      results.push({ id, data: decodeFirestoreFields(d.fields) });
    }
    if (!payload.nextPageToken) break;
    pageToken = payload.nextPageToken;
  }

  return results;
}

async function firestoreBatchGetDocs(
  docPaths: string[],
  idToken: string
): Promise<Map<string, Record<string, unknown>>> {
  const map = new Map<string, Record<string, unknown>>();
  if (docPaths.length === 0) return map;

  const dbPath = getFirestoreDbPath();
  let lastPermissionOrServerError: Error | null = null;
  let anySuccess = false;

  for (let i = 0; i < docPaths.length; i += 15) {
    const chunk = docPaths.slice(i, i + 15);
    const resp = await fetch(`${getFirestoreRestBase()}/documents:batchGet`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${idToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        documents: chunk.map((p) => `${dbPath}/documents/${p}`),
      }),
    });

    if (resp.status === 401) {
      throw Object.assign(new Error('Your login session expired. Please sign in again.'), { status: 401 });
    }

    if (resp.ok) {
      anySuccess = true;
      const rows = (await resp.json()) as Array<{
        found?: { name?: string; fields?: Record<string, FirestoreFieldValue> };
      }>;
      for (const row of rows) {
        if (row.found?.name) {
          const marker = '/documents/';
          const idx = row.found.name.indexOf(marker);
          const relPath = idx >= 0 ? row.found.name.slice(idx + marker.length) : row.found.name;
          map.set(relPath, decodeFirestoreFields(row.found.fields));
        }
      }
      continue;
    }

    const batchErrText = await resp.text().catch(() => '');
    console.warn(`Firestore batchGet returned ${resp.status}, falling back to single gets:`, batchErrText.slice(0, 180));

    // Fallback per-document so one restricted/legacy subdoc doesn't fail an entire batch
    const settled = await Promise.allSettled(
      chunk.map(async (p) => {
        const docRes = await firestoreGetDoc(p, idToken);
        return { p, docRes };
      })
    );
    for (const item of settled) {
      if (item.status === 'fulfilled') {
        anySuccess = true;
        if (item.value.docRes.exists) {
          map.set(item.value.p, item.value.docRes.data);
        }
      } else if (item.reason instanceof Error) {
        const status = (item.reason as { status?: number })?.status;
        if (status === 401) {
          throw item.reason;
        }
        lastPermissionOrServerError = item.reason;
      }
    }
  }

  if (!anySuccess && lastPermissionOrServerError && docPaths.length > 0) {
    throw lastPermissionOrServerError;
  }

  return map;
}

async function firestoreCommitWrites(writes: unknown[], idToken: string): Promise<void> {
  const resp = await fetch(`${getFirestoreRestBase()}/documents:commit`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${idToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ writes }),
  });
  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw Object.assign(
      new Error(
        resp.status === 403
          ? 'Permission denied by Firestore security rules.'
          : `Database commit failed (${resp.status})${errText ? `: ${errText.slice(0, 140)}` : ''}`
      ),
      { status: resp.status === 403 ? 403 : 502 }
    );
  }
}

function buildAuditWrite(params: {
  actorUid: string;
  actorName: string;
  action: string;
  targetId: string;
  details: string;
}): Record<string, unknown> {
  const logId = `audit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return {
    update: {
      name: `${getFirestoreDbPath()}/documents/auditLogs/${logId}`,
      fields: {
        id: encodeStringField(logId),
        actorId: encodeStringField(params.actorUid),
        actorName: encodeStringField((params.actorName || 'Original Owner').slice(0, 60)),
        actorRole: encodeStringField('owner'),
        action: encodeStringField(params.action.slice(0, 80)),
        targetType: encodeStringField('admin'),
        targetId: encodeStringField(params.targetId.slice(0, 128)),
        details: encodeStringField(params.details.slice(0, 400)),
      },
    },
    currentDocument: { exists: false },
    updateTransforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }],
  };
}

interface ResolvedUserTarget {
  uid: string;
  displayName: string;
  username: string;
  email: string;
  photoURL: string;
  isVerified: boolean;
  isSuspended: boolean;
  isProtectedOwner?: boolean;
}

async function resolveRealUserByEmailOrUid(
  rawIdentifier: string,
  ownerUid: string,
  idToken: string,
  options?: { allowOwnerReadonly?: boolean }
): Promise<ResolvedUserTarget> {
  const identifier = rawIdentifier.trim();
  if (!identifier) {
    throw Object.assign(new Error('Please enter a registered user email address or Firebase UID.'), { status: 400 });
  }

  const isOwnerMatch = identifier.toLowerCase() === BOOTSTRAP_OWNER_EMAIL || identifier === ownerUid;
  if (isOwnerMatch) {
    if (!options?.allowOwnerReadonly) {
      throw Object.assign(
        new Error('The Original Owner account is permanently protected and cannot be modified, suspended, demoted, or removed.'),
        { status: 403 }
      );
    }
    const ownerDoc = await firestoreGetDoc(`users/${ownerUid}`, idToken);
    if (!ownerDoc.exists) {
      throw Object.assign(new Error('Original Owner user profile document was not found in Firestore.'), { status: 404 });
    }
    return {
      uid: ownerUid,
      displayName: String(ownerDoc.data.displayName || ownerDoc.data.username || 'Original Owner'),
      username: String(ownerDoc.data.username || ''),
      email: BOOTSTRAP_OWNER_EMAIL,
      photoURL: String(ownerDoc.data.photoURL || ''),
      isVerified: Boolean(ownerDoc.data.isVerified),
      isSuspended: false,
      isProtectedOwner: true,
    };
  }

  if (identifier.includes('@')) {
    if (identifier.startsWith('@') || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier)) {
      throw Object.assign(
        new Error('Please enter a valid email address (e.g. user@example.com) or a Firebase UID.'),
        { status: 400 }
      );
    }

    const emailTarget = identifier.toLowerCase();
    const allUsers = await firestoreListCollection('users', idToken, 2000);
    const nonOwnerUsers = allUsers.filter(
      (u) => u.id && u.id !== ownerUid && VALID_DOC_ID_RE.test(u.id)
    );
    const privMap = await firestoreBatchGetDocs(
      nonOwnerUsers.map((u) => `users/${u.id}/private/info`),
      idToken
    );

    const match = nonOwnerUsers.find((u) => {
      const priv = privMap.get(`users/${u.id}/private/info`);
      const email = typeof priv?.email === 'string' ? priv.email.trim().toLowerCase() : '';
      return email === emailTarget;
    });

    if (!match) {
      throw Object.assign(
        new Error(`No registered BANDHU MELA user found with email "${identifier}". Users must register and verify their email first.`),
        { status: 404 }
      );
    }

    const priv = privMap.get(`users/${match.id}/private/info`);
    return {
      uid: match.id,
      displayName: String(match.data.displayName || match.data.username || 'Bandhu Member'),
      username: String(match.data.username || ''),
      email: String(priv?.email || emailTarget),
      photoURL: String(match.data.photoURL || ''),
      isVerified: Boolean(match.data.isVerified),
      isSuspended: Boolean(match.data.isSuspended),
      isProtectedOwner: false,
    };
  }

  if (!VALID_DOC_ID_RE.test(identifier)) {
    throw Object.assign(
      new Error('Invalid Firebase UID format. Enter a valid email address or Firebase UID.'),
      { status: 400 }
    );
  }

  const userDoc = await firestoreGetDoc(`users/${identifier}`, idToken);
  if (!userDoc.exists) {
    throw Object.assign(
      new Error(`No registered BANDHU MELA user found with Firebase UID "${identifier}".`),
      { status: 404 }
    );
  }

  let email = '';
  try {
    const privDoc = await firestoreGetDoc(`users/${identifier}/private/info`, idToken);
    if (privDoc.exists && typeof privDoc.data.email === 'string') {
      email = privDoc.data.email;
    }
  } catch {
    email = '';
  }

  if (email.toLowerCase() === BOOTSTRAP_OWNER_EMAIL) {
    if (!options?.allowOwnerReadonly) {
      throw Object.assign(
        new Error('The Original Owner account is permanently protected and cannot be modified, suspended, demoted, or removed.'),
        { status: 403 }
      );
    }
    return {
      uid: identifier,
      displayName: String(userDoc.data.displayName || userDoc.data.username || 'Original Owner'),
      username: String(userDoc.data.username || ''),
      email,
      photoURL: String(userDoc.data.photoURL || ''),
      isVerified: Boolean(userDoc.data.isVerified),
      isSuspended: false,
      isProtectedOwner: true,
    };
  }

  return {
    uid: identifier,
    displayName: String(userDoc.data.displayName || userDoc.data.username || 'Bandhu Member'),
    username: String(userDoc.data.username || ''),
    email,
    photoURL: String(userDoc.data.photoURL || ''),
    isVerified: Boolean(userDoc.data.isVerified),
    isSuspended: Boolean(userDoc.data.isSuspended),
    isProtectedOwner: false,
  };
}

function normalizeFolder(rawFolder?: string): string | null {
  const cleaned = (rawFolder || 'posts').trim().toLowerCase().split('/')[0];
  if (cleaned === 'profiles') return 'avatars';
  return ALLOWED_UPLOAD_FOLDERS.has(cleaned) ? cleaned : null;
}

function saveVerifiedBuffer(params: {
  buffer: Buffer;
  mimeType: string;
  folder: string;
  uid: string;
}): { url: string; size: number; mimeType: string; verified: true } {
  const cleanMime = params.mimeType.split(';')[0].trim().toLowerCase();
  const ext = ALLOWED_MIME_TO_EXT[cleanMime];
  if (!ext) {
    throw Object.assign(new Error(`Unsupported media file type (${cleanMime || 'unknown'}).`), { status: 400 });
  }
  if (!params.buffer || params.buffer.length < 16) {
    throw Object.assign(new Error('Uploaded media file appears empty or corrupted.'), { status: 400 });
  }

  const isVideo = cleanMime.startsWith('video/');
  const limitBytes = isVideo ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
  if (params.buffer.length > limitBytes) {
    const limitMb = Math.round(limitBytes / (1024 * 1024));
    throw Object.assign(new Error(`File exceeds ${limitMb}MB upload limit.`), { status: 413 });
  }

  const safeUid = params.uid.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 128);
  const targetFolder = path.join(UPLOADS_DIR, params.folder, safeUid);
  if (!fs.existsSync(targetFolder)) {
    fs.mkdirSync(targetFolder, { recursive: true });
  }

  const fileName = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}.${ext}`;
  const filePath = path.join(targetFolder, fileName);
  fs.writeFileSync(filePath, params.buffer);

  const stat = fs.statSync(filePath);
  if (!stat.isFile() || stat.size !== params.buffer.length) {
    throw Object.assign(new Error('File could not be verified on storage disk.'), { status: 500 });
  }

  return {
    url: `/uploads/${params.folder}/${safeUid}/${fileName}`,
    size: stat.size,
    mimeType: cleanMime,
    verified: true,
  };
}

async function startServer() {
  const app = express();

  app.use((req, res, next) => {
    if (req.path.startsWith('/api/') || req.path.startsWith('/uploads/')) {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, POST, PATCH, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Upload-Folder');
      if (req.method === 'OPTIONS') {
        res.status(204).end();
        return;
      }
    }
    next();
  });

  app.use(express.json({ limit: '38mb' }));

  app.use('/uploads', express.static(UPLOADS_DIR, { maxAge: '30d', immutable: true, fallthrough: true }));
  app.use('/uploads', (_req, res) => {
    res.status(404).json({ error: 'Uploaded media file not found' });
  });

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', service: 'bandhu-mela' });
  });

  app.get('/api/owner/status', (_req, res) => {
    const lock = readOwnerLockFile();
    res.json({
      claimed: Boolean(lock),
      locked: Boolean(lock?.locked),
      role: 'super_admin_owner',
    });
  });

  app.post('/api/owner/verify', async (req, res) => {
    try {
      const { idToken: _omit, ...safeVerified } = await verifyOriginalOwnerRequest(req.headers.authorization);
      res.json(safeVerified);
    } catch (error) {
      const status = (error as { status?: number })?.status || 500;
      const message = error instanceof Error ? error.message : 'Owner verification failed';
      res.status(status).json({ verified: false, isOriginalOwner: false, error: message });
    }
  });

  app.get('/api/owner/session', async (req, res) => {
    try {
      const { idToken: _omit, ...safeVerified } = await verifyOriginalOwnerRequest(req.headers.authorization);
      res.json(safeVerified);
    } catch (error) {
      const status = (error as { status?: number })?.status || 500;
      const message = error instanceof Error ? error.message : 'Owner verification failed';
      res.status(status).json({ verified: false, isOriginalOwner: false, error: message });
    }
  });

  // Backend-enforced Super Admin Owner endpoints for Admin & Moderator management
  app.get('/api/owner/admins', async (req, res) => {
    try {
      const owner = await verifyOriginalOwnerRequest(req.headers.authorization);
      const [adminDocs, userDocs] = await Promise.all([
        firestoreListCollection('admins', owner.idToken, 100),
        firestoreListCollection('users', owner.idToken, 250),
      ]);

      const userMap = new Map(userDocs.map((u) => [u.id, u.data]));
      const lookupUids = Array.from(
        new Set(
          adminDocs
            .map((a) => a.id)
            .filter((uid) => uid && uid !== owner.ownerUid)
        )
      );
      const privMap = await firestoreBatchGetDocs(
        lookupUids.map((uid) => `users/${uid}/private/info`),
        owner.idToken
      );

      const admins = adminDocs
        .filter((a) => a.id && a.id !== owner.ownerUid)
        .map((a) => {
          const u = userMap.get(a.id);
          const priv = privMap.get(`users/${a.id}/private/info`);
          return {
            uid: a.id,
            grantedBy: String(a.data.grantedBy || owner.ownerUid),
            role: a.data.role === 'admin' ? 'admin' : 'moderator',
            isSuspended: Boolean(a.data.isSuspended),
            displayName: String(u?.displayName || a.data.displayName || 'Bandhu Member'),
            email: String(priv?.email || a.data.email || ''),
            notes: String(a.data.notes || ''),
            createdAt: a.data.createdAt,
            updatedAt: a.data.updatedAt,
          };
        })
        .filter((a) => a.email.toLowerCase() !== BOOTSTRAP_OWNER_EMAIL);

      res.json({
        owner: {
          uid: owner.ownerUid,
          email: BOOTSTRAP_OWNER_EMAIL,
          role: 'super_admin_owner',
          locked: true,
          protected: true,
        },
        admins,
      });
    } catch (error) {
      const status = (error as { status?: number })?.status || 500;
      const message = error instanceof Error ? error.message : 'Unable to fetch Admin & Moderator team.';
      res.status(status).json({ error: message });
    }
  });

  app.post('/api/owner/admins/lookup', async (req, res) => {
    try {
      const owner = await verifyOriginalOwnerRequest(req.headers.authorization);
      const { identifier } = (req.body || {}) as { identifier?: string };
      const targetUser = await resolveRealUserByEmailOrUid(
        identifier || '',
        owner.ownerUid,
        owner.idToken,
        { allowOwnerReadonly: true }
      );
      const isProtectedOwner = Boolean(targetUser.isProtectedOwner || targetUser.uid === owner.ownerUid);
      const adminDoc = isProtectedOwner
        ? { exists: false, id: targetUser.uid, data: {} as Record<string, unknown> }
        : await firestoreGetDoc(`admins/${targetUser.uid}`, owner.idToken);

      const existingAdmin = adminDoc.exists
        ? {
            uid: targetUser.uid,
            grantedBy: String(adminDoc.data.grantedBy || ''),
            role: (adminDoc.data.role === 'admin' ? 'admin' : 'moderator') as 'admin' | 'moderator',
            isSuspended: Boolean(adminDoc.data.isSuspended),
            displayName: String(adminDoc.data.displayName || targetUser.displayName),
            email: String(adminDoc.data.email || targetUser.email),
            notes: String(adminDoc.data.notes || ''),
            createdAt: adminDoc.data.createdAt,
            updatedAt: adminDoc.data.updatedAt,
          }
        : null;

      const currentRole: 'super_admin_owner' | 'admin' | 'moderator' | 'user' = isProtectedOwner
        ? 'super_admin_owner'
        : existingAdmin
        ? existingAdmin.role
        : 'user';

      res.json({
        user: targetUser,
        existingAdmin,
        currentRole,
        isProtectedOwner,
      });
    } catch (error) {
      const status = (error as { status?: number })?.status || 500;
      const message = error instanceof Error ? error.message : 'User lookup failed.';
      res.status(status).json({ error: message });
    }
  });

  app.post('/api/owner/admins', async (req, res) => {
    try {
      const owner = await verifyOriginalOwnerRequest(req.headers.authorization);
      const { identifier, role, notes } = req.body as {
        identifier?: string;
        role?: string;
        notes?: string;
      };

      if (role !== 'admin' && role !== 'moderator') {
        res.status(400).json({ error: 'Role must be either "admin" or "moderator".' });
        return;
      }

      const targetUser = await resolveRealUserByEmailOrUid(identifier || '', owner.ownerUid, owner.idToken);
      const existingAdmin = await firestoreGetDoc(`admins/${targetUser.uid}`, owner.idToken);
      if (existingAdmin.exists) {
        res.status(409).json({
          error: `${targetUser.displayName} already holds an ${
            existingAdmin.data.role === 'admin' ? 'Admin' : 'Moderator'
          } account. Use Suspend, Reactivate, Role Switch, or Remove below.`,
        });
        return;
      }

      const ownerDoc = await firestoreGetDoc(`users/${owner.ownerUid}`, owner.idToken);
      const actorName = String(ownerDoc.data.displayName || 'Original Owner');
      const cleanNotes = (notes || '').trim().slice(0, 300);

      await firestoreCommitWrites(
        [
          {
            update: {
              name: `${getFirestoreDbPath()}/documents/admins/${targetUser.uid}`,
              fields: {
                uid: encodeStringField(targetUser.uid),
                grantedBy: encodeStringField(owner.ownerUid),
                role: encodeStringField(role),
                isSuspended: encodeBoolField(false),
                displayName: encodeStringField(targetUser.displayName.slice(0, 60)),
                email: encodeStringField(targetUser.email.slice(0, 120)),
                notes: encodeStringField(cleanNotes),
              },
            },
            currentDocument: { exists: false },
            updateTransforms: [
              { fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' },
              { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' },
            ],
          },
          buildAuditWrite({
            actorUid: owner.ownerUid,
            actorName,
            action: role === 'admin' ? 'create_admin' : 'create_moderator',
            targetId: targetUser.uid,
            details: `Created ${role} for ${targetUser.displayName}${targetUser.email ? ` (${targetUser.email})` : ''}`,
          }),
        ],
        owner.idToken
      );

      res.status(201).json({
        success: true,
        admin: {
          uid: targetUser.uid,
          grantedBy: owner.ownerUid,
          role,
          isSuspended: false,
          displayName: targetUser.displayName,
          email: targetUser.email,
          notes: cleanNotes,
        },
      });
    } catch (error) {
      const status = (error as { status?: number })?.status || 500;
      const message = error instanceof Error ? error.message : 'Unable to create Admin or Moderator account.';
      res.status(status).json({ error: message });
    }
  });

  app.patch('/api/owner/admins/:uid', async (req, res) => {
    try {
      const owner = await verifyOriginalOwnerRequest(req.headers.authorization);
      const targetUid = String(req.params.uid || '').trim();
      if (!VALID_DOC_ID_RE.test(targetUid)) {
        res.status(400).json({ error: 'Invalid target UID.' });
        return;
      }
      if (targetUid === owner.ownerUid) {
        res.status(403).json({
          error: 'Original Owner account is permanently protected and cannot be modified, suspended, or demoted.',
        });
        return;
      }

      const existing = await firestoreGetDoc(`admins/${targetUid}`, owner.idToken);
      if (!existing.exists) {
        res.status(404).json({ error: 'Admin or Moderator account not found.' });
        return;
      }
      if (String(existing.data.email || '').toLowerCase() === BOOTSTRAP_OWNER_EMAIL) {
        res.status(403).json({
          error: 'Original Owner account is permanently protected.',
        });
        return;
      }

      const { role, isSuspended, notes } = req.body as {
        role?: 'admin' | 'moderator';
        isSuspended?: boolean;
        notes?: string;
      };

      const fields: Record<string, FirestoreFieldValue> = {};
      const fieldPaths: string[] = [];
      const changes: string[] = [];

      if (role !== undefined) {
        if (role !== 'admin' && role !== 'moderator') {
          res.status(400).json({ error: 'Role must be either "admin" or "moderator".' });
          return;
        }
        fields.role = encodeStringField(role);
        fieldPaths.push('role');
        changes.push(`role=${role}`);
      }

      if (typeof isSuspended === 'boolean') {
        fields.isSuspended = encodeBoolField(isSuspended);
        fieldPaths.push('isSuspended');
        changes.push(`suspended=${isSuspended}`);
      }

      if (typeof notes === 'string') {
        fields.notes = encodeStringField(notes.trim().slice(0, 300));
        fieldPaths.push('notes');
      }

      if (fieldPaths.length === 0) {
        res.status(400).json({ error: 'No valid Admin/Moderator updates specified.' });
        return;
      }

      const ownerDoc = await firestoreGetDoc(`users/${owner.ownerUid}`, owner.idToken);
      const actorName = String(ownerDoc.data.displayName || 'Original Owner');
      const action =
        typeof isSuspended === 'boolean'
          ? isSuspended
            ? 'suspend_admin'
            : 'reactivate_admin'
          : 'edit_admin_role';

      await firestoreCommitWrites(
        [
          {
            update: {
              name: `${getFirestoreDbPath()}/documents/admins/${targetUid}`,
              fields,
            },
            updateMask: { fieldPaths },
            currentDocument: { exists: true },
            updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
          },
          buildAuditWrite({
            actorUid: owner.ownerUid,
            actorName,
            action,
            targetId: targetUid,
            details: `${String(existing.data.displayName || targetUid)}: ${changes.join(', ')}`,
          }),
        ],
        owner.idToken
      );

      res.json({
        success: true,
        uid: targetUid,
        role: role ?? (existing.data.role === 'admin' ? 'admin' : 'moderator'),
        isSuspended: typeof isSuspended === 'boolean' ? isSuspended : Boolean(existing.data.isSuspended),
      });
    } catch (error) {
      const status = (error as { status?: number })?.status || 500;
      const message = error instanceof Error ? error.message : 'Unable to update Admin or Moderator account.';
      res.status(status).json({ error: message });
    }
  });

  app.delete('/api/owner/admins/:uid', async (req, res) => {
    try {
      const owner = await verifyOriginalOwnerRequest(req.headers.authorization);
      const targetUid = String(req.params.uid || '').trim();
      if (!VALID_DOC_ID_RE.test(targetUid)) {
        res.status(400).json({ error: 'Invalid target UID.' });
        return;
      }
      if (targetUid === owner.ownerUid) {
        res.status(403).json({
          error: 'Original Owner account is permanently protected and cannot be removed.',
        });
        return;
      }

      const existing = await firestoreGetDoc(`admins/${targetUid}`, owner.idToken);
      if (!existing.exists) {
        res.status(404).json({ error: 'Admin or Moderator account not found.' });
        return;
      }
      if (String(existing.data.email || '').toLowerCase() === BOOTSTRAP_OWNER_EMAIL) {
        res.status(403).json({ error: 'Original Owner account cannot be removed.' });
        return;
      }

      const ownerDoc = await firestoreGetDoc(`users/${owner.ownerUid}`, owner.idToken);
      const actorName = String(ownerDoc.data.displayName || 'Original Owner');

      await firestoreCommitWrites(
        [
          {
            delete: `${getFirestoreDbPath()}/documents/admins/${targetUid}`,
            currentDocument: { exists: true },
          },
          buildAuditWrite({
            actorUid: owner.ownerUid,
            actorName,
            action: 'remove_admin',
            targetId: targetUid,
            details: `Removed ${String(existing.data.role || 'admin')} privileges from ${String(
              existing.data.displayName || targetUid
            )}`,
          }),
        ],
        owner.idToken
      );

      res.json({ success: true, uid: targetUid });
    } catch (error) {
      const status = (error as { status?: number })?.status || 500;
      const message = error instanceof Error ? error.message : 'Unable to remove Admin or Moderator account.';
      res.status(status).json({ error: message });
    }
  });

  app.post(
    '/api/upload-binary',
    express.raw({ type: ['image/*', 'video/*', 'application/octet-stream'], limit: '26mb' }),
    async (req, res) => {
      try {
        const user = await verifyFirebaseIdToken(req.headers.authorization);
        const folder = normalizeFolder(String(req.headers['x-upload-folder'] || 'posts'));
        if (!folder) {
          res.status(400).json({ error: 'Invalid upload destination folder.' });
          return;
        }
        const mimeType = String(req.headers['content-type'] || '');
        const buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
        const result = saveVerifiedBuffer({ buffer, mimeType, folder, uid: user.uid });
        res.json(result);
      } catch (error) {
        const status = (error as { status?: number })?.status || 500;
        const message = error instanceof Error ? error.message : 'Failed to process binary upload';
        res.status(status).json({ error: message });
      }
    }
  );

  app.post('/api/upload', async (req, res) => {
    try {
      const user = await verifyFirebaseIdToken(req.headers.authorization);
      const { mimeType, base64, folder: rawFolder } = req.body as {
        mimeType?: string;
        base64?: string;
        folder?: string;
      };

      if (!mimeType || !base64) {
        res.status(400).json({ error: 'Missing mimeType or base64 payload.' });
        return;
      }

      const folder = normalizeFolder(rawFolder);
      if (!folder) {
        res.status(400).json({ error: 'Invalid upload destination folder.' });
        return;
      }

      const cleanBase64 = base64.replace(/^data:[^;]+;base64,/, '');
      const buffer = Buffer.from(cleanBase64, 'base64');
      const result = saveVerifiedBuffer({ buffer, mimeType, folder, uid: user.uid });
      res.json(result);
    } catch (error) {
      const status = (error as { status?: number })?.status || 500;
      const message = error instanceof Error ? error.message : 'Failed to process media upload';
      console.error('Upload error:', message);
      res.status(status).json({ error: message });
    }
  });

  const LEGACY_COIN_PACKAGE_IDS = ['pkg_starter', 'pkg_festive', 'pkg_royal', 'pkg_legend'] as const;
  const APPROVED_COIN_PACKAGES = [
    { id: 'pkg_100', name: '100 Coins Pack', coins: 100, bonusCoins: 0, priceUsd: 0.12, priceInr: 10, active: true },
    { id: 'pkg_500', name: '500 Coins Pack', coins: 500, bonusCoins: 0, priceUsd: 0.59, priceInr: 49, active: true },
    { id: 'pkg_1000', name: '1,000 Coins Pack', coins: 1000, bonusCoins: 0, priceUsd: 1.19, priceInr: 99, active: true },
    { id: 'pkg_5000', name: '5,000 Coins Pack', coins: 5000, bonusCoins: 0, priceUsd: 4.79, priceInr: 399, active: true },
    { id: 'pkg_10000', name: '10,000 Coins Pack', coins: 10000, bonusCoins: 0, priceUsd: 9.59, priceInr: 799, active: true },
  ];

  async function resolveAuthoritativeCoinPackage(packageId: string, idToken: string) {
    if (!packageId || !VALID_DOC_ID_RE.test(packageId)) return null;
    if ((LEGACY_COIN_PACKAGE_IDS as readonly string[]).includes(packageId)) {
      return null;
    }
    const docSnap = await firestoreGetDoc(`coinPackages/${packageId}`, idToken).catch(() => null);
    if (docSnap && docSnap.exists) {
      const coins = Math.max(1, Math.trunc(Number(docSnap.data.coins || 0)));
      const bonusCoins = Math.max(0, Math.trunc(Number(docSnap.data.bonusCoins || 0)));
      const priceInr = Math.max(1, Math.trunc(Number(docSnap.data.priceInr || 0)));
      const priceUsd = Math.max(0, Number(docSnap.data.priceUsd || 0));
      return {
        id: String(docSnap.data.id || packageId),
        name: String(docSnap.data.name || `${coins} Coins Pack`),
        coins,
        bonusCoins,
        priceInr,
        priceUsd,
        active: docSnap.data.active !== false,
      };
    }
    return APPROVED_COIN_PACKAGES.find((p) => p.id === packageId) || null;
  }

  // Coin Purchase Gateway Config & Authoritative Packages
  app.get('/api/coins/config', (_req, res) => {
    res.json({
      stripeEnabled: Boolean(process.env.STRIPE_SECRET_KEY),
      razorpayEnabled: Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET),
      razorpayKeyId: process.env.RAZORPAY_KEY_ID || '',
      ownerApprovalEnabled: true,
      currency: 'INR',
    });
  });

  app.get('/api/coins/packages', async (req, res) => {
    const legacySet = new Set<string>(LEGACY_COIN_PACKAGE_IDS);
    try {
      const authHeader = req.headers.authorization;
      if (authHeader?.startsWith('Bearer ')) {
        const user = await verifyFirebaseIdToken(authHeader);
        const docs = await firestoreListCollection('coinPackages', user.idToken, 30);
        const filtered = docs
          .map((d) => ({
            id: String(d.data.id || d.id),
            name: String(d.data.name || ''),
            coins: Math.trunc(Number(d.data.coins || 0)),
            bonusCoins: Math.trunc(Number(d.data.bonusCoins || 0)),
            priceInr: Math.trunc(Number(d.data.priceInr || 0)),
            priceUsd: Number(d.data.priceUsd || 0),
            active: d.data.active !== false,
          }))
          .filter((p) => !legacySet.has(p.id) && p.coins > 0 && p.priceInr > 0)
          .sort((a, b) => a.coins - b.coins);
        if (filtered.length > 0) {
          res.json({ currency: 'INR', packages: filtered });
          return;
        }
      }
    } catch {
      // fall through to approved default catalog
    }
    res.json({ currency: 'INR', packages: APPROVED_COIN_PACKAGES });
  });

  app.post('/api/owner/coins/sync-approved-packages', async (req, res) => {
    try {
      const owner = await verifyOriginalOwnerRequest(req.headers.authorization);
      const dbPath = getFirestoreDbPath();
      const existing = await firestoreListCollection('coinPackages', owner.idToken, 50);
      const legacySet = new Set<string>(LEGACY_COIN_PACKAGE_IDS);
      const writes: unknown[] = [];

      for (const d of existing) {
        if (legacySet.has(d.id)) {
          writes.push({ delete: `${dbPath}/documents/coinPackages/${d.id}` });
        }
      }

      for (const pkg of APPROVED_COIN_PACKAGES) {
        const found = existing.find((d) => d.id === pkg.id);
        writes.push({
          update: {
            name: `${dbPath}/documents/coinPackages/${pkg.id}`,
            fields: {
              id: encodeStringField(pkg.id),
              name: encodeStringField(pkg.name),
              coins: encodeIntField(pkg.coins),
              bonusCoins: encodeIntField(0),
              priceInr: encodeIntField(pkg.priceInr),
              priceUsd: encodeDoubleField(pkg.priceUsd),
              active: encodeBoolField(true),
            },
          },
          updateTransforms: [
            ...(!found ? [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }] : []),
            { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' },
          ],
        });
      }

      const ownerDoc = await firestoreGetDoc(`users/${owner.ownerUid}`, owner.idToken);
      writes.push(
        buildAuditWrite({
          actorUid: owner.ownerUid,
          actorName: String(ownerDoc.data.displayName || 'Original Owner'),
          action: 'sync_approved_coin_packages',
          targetId: 'coinPackages',
          details: 'Synced 5 official INR Coin Store packages (100=₹10, 500=₹49, 1000=₹99, 5000=₹399, 10000=₹799) & removed legacy packages',
        })
      );

      await firestoreCommitWrites(writes, owner.idToken);
      res.json({ success: true, packages: APPROVED_COIN_PACKAGES });
    } catch (error) {
      const status = (error as { status?: number })?.status || 500;
      const message = error instanceof Error ? error.message : 'Unable to sync approved coin packages.';
      res.status(status).json({ error: message });
    }
  });

  app.post('/api/coins/create-checkout', async (req, res) => {
    try {
      const user = await verifyFirebaseIdToken(req.headers.authorization);
      const { packageId, coins, priceInr } = req.body as {
        packageId?: string;
        coins?: number;
        priceInr?: number;
      };
      if (!packageId) {
        res.status(400).json({ error: 'Selected Coin Store packageId is required.' });
        return;
      }

      const pkg = await resolveAuthoritativeCoinPackage(packageId, user.idToken);
      if (!pkg || !pkg.active) {
        res.status(400).json({ error: 'Selected coin package is invalid, discontinued, or inactive.' });
        return;
      }

      const authoritativeCoins = pkg.coins + pkg.bonusCoins;
      const authoritativeInr = pkg.priceInr;
      const amountPaise = authoritativeInr * 100;

      if (
        (typeof priceInr === 'number' && Math.round(priceInr) !== authoritativeInr) ||
        (typeof coins === 'number' && Math.round(coins) !== authoritativeCoins)
      ) {
        res.status(400).json({
          error: `Checkout amount mismatch: ${pkg.name} is strictly ₹${authoritativeInr} for ${authoritativeCoins} coins.`,
        });
        return;
      }

      if (process.env.STRIPE_SECRET_KEY) {
        const origin = process.env.APP_URL || 'http://localhost:3000';
        const params = new URLSearchParams({
          mode: 'payment',
          success_url: `${origin}/?coin_checkout=success&pkg=${encodeURIComponent(pkg.id)}`,
          cancel_url: `${origin}/?coin_checkout=cancelled`,
          'line_items[0][price_data][currency]': 'inr',
          'line_items[0][price_data][product_data][name]': `BANDHU MELA · ${pkg.name} (${authoritativeCoins} Coins)`,
          'line_items[0][price_data][unit_amount]': String(amountPaise),
          'line_items[0][quantity]': '1',
          'metadata[userId]': user.uid,
          'metadata[packageId]': pkg.id,
          'metadata[coins]': String(authoritativeCoins),
          'metadata[priceInr]': String(authoritativeInr),
        });
        const stripeResp = await fetch('https://api.stripe.com/v1/checkout/sessions', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: params.toString(),
        });
        const stripeData = (await stripeResp.json()) as { url?: string; id?: string; error?: { message?: string } };
        if (!stripeResp.ok || !stripeData.url) {
          res.status(502).json({ error: stripeData.error?.message || 'Stripe checkout initialization failed' });
          return;
        }
        res.json({
          provider: 'stripe',
          checkoutUrl: stripeData.url,
          sessionId: stripeData.id,
          packageId: pkg.id,
          packageName: pkg.name,
          coins: authoritativeCoins,
          priceInr: authoritativeInr,
          amountPaise,
          currency: 'INR',
        });
        return;
      }

      if (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET) {
        const authHeader = Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString('base64');
        const orderResp = await fetch('https://api.razorpay.com/v1/orders', {
          method: 'POST',
          headers: {
            Authorization: `Basic ${authHeader}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            amount: amountPaise,
            currency: 'INR',
            receipt: `bm_${Date.now()}`,
            notes: {
              userId: user.uid,
              packageId: pkg.id,
              coins: String(authoritativeCoins),
              priceInr: String(authoritativeInr),
            },
          }),
        });
        const orderData = (await orderResp.json()) as { id?: string; amount?: number; currency?: string; error?: { description?: string } };
        if (!orderResp.ok || !orderData.id) {
          res.status(502).json({ error: orderData.error?.description || 'Razorpay order initialization failed' });
          return;
        }
        res.json({
          provider: 'razorpay',
          orderId: orderData.id,
          amount: orderData.amount,
          amountPaise,
          currency: orderData.currency || 'INR',
          keyId: process.env.RAZORPAY_KEY_ID,
          packageId: pkg.id,
          packageName: pkg.name,
          coins: authoritativeCoins,
          priceInr: authoritativeInr,
        });
        return;
      }

      res.json({
        provider: 'owner_approval',
        packageId: pkg.id,
        packageName: pkg.name,
        coins: authoritativeCoins,
        priceInr: authoritativeInr,
        amountPaise,
        currency: 'INR',
        message: 'Live payment gateways are not configured. Submitted as an Owner-Approved coin order.',
      });
    } catch (error) {
      const status = (error as { status?: number })?.status || 500;
      const message = error instanceof Error ? error.message : 'Unable to initialize coin purchase';
      res.status(status).json({ error: message });
    }
  });

  app.post('/api/coins/verify-razorpay', async (req, res) => {
    try {
      const user = await verifyFirebaseIdToken(req.headers.authorization);
      const keyId = process.env.RAZORPAY_KEY_ID;
      const secret = process.env.RAZORPAY_KEY_SECRET;
      if (!keyId || !secret) {
        res.status(400).json({ error: 'Razorpay live payment gateway is not configured on this server.' });
        return;
      }
      const { orderId, paymentId, signature, packageId } = req.body as {
        orderId?: string;
        paymentId?: string;
        signature?: string;
        packageId?: string;
      };
      if (!orderId || !paymentId || !signature || !packageId) {
        res.status(400).json({ error: 'Missing Razorpay verification fields (orderId, paymentId, signature, packageId).' });
        return;
      }
      const pkg = await resolveAuthoritativeCoinPackage(packageId, user.idToken);
      if (!pkg) {
        res.status(400).json({ error: 'Selected package is invalid or discontinued.' });
        return;
      }
      const expectedPaise = pkg.priceInr * 100;
      const crypto = await import('crypto');
      const expected = crypto.createHmac('sha256', secret).update(`${orderId}|${paymentId}`).digest('hex');
      if (expected !== signature) {
        res.status(403).json({ verified: false, error: 'Invalid payment signature' });
        return;
      }

      const authHeader = Buffer.from(`${keyId}:${secret}`).toString('base64');
      const orderResp = await fetch(`https://api.razorpay.com/v1/orders/${encodeURIComponent(orderId)}`, {
        method: 'GET',
        headers: { Authorization: `Basic ${authHeader}` },
      });
      const orderData = (await orderResp.json().catch(() => ({}))) as {
        amount?: number;
        amount_paid?: number;
        currency?: string;
        status?: string;
        notes?: Record<string, string>;
      };
      if (
        !orderResp.ok ||
        orderData.currency !== 'INR' ||
        orderData.amount !== expectedPaise ||
        orderData.amount_paid !== expectedPaise ||
        (orderData.notes?.packageId && orderData.notes.packageId !== pkg.id)
      ) {
        res.status(400).json({
          verified: false,
          error: `Payment amount verification failed for ${pkg.name} (expected ₹${pkg.priceInr} INR).`,
        });
        return;
      }

      res.json({
        verified: true,
        paymentRef: paymentId,
        packageId: pkg.id,
        coins: pkg.coins + pkg.bonusCoins,
        priceInr: pkg.priceInr,
        amountPaise: expectedPaise,
        currency: 'INR',
      });
    } catch (error) {
      const status = (error as { status?: number })?.status || 500;
      const message = error instanceof Error ? error.message : 'Payment verification failed';
      res.status(status).json({ error: message });
    }
  });

  // ============================================================================
  // BANDHU MELA — Original Owner Controlled Coin Economy & Promotional Pool API
  // ============================================================================
  interface EconomyConfigPayload {
    id: 'coinEconomy';
    dailyBonusEnabled: boolean;
    dailyBonusCoins: number;
    weeklyBonusEnabled: boolean;
    weeklyBonusCoins: number;
    weeklyBonusWeekdayUtc: number;
    weeklyMinSpeakingMinutes: number;
    monthlyBonusEnabled: boolean;
    monthlyBonusCoins: number;
    monthlyBonusDayOfMonth: number;
    monthlyMinSpeakingMinutes: number;
    monthlyMinLevel: number;
    speakingRewardEnabled: boolean;
    speakingMinutesPerReward: number;
    speakingRewardCoins: number;
    speakingDailyMaxCoins: number;
    hostingBonusEnabled: boolean;
    hostingRateMode: 'per_minute' | 'per_hour';
    hostingCoinsPerUnit: number;
    hostingMinListeners: number;
    hostingDailyMaxCoins: number;
    hostingMonthlyMaxCoins: number;
    updatedBy: string;
    updatedAt?: unknown;
  }

  interface PromoPoolPayload {
    id: 'main';
    issuedBudget: number;
    distributedCoins: number;
    remainingBudget: number;
    paused: boolean;
    perUserDailyCap: number;
    perUserMonthlyCap: number;
    maxSingleReward: number;
    updatedBy: string;
    createdAt?: unknown;
    updatedAt?: unknown;
  }

  interface ProgressPayload {
    uid: string;
    dayKey: string;
    monthKey: string;
    dailyPromoCoinsEarned: number;
    monthlyPromoCoinsEarned: number;
    speakingCarrySeconds: number;
    speakingDailyCoinsEarned: number;
    hostingCarrySeconds: number;
    hostingDailyCoinsEarned: number;
    hostingMonthlyCoinsEarned: number;
    lastSpeakingRewardAtMs: number;
    lastHostingRewardAtMs: number;
    lastRoomId: string;
  }

  const DEFAULT_ECONOMY_CONFIG: EconomyConfigPayload = {
    id: 'coinEconomy',
    dailyBonusEnabled: true,
    dailyBonusCoins: 10,
    weeklyBonusEnabled: true,
    weeklyBonusCoins: 60,
    weeklyBonusWeekdayUtc: -1,
    weeklyMinSpeakingMinutes: 0,
    monthlyBonusEnabled: true,
    monthlyBonusCoins: 200,
    monthlyBonusDayOfMonth: 1,
    monthlyMinSpeakingMinutes: 0,
    monthlyMinLevel: 0,
    speakingRewardEnabled: true,
    speakingMinutesPerReward: 15,
    speakingRewardCoins: 5,
    speakingDailyMaxCoins: 50,
    hostingBonusEnabled: true,
    hostingRateMode: 'per_minute',
    hostingCoinsPerUnit: 2,
    hostingMinListeners: 1,
    hostingDailyMaxCoins: 120,
    hostingMonthlyMaxCoins: 1500,
    updatedBy: BOOTSTRAP_OWNER_UID,
  };

  function getUtcDayKey(d = new Date()): string {
    return d.toISOString().slice(0, 10);
  }

  function getUtcMonthKey(d = new Date()): string {
    return d.toISOString().slice(0, 7);
  }

  function getUtcIsoWeekKey(d = new Date()): string {
    const tmp = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    const dayNum = tmp.getUTCDay() || 7;
    tmp.setUTCDate(tmp.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil(((tmp.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
    return `${tmp.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
  }

  function clampInt(raw: unknown, min: number, max: number, fallback: number): number {
    const n = Math.trunc(Number(raw));
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
  }

  function sanitizeEconomyConfig(raw: Record<string, unknown>, updatedBy: string): EconomyConfigPayload {
    return {
      id: 'coinEconomy',
      dailyBonusEnabled: raw.dailyBonusEnabled !== false,
      dailyBonusCoins: clampInt(raw.dailyBonusCoins, 0, 5000, DEFAULT_ECONOMY_CONFIG.dailyBonusCoins),
      weeklyBonusEnabled: raw.weeklyBonusEnabled !== false,
      weeklyBonusCoins: clampInt(raw.weeklyBonusCoins, 0, 20000, DEFAULT_ECONOMY_CONFIG.weeklyBonusCoins),
      weeklyBonusWeekdayUtc: clampInt(
        raw.weeklyBonusWeekdayUtc,
        -1,
        6,
        DEFAULT_ECONOMY_CONFIG.weeklyBonusWeekdayUtc
      ),
      weeklyMinSpeakingMinutes: clampInt(
        raw.weeklyMinSpeakingMinutes,
        0,
        10080,
        DEFAULT_ECONOMY_CONFIG.weeklyMinSpeakingMinutes
      ),
      monthlyBonusEnabled: raw.monthlyBonusEnabled !== false,
      monthlyBonusCoins: clampInt(raw.monthlyBonusCoins, 0, 100000, DEFAULT_ECONOMY_CONFIG.monthlyBonusCoins),
      monthlyBonusDayOfMonth: clampInt(
        raw.monthlyBonusDayOfMonth,
        1,
        28,
        DEFAULT_ECONOMY_CONFIG.monthlyBonusDayOfMonth
      ),
      monthlyMinSpeakingMinutes: clampInt(
        raw.monthlyMinSpeakingMinutes,
        0,
        43200,
        DEFAULT_ECONOMY_CONFIG.monthlyMinSpeakingMinutes
      ),
      monthlyMinLevel: clampInt(raw.monthlyMinLevel, 0, 5, DEFAULT_ECONOMY_CONFIG.monthlyMinLevel),
      speakingRewardEnabled: raw.speakingRewardEnabled !== false,
      speakingMinutesPerReward: clampInt(
        raw.speakingMinutesPerReward,
        1,
        240,
        DEFAULT_ECONOMY_CONFIG.speakingMinutesPerReward
      ),
      speakingRewardCoins: clampInt(
        raw.speakingRewardCoins,
        0,
        1000,
        DEFAULT_ECONOMY_CONFIG.speakingRewardCoins
      ),
      speakingDailyMaxCoins: clampInt(
        raw.speakingDailyMaxCoins,
        0,
        10000,
        DEFAULT_ECONOMY_CONFIG.speakingDailyMaxCoins
      ),
      hostingBonusEnabled: raw.hostingBonusEnabled !== false,
      hostingRateMode: raw.hostingRateMode === 'per_hour' ? 'per_hour' : 'per_minute',
      hostingCoinsPerUnit: clampInt(
        raw.hostingCoinsPerUnit,
        0,
        5000,
        DEFAULT_ECONOMY_CONFIG.hostingCoinsPerUnit
      ),
      hostingMinListeners: clampInt(
        raw.hostingMinListeners,
        1,
        500,
        DEFAULT_ECONOMY_CONFIG.hostingMinListeners
      ),
      hostingDailyMaxCoins: clampInt(
        raw.hostingDailyMaxCoins,
        0,
        20000,
        DEFAULT_ECONOMY_CONFIG.hostingDailyMaxCoins
      ),
      hostingMonthlyMaxCoins: clampInt(
        raw.hostingMonthlyMaxCoins,
        0,
        200000,
        DEFAULT_ECONOMY_CONFIG.hostingMonthlyMaxCoins
      ),
      updatedBy: String(raw.updatedBy || updatedBy || BOOTSTRAP_OWNER_UID),
      updatedAt: raw.updatedAt,
    };
  }

  function sanitizePromoPool(raw: Record<string, unknown>, updatedBy: string): PromoPoolPayload {
    const issued = Math.max(0, Math.trunc(Number(raw.issuedBudget ?? 10000)));
    const distributed = Math.max(0, Math.trunc(Number(raw.distributedCoins ?? 0)));
    const remaining = Math.max(0, issued - distributed);
    return {
      id: 'main',
      issuedBudget: issued,
      distributedCoins: distributed,
      remainingBudget: remaining,
      paused: Boolean(raw.paused),
      perUserDailyCap: clampInt(raw.perUserDailyCap, 0, 50000, 500),
      perUserMonthlyCap: clampInt(raw.perUserMonthlyCap, 0, 500000, 5000),
      maxSingleReward: clampInt(raw.maxSingleReward, 1, 5000, 1000),
      updatedBy: String(raw.updatedBy || updatedBy || BOOTSTRAP_OWNER_UID),
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
    };
  }

  function normalizeUserProgress(raw: Record<string, unknown> | undefined, uid: string): ProgressPayload {
    const dayKey = getUtcDayKey();
    const monthKey = getUtcMonthKey();
    const sameDay = raw?.dayKey === dayKey;
    const sameMonth = raw?.monthKey === monthKey;
    return {
      uid,
      dayKey,
      monthKey,
      dailyPromoCoinsEarned: sameDay ? Math.max(0, Math.trunc(Number(raw?.dailyPromoCoinsEarned || 0))) : 0,
      monthlyPromoCoinsEarned: sameMonth ? Math.max(0, Math.trunc(Number(raw?.monthlyPromoCoinsEarned || 0))) : 0,
      speakingCarrySeconds: sameDay ? Math.max(0, Math.trunc(Number(raw?.speakingCarrySeconds || 0))) : 0,
      speakingDailyCoinsEarned: sameDay ? Math.max(0, Math.trunc(Number(raw?.speakingDailyCoinsEarned || 0))) : 0,
      hostingCarrySeconds: sameDay ? Math.max(0, Math.trunc(Number(raw?.hostingCarrySeconds || 0))) : 0,
      hostingDailyCoinsEarned: sameDay ? Math.max(0, Math.trunc(Number(raw?.hostingDailyCoinsEarned || 0))) : 0,
      hostingMonthlyCoinsEarned: sameMonth ? Math.max(0, Math.trunc(Number(raw?.hostingMonthlyCoinsEarned || 0))) : 0,
      lastSpeakingRewardAtMs: Math.max(0, Math.trunc(Number(raw?.lastSpeakingRewardAtMs || 0))),
      lastHostingRewardAtMs: Math.max(0, Math.trunc(Number(raw?.lastHostingRewardAtMs || 0))),
      lastRoomId: String(raw?.lastRoomId || ''),
    };
  }

  function encodeEconomyConfigFields(cfg: EconomyConfigPayload, ownerUid: string): Record<string, FirestoreFieldValue> {
    return {
      id: encodeStringField('coinEconomy'),
      dailyBonusEnabled: encodeBoolField(cfg.dailyBonusEnabled),
      dailyBonusCoins: encodeIntField(cfg.dailyBonusCoins),
      weeklyBonusEnabled: encodeBoolField(cfg.weeklyBonusEnabled),
      weeklyBonusCoins: encodeIntField(cfg.weeklyBonusCoins),
      weeklyBonusWeekdayUtc: encodeIntField(cfg.weeklyBonusWeekdayUtc),
      weeklyMinSpeakingMinutes: encodeIntField(cfg.weeklyMinSpeakingMinutes),
      monthlyBonusEnabled: encodeBoolField(cfg.monthlyBonusEnabled),
      monthlyBonusCoins: encodeIntField(cfg.monthlyBonusCoins),
      monthlyBonusDayOfMonth: encodeIntField(cfg.monthlyBonusDayOfMonth),
      monthlyMinSpeakingMinutes: encodeIntField(cfg.monthlyMinSpeakingMinutes),
      monthlyMinLevel: encodeIntField(cfg.monthlyMinLevel),
      speakingRewardEnabled: encodeBoolField(cfg.speakingRewardEnabled),
      speakingMinutesPerReward: encodeIntField(cfg.speakingMinutesPerReward),
      speakingRewardCoins: encodeIntField(cfg.speakingRewardCoins),
      speakingDailyMaxCoins: encodeIntField(cfg.speakingDailyMaxCoins),
      hostingBonusEnabled: encodeBoolField(cfg.hostingBonusEnabled),
      hostingRateMode: encodeStringField(cfg.hostingRateMode),
      hostingCoinsPerUnit: encodeIntField(cfg.hostingCoinsPerUnit),
      hostingMinListeners: encodeIntField(cfg.hostingMinListeners),
      hostingDailyMaxCoins: encodeIntField(cfg.hostingDailyMaxCoins),
      hostingMonthlyMaxCoins: encodeIntField(cfg.hostingMonthlyMaxCoins),
      updatedBy: encodeStringField(ownerUid),
    };
  }

  function encodePromoPoolFields(pool: PromoPoolPayload, ownerUid: string): Record<string, FirestoreFieldValue> {
    return {
      id: encodeStringField('main'),
      issuedBudget: encodeIntField(pool.issuedBudget),
      distributedCoins: encodeIntField(pool.distributedCoins),
      remainingBudget: encodeIntField(pool.remainingBudget),
      paused: encodeBoolField(pool.paused),
      perUserDailyCap: encodeIntField(pool.perUserDailyCap),
      perUserMonthlyCap: encodeIntField(pool.perUserMonthlyCap),
      maxSingleReward: encodeIntField(pool.maxSingleReward),
      updatedBy: encodeStringField(ownerUid),
    };
  }

  function encodeProgressFields(p: ProgressPayload): Record<string, FirestoreFieldValue> {
    return {
      uid: encodeStringField(p.uid),
      dayKey: encodeStringField(p.dayKey),
      monthKey: encodeStringField(p.monthKey),
      dailyPromoCoinsEarned: encodeIntField(p.dailyPromoCoinsEarned),
      monthlyPromoCoinsEarned: encodeIntField(p.monthlyPromoCoinsEarned),
      speakingCarrySeconds: encodeIntField(p.speakingCarrySeconds),
      speakingDailyCoinsEarned: encodeIntField(p.speakingDailyCoinsEarned),
      hostingCarrySeconds: encodeIntField(p.hostingCarrySeconds),
      hostingDailyCoinsEarned: encodeIntField(p.hostingDailyCoinsEarned),
      hostingMonthlyCoinsEarned: encodeIntField(p.hostingMonthlyCoinsEarned),
      lastSpeakingRewardAtMs: encodeIntField(p.lastSpeakingRewardAtMs),
      lastHostingRewardAtMs: encodeIntField(p.lastHostingRewardAtMs),
      lastRoomId: encodeStringField(p.lastRoomId.slice(0, 128)),
    };
  }

  async function ensureUserWalletExists(uid: string, idToken: string) {
    const walletDoc = await firestoreGetDoc(`wallets/${uid}`, idToken);
    if (walletDoc.exists) return walletDoc;

    const txId = `tx_starter_${uid.slice(0, 12)}_${Date.now().toString(36)}`;
    const dbPath = getFirestoreDbPath();
    await firestoreCommitWrites(
      [
        {
          update: {
            name: `${dbPath}/documents/wallets/${uid}`,
            fields: {
              uid: encodeStringField(uid),
              coinsBalance: encodeIntField(100),
              earnedBeans: encodeIntField(0),
              totalSpent: encodeIntField(0),
              totalPurchased: encodeIntField(0),
              totalPromotionalEarned: encodeIntField(0),
            },
          },
          currentDocument: { exists: false },
          updateTransforms: [
            { fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' },
            { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' },
          ],
        },
        {
          update: {
            name: `${dbPath}/documents/coinTransactions/${txId}`,
            fields: {
              id: encodeStringField(txId),
              userId: encodeStringField(uid),
              counterpartyId: encodeStringField('system'),
              counterpartyName: encodeStringField('BANDHU MELA'),
              type: encodeStringField('starter'),
              coinsDelta: encodeIntField(100),
              note: encodeStringField('Welcome starter coins'),
              referenceId: encodeStringField('starter'),
              coinSource: encodeStringField('promotional'),
            },
          },
          currentDocument: { exists: false },
          updateTransforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }],
        },
      ],
      idToken
    );
    return firestoreGetDoc(`wallets/${uid}`, idToken);
  }

  function computeUserLevelIndex(monthlySeconds: number, levelConfigDoc: Record<string, unknown> | undefined): number {
    const rawLevels = Array.isArray(levelConfigDoc?.levels) ? levelConfigDoc.levels : null;
    const defaultMinHours = [1, 5, 20, 50, 100];
    let lvl = 0;
    for (let i = 0; i < 5; i++) {
      const tier = rawLevels?.[i] as { minHours?: unknown; level?: unknown } | undefined;
      const minHours = Number(tier?.minHours ?? defaultMinHours[i]);
      if (monthlySeconds >= minHours * 3600) {
        lvl = Number(tier?.level ?? i + 1);
      }
    }
    return lvl;
  }

  function evaluateBonusEligibility(params: {
    config: EconomyConfigPayload;
    pool: PromoPoolPayload | null;
    dailyClaimed: boolean;
    weeklyClaimed: boolean;
    monthlyClaimed: boolean;
    monthlySpeakingSeconds: number;
    userLevel: number;
  }) {
    const now = new Date();
    const dayKey = getUtcDayKey(now);
    const weekKey = getUtcIsoWeekKey(now);
    const monthKey = getUtcMonthKey(now);
    const weekdayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const currentWeekday = now.getUTCDay();
    const currentIsoWeekday = currentWeekday === 0 ? 7 : currentWeekday;
    const targetIsoWeekday =
      params.config.weeklyBonusWeekdayUtc === -1
        ? -1
        : params.config.weeklyBonusWeekdayUtc === 0
        ? 7
        : params.config.weeklyBonusWeekdayUtc;
    const speakingMinutesThisMonth = Math.floor(params.monthlySpeakingSeconds / 60);

    const poolBlockedReason = !params.pool
      ? 'Promotional pool awaits initial funding by the Platform Owner'
      : params.pool.paused
      ? 'Promotional rewards are currently paused by the Platform Owner'
      : '';

    const dailyEligible =
      !poolBlockedReason &&
      !params.dailyClaimed &&
      params.config.dailyBonusEnabled &&
      params.config.dailyBonusCoins > 0 &&
      (params.pool?.remainingBudget || 0) >= params.config.dailyBonusCoins;
    const dailyReason = params.dailyClaimed
      ? 'Already claimed for today (UTC)'
      : !params.config.dailyBonusEnabled || params.config.dailyBonusCoins <= 0
      ? 'Daily bonus is currently disabled'
      : poolBlockedReason
      ? poolBlockedReason
      : (params.pool?.remainingBudget || 0) < params.config.dailyBonusCoins
      ? 'Promotional pool budget exhausted'
      : 'Ready to claim';

    const weeklyScheduleOk = targetIsoWeekday === -1 || currentIsoWeekday >= targetIsoWeekday;
    const weeklySpeakingOk = speakingMinutesThisMonth >= params.config.weeklyMinSpeakingMinutes;
    const weeklyEligible =
      !poolBlockedReason &&
      !params.weeklyClaimed &&
      params.config.weeklyBonusEnabled &&
      params.config.weeklyBonusCoins > 0 &&
      weeklyScheduleOk &&
      weeklySpeakingOk &&
      (params.pool?.remainingBudget || 0) >= params.config.weeklyBonusCoins;
    const weeklyReason = params.weeklyClaimed
      ? 'Already claimed this week'
      : !params.config.weeklyBonusEnabled || params.config.weeklyBonusCoins <= 0
      ? 'Weekly bonus is disabled'
      : !weeklyScheduleOk
      ? `Opens on ${weekdayNames[params.config.weeklyBonusWeekdayUtc]} (UTC)`
      : !weeklySpeakingOk
      ? `Requires ${params.config.weeklyMinSpeakingMinutes} active speaking mins (${speakingMinutesThisMonth}/${params.config.weeklyMinSpeakingMinutes})`
      : poolBlockedReason
      ? poolBlockedReason
      : (params.pool?.remainingBudget || 0) < params.config.weeklyBonusCoins
      ? 'Promotional pool budget exhausted'
      : 'Ready to claim';

    const monthlyScheduleOk = now.getUTCDate() >= params.config.monthlyBonusDayOfMonth;
    const monthlySpeakingOk = speakingMinutesThisMonth >= params.config.monthlyMinSpeakingMinutes;
    const monthlyLevelOk = params.userLevel >= params.config.monthlyMinLevel;
    const monthlyEligible =
      !poolBlockedReason &&
      !params.monthlyClaimed &&
      params.config.monthlyBonusEnabled &&
      params.config.monthlyBonusCoins > 0 &&
      monthlyScheduleOk &&
      monthlySpeakingOk &&
      monthlyLevelOk &&
      (params.pool?.remainingBudget || 0) >= params.config.monthlyBonusCoins;
    const monthlyReason = params.monthlyClaimed
      ? 'Already claimed this month'
      : !params.config.monthlyBonusEnabled || params.config.monthlyBonusCoins <= 0
      ? 'Monthly bonus is disabled'
      : !monthlyScheduleOk
      ? `Opens on day ${params.config.monthlyBonusDayOfMonth} of the month (UTC)`
      : !monthlySpeakingOk
      ? `Requires ${params.config.monthlyMinSpeakingMinutes} active speaking mins (${speakingMinutesThisMonth}/${params.config.monthlyMinSpeakingMinutes})`
      : !monthlyLevelOk
      ? `Requires Level ${params.config.monthlyMinLevel} (current Lv.${params.userLevel})`
      : poolBlockedReason
      ? poolBlockedReason
      : (params.pool?.remainingBudget || 0) < params.config.monthlyBonusCoins
      ? 'Promotional pool budget exhausted'
      : 'Ready to claim';

    return {
      dayKey,
      weekKey,
      monthKey,
      daily: {
        periodKey: dayKey,
        claimed: params.dailyClaimed,
        eligible: dailyEligible,
        reason: dailyReason,
        amount: params.config.dailyBonusCoins,
      },
      weekly: {
        periodKey: weekKey,
        claimed: params.weeklyClaimed,
        eligible: weeklyEligible,
        reason: weeklyReason,
        amount: params.config.weeklyBonusCoins,
      },
      monthly: {
        periodKey: monthKey,
        claimed: params.monthlyClaimed,
        eligible: monthlyEligible,
        reason: monthlyReason,
        amount: params.config.monthlyBonusCoins,
      },
    };
  }

  app.get('/api/economy/config', async (req, res) => {
    const gateway = {
      stripeEnabled: Boolean(process.env.STRIPE_SECRET_KEY),
      razorpayEnabled: Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET),
      ownerApprovalEnabled: true,
    };
    try {
      const authHeader = req.headers.authorization;
      if (authHeader?.startsWith('Bearer ')) {
        const user = await verifyFirebaseIdToken(authHeader);
        const [cfgDoc, poolDoc] = await Promise.all([
          firestoreGetDoc('appSettings/coinEconomy', user.idToken),
          firestoreGetDoc('promotionalPool/main', user.idToken),
        ]);
        const config = cfgDoc.exists
          ? sanitizeEconomyConfig(cfgDoc.data, BOOTSTRAP_OWNER_UID)
          : DEFAULT_ECONOMY_CONFIG;
        const pool = poolDoc.exists ? sanitizePromoPool(poolDoc.data, BOOTSTRAP_OWNER_UID) : null;
        res.json({
          config,
          poolSummary: {
            initialized: Boolean(pool),
            paused: pool ? pool.paused : false,
            hasBudget: pool ? pool.remainingBudget > 0 : false,
            remainingBudget: pool ? pool.remainingBudget : 0,
          },
          gateway,
        });
        return;
      }
    } catch {
      // fall through to safe defaults when unauthenticated
    }
    res.json({
      config: DEFAULT_ECONOMY_CONFIG,
      poolSummary: { initialized: false, paused: false, hasBudget: false, remainingBudget: 0 },
      gateway,
    });
  });

  app.get('/api/owner/economy/overview', async (req, res) => {
    try {
      const owner = await verifyOriginalOwnerRequest(req.headers.authorization);
      const dbPath = getFirestoreDbPath();
      const [cfgDoc, poolDoc, pkgDocs] = await Promise.all([
        firestoreGetDoc('appSettings/coinEconomy', owner.idToken),
        firestoreGetDoc('promotionalPool/main', owner.idToken),
        firestoreListCollection('coinPackages', owner.idToken, 50),
      ]);

      const bootstrapWrites: unknown[] = [];
      let config = cfgDoc.exists
        ? sanitizeEconomyConfig(cfgDoc.data, owner.ownerUid)
        : DEFAULT_ECONOMY_CONFIG;
      if (!cfgDoc.exists) {
        bootstrapWrites.push({
          update: {
            name: `${dbPath}/documents/appSettings/coinEconomy`,
            fields: encodeEconomyConfigFields(config, owner.ownerUid),
          },
          currentDocument: { exists: false },
          updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
        });
      }

      const legacySet = new Set<string>(LEGACY_COIN_PACKAGE_IDS);
      const existingPkgIds = new Set(pkgDocs.map((d) => d.id));
      let removedLegacy = false;
      for (const d of pkgDocs) {
        if (legacySet.has(d.id)) {
          bootstrapWrites.push({ delete: `${dbPath}/documents/coinPackages/${d.id}` });
          removedLegacy = true;
        }
      }
      if (pkgDocs.length === 0 || removedLegacy) {
        for (const pkg of APPROVED_COIN_PACKAGES) {
          if (!existingPkgIds.has(pkg.id)) {
            bootstrapWrites.push({
              update: {
                name: `${dbPath}/documents/coinPackages/${pkg.id}`,
                fields: {
                  id: encodeStringField(pkg.id),
                  name: encodeStringField(pkg.name),
                  coins: encodeIntField(pkg.coins),
                  bonusCoins: encodeIntField(0),
                  priceInr: encodeIntField(pkg.priceInr),
                  priceUsd: encodeDoubleField(pkg.priceUsd),
                  active: encodeBoolField(true),
                },
              },
              currentDocument: { exists: false },
              updateTransforms: [
                { fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' },
                { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' },
              ],
            });
          }
        }
      }

      let pool = poolDoc.exists ? sanitizePromoPool(poolDoc.data, owner.ownerUid) : null;
      if (!poolDoc.exists) {
        pool = {
          id: 'main',
          issuedBudget: 10000,
          distributedCoins: 0,
          remainingBudget: 10000,
          paused: false,
          perUserDailyCap: 500,
          perUserMonthlyCap: 5000,
          maxSingleReward: 1000,
          updatedBy: owner.ownerUid,
        };
        const initLedgerId = `pl_${Date.now().toString(36)}_init`;
        bootstrapWrites.push(
          {
            update: {
              name: `${dbPath}/documents/promotionalPool/main`,
              fields: encodePromoPoolFields(pool, owner.ownerUid),
            },
            currentDocument: { exists: false },
            updateTransforms: [
              { fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' },
              { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' },
            ],
          },
          {
            update: {
              name: `${dbPath}/documents/promotionalLedger/${initLedgerId}`,
              fields: {
                id: encodeStringField(initLedgerId),
                entryType: encodeStringField('budget_issued'),
                userId: encodeStringField('pool'),
                username: encodeStringField('Owner Budget'),
                coinsDelta: encodeIntField(10000),
                budgetImpact: encodeIntField(10000),
                remainingAfter: encodeIntField(10000),
                note: encodeStringField('Initial Promotional Pool Budget (Owner Setup)'),
                actorUid: encodeStringField(owner.ownerUid),
                referenceId: encodeStringField('initial_pool'),
              },
            },
            currentDocument: { exists: false },
            updateTransforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }],
          }
        );
      }

      if (bootstrapWrites.length > 0) {
        await firestoreCommitWrites(bootstrapWrites, owner.idToken);
      }

      const ledgerDocs = await firestoreListCollection('promotionalLedger', owner.idToken, 100);
      const ledger = (
        ledgerDocs.map((d) => ({ id: d.id, ...d.data })) as Array<
          Record<string, unknown> & { id: string; createdAt?: unknown }
        >
      ).sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));

      res.json({
        config,
        pool,
        promotionalLedger: ledger,
        gateway: {
          stripeEnabled: Boolean(process.env.STRIPE_SECRET_KEY),
          razorpayEnabled: Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET),
          ownerApprovalEnabled: true,
        },
      });
    } catch (error) {
      const status = (error as { status?: number })?.status || 500;
      const message = error instanceof Error ? error.message : 'Unable to load coin economy overview.';
      res.status(status).json({ error: message });
    }
  });

  app.put('/api/owner/economy/config', async (req, res) => {
    try {
      const owner = await verifyOriginalOwnerRequest(req.headers.authorization);
      const nextCfg = sanitizeEconomyConfig((req.body || {}) as Record<string, unknown>, owner.ownerUid);
      const ownerDoc = await firestoreGetDoc(`users/${owner.ownerUid}`, owner.idToken);
      const actorName = String(ownerDoc.data.displayName || 'Original Owner');
      const dbPath = getFirestoreDbPath();

      await firestoreCommitWrites(
        [
          {
            update: {
              name: `${dbPath}/documents/appSettings/coinEconomy`,
              fields: encodeEconomyConfigFields(nextCfg, owner.ownerUid),
            },
            updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
          },
          buildAuditWrite({
            actorUid: owner.ownerUid,
            actorName,
            action: 'update_coin_economy_config',
            targetId: 'coinEconomy',
            details: `Daily=${nextCfg.dailyBonusEnabled ? nextCfg.dailyBonusCoins : 'off'}c, Weekly=${nextCfg.weeklyBonusCoins}c, Monthly=${nextCfg.monthlyBonusCoins}c, Speak=${nextCfg.speakingRewardCoins}c/${nextCfg.speakingMinutesPerReward}m, Host=${nextCfg.hostingCoinsPerUnit}c/${nextCfg.hostingRateMode}`,
          }),
        ],
        owner.idToken
      );

      res.json({ success: true, config: nextCfg });
    } catch (error) {
      const status = (error as { status?: number })?.status || 500;
      const message = error instanceof Error ? error.message : 'Unable to update coin economy configuration.';
      res.status(status).json({ error: message });
    }
  });

  app.post('/api/owner/economy/promo-pool', async (req, res) => {
    try {
      const owner = await verifyOriginalOwnerRequest(req.headers.authorization);
      const body = (req.body || {}) as {
        action?: 'issue_budget' | 'set_paused' | 'update_limits' | 'manual_promo_grant';
        amount?: number;
        paused?: boolean;
        perUserDailyCap?: number;
        perUserMonthlyCap?: number;
        maxSingleReward?: number;
        targetUid?: string;
        note?: string;
      };
      const dbPath = getFirestoreDbPath();
      const ownerDoc = await firestoreGetDoc(`users/${owner.ownerUid}`, owner.idToken);
      const actorName = String(ownerDoc.data.displayName || 'Original Owner');
      const poolDoc = await firestoreGetDoc('promotionalPool/main', owner.idToken);

      const currentPool = poolDoc.exists
        ? sanitizePromoPool(poolDoc.data, owner.ownerUid)
        : {
            id: 'main' as const,
            issuedBudget: 0,
            distributedCoins: 0,
            remainingBudget: 0,
            paused: false,
            perUserDailyCap: 500,
            perUserMonthlyCap: 5000,
            maxSingleReward: 1000,
            updatedBy: owner.ownerUid,
          };

      if (body.action === 'issue_budget') {
        const addCoins = clampInt(body.amount, 1, 10000000, 0);
        if (addCoins <= 0) {
          res.status(400).json({ error: 'Budget amount must be at least 1 coin.' });
          return;
        }
        const nextPool: PromoPoolPayload = {
          ...currentPool,
          issuedBudget: currentPool.issuedBudget + addCoins,
          remainingBudget: currentPool.remainingBudget + addCoins,
          updatedBy: owner.ownerUid,
        };
        const ledgerId = `pl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
        const writes: unknown[] = [
          {
            update: {
              name: `${dbPath}/documents/promotionalPool/main`,
              fields: encodePromoPoolFields(nextPool, owner.ownerUid),
            },
            ...(poolDoc.exists && poolDoc.updateTime
              ? { currentDocument: { updateTime: poolDoc.updateTime } }
              : {}),
            updateTransforms: [
              ...(!poolDoc.exists ? [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }] : []),
              { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' },
            ],
          },
          {
            update: {
              name: `${dbPath}/documents/promotionalLedger/${ledgerId}`,
              fields: {
                id: encodeStringField(ledgerId),
                entryType: encodeStringField('budget_issued'),
                userId: encodeStringField('pool'),
                username: encodeStringField('Owner Budget'),
                coinsDelta: encodeIntField(addCoins),
                budgetImpact: encodeIntField(addCoins),
                remainingAfter: encodeIntField(nextPool.remainingBudget),
                note: encodeStringField((body.note || `Owner issued +${addCoins} promotional coins`).slice(0, 240)),
                actorUid: encodeStringField(owner.ownerUid),
                referenceId: encodeStringField(ledgerId),
              },
            },
            currentDocument: { exists: false },
            updateTransforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }],
          },
          buildAuditWrite({
            actorUid: owner.ownerUid,
            actorName,
            action: 'issue_promo_budget',
            targetId: 'promotionalPool/main',
            details: `Issued +${addCoins} promo coins (Remaining: ${nextPool.remainingBudget})`,
          }),
        ];
        await firestoreCommitWrites(writes, owner.idToken);
        res.json({ success: true, pool: nextPool });
        return;
      }

      if (body.action === 'set_paused') {
        const nextPaused = Boolean(body.paused);
        const nextPool: PromoPoolPayload = { ...currentPool, paused: nextPaused, updatedBy: owner.ownerUid };
        const ledgerId = `pl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
        await firestoreCommitWrites(
          [
            {
              update: {
                name: `${dbPath}/documents/promotionalPool/main`,
                fields: encodePromoPoolFields(nextPool, owner.ownerUid),
              },
              ...(poolDoc.exists && poolDoc.updateTime
                ? { currentDocument: { updateTime: poolDoc.updateTime } }
                : {}),
              updateTransforms: [
                ...(!poolDoc.exists ? [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }] : []),
                { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' },
              ],
            },
            {
              update: {
                name: `${dbPath}/documents/promotionalLedger/${ledgerId}`,
                fields: {
                  id: encodeStringField(ledgerId),
                  entryType: encodeStringField('pool_status_change'),
                  userId: encodeStringField('pool'),
                  username: encodeStringField('Owner Control'),
                  coinsDelta: encodeIntField(0),
                  budgetImpact: encodeIntField(0),
                  remainingAfter: encodeIntField(nextPool.remainingBudget),
                  note: encodeStringField(nextPaused ? 'Promotional rewards paused by Owner' : 'Promotional rewards resumed by Owner'),
                  actorUid: encodeStringField(owner.ownerUid),
                  referenceId: encodeStringField(ledgerId),
                },
              },
              currentDocument: { exists: false },
              updateTransforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }],
            },
            buildAuditWrite({
              actorUid: owner.ownerUid,
              actorName,
              action: nextPaused ? 'pause_promo_pool' : 'resume_promo_pool',
              targetId: 'promotionalPool/main',
              details: nextPaused ? 'Paused promotional payouts' : 'Resumed promotional payouts',
            }),
          ],
          owner.idToken
        );
        res.json({ success: true, pool: nextPool });
        return;
      }

      if (body.action === 'update_limits') {
        const nextPool: PromoPoolPayload = {
          ...currentPool,
          perUserDailyCap: clampInt(body.perUserDailyCap, 0, 50000, currentPool.perUserDailyCap),
          perUserMonthlyCap: clampInt(body.perUserMonthlyCap, 0, 500000, currentPool.perUserMonthlyCap),
          maxSingleReward: clampInt(body.maxSingleReward, 1, 5000, currentPool.maxSingleReward),
          updatedBy: owner.ownerUid,
        };
        await firestoreCommitWrites(
          [
            {
              update: {
                name: `${dbPath}/documents/promotionalPool/main`,
                fields: encodePromoPoolFields(nextPool, owner.ownerUid),
              },
              ...(poolDoc.exists && poolDoc.updateTime
                ? { currentDocument: { updateTime: poolDoc.updateTime } }
                : {}),
              updateTransforms: [
                ...(!poolDoc.exists ? [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }] : []),
                { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' },
              ],
            },
            buildAuditWrite({
              actorUid: owner.ownerUid,
              actorName,
              action: 'update_promo_limits',
              targetId: 'promotionalPool/main',
              details: `DailyCap=${nextPool.perUserDailyCap}, MonthlyCap=${nextPool.perUserMonthlyCap}, MaxSingle=${nextPool.maxSingleReward}`,
            }),
          ],
          owner.idToken
        );
        res.json({ success: true, pool: nextPool });
        return;
      }

      if (body.action === 'manual_promo_grant') {
        const targetUid = String(body.targetUid || '').trim();
        const grantCoins = clampInt(body.amount, 1, 50000, 0);
        if (!VALID_DOC_ID_RE.test(targetUid) || grantCoins <= 0) {
          res.status(400).json({ error: 'Valid target user UID and positive promo coin amount required.' });
          return;
        }
        if (currentPool.remainingBudget < grantCoins) {
          res.status(400).json({
            error: `Insufficient Promotional Pool budget (${currentPool.remainingBudget} remaining). Issue budget first.`,
          });
          return;
        }
        const targetUserDoc = await firestoreGetDoc(`users/${targetUid}`, owner.idToken);
        if (!targetUserDoc.exists) {
          res.status(404).json({ error: 'Target registered user profile not found.' });
          return;
        }
        const walletDoc = await firestoreGetDoc(`wallets/${targetUid}`, owner.idToken);
        if (!walletDoc.exists) {
          res.status(400).json({ error: 'User has not initialized a wallet yet. Ask them to sign in once first.' });
          return;
        }
        const prevBal = Math.trunc(Number(walletDoc.data.coinsBalance || 0));
        const prevPromo = Math.trunc(Number(walletDoc.data.totalPromotionalEarned || 0));
        const nextPool: PromoPoolPayload = {
          ...currentPool,
          distributedCoins: currentPool.distributedCoins + grantCoins,
          remainingBudget: currentPool.remainingBudget - grantCoins,
          updatedBy: owner.ownerUid,
        };
        const txId = `tx_promo_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
        const ledgerId = `pl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
        const username = String(targetUserDoc.data.username || targetUserDoc.data.displayName || targetUid);
        const note = (body.note || 'Owner Promotional Reward Grant').slice(0, 200);

        await firestoreCommitWrites(
          [
            {
              update: {
                name: `${dbPath}/documents/wallets/${targetUid}`,
                fields: {
                  coinsBalance: encodeIntField(prevBal + grantCoins),
                  totalPromotionalEarned: encodeIntField(prevPromo + grantCoins),
                },
              },
              updateMask: { fieldPaths: ['coinsBalance', 'totalPromotionalEarned'] },
              currentDocument: walletDoc.updateTime ? { updateTime: walletDoc.updateTime } : { exists: true },
              updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
            },
            {
              update: {
                name: `${dbPath}/documents/promotionalPool/main`,
                fields: encodePromoPoolFields(nextPool, owner.ownerUid),
              },
              currentDocument: poolDoc.updateTime ? { updateTime: poolDoc.updateTime } : { exists: true },
              updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
            },
            {
              update: {
                name: `${dbPath}/documents/coinTransactions/${txId}`,
                fields: {
                  id: encodeStringField(txId),
                  userId: encodeStringField(targetUid),
                  counterpartyId: encodeStringField(owner.ownerUid),
                  counterpartyName: encodeStringField('BANDHU MELA Promo Pool'),
                  type: encodeStringField('promo_bonus'),
                  coinsDelta: encodeIntField(grantCoins),
                  note: encodeStringField(note),
                  referenceId: encodeStringField(ledgerId),
                  coinSource: encodeStringField('promotional'),
                },
              },
              currentDocument: { exists: false },
              updateTransforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }],
            },
            {
              update: {
                name: `${dbPath}/documents/promotionalLedger/${ledgerId}`,
                fields: {
                  id: encodeStringField(ledgerId),
                  entryType: encodeStringField('owner_promo_grant'),
                  userId: encodeStringField(targetUid),
                  username: encodeStringField(username.slice(0, 60)),
                  coinsDelta: encodeIntField(grantCoins),
                  budgetImpact: encodeIntField(-grantCoins),
                  remainingAfter: encodeIntField(nextPool.remainingBudget),
                  note: encodeStringField(note),
                  actorUid: encodeStringField(owner.ownerUid),
                  referenceId: encodeStringField(txId),
                },
              },
              currentDocument: { exists: false },
              updateTransforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }],
            },
            buildAuditWrite({
              actorUid: owner.ownerUid,
              actorName,
              action: 'owner_promo_grant',
              targetId: targetUid,
              details: `Granted +${grantCoins} promotional coins to @${username} (${note})`,
            }),
          ],
          owner.idToken
        );

        res.json({ success: true, pool: nextPool, grantedCoins: grantCoins });
        return;
      }

      res.status(400).json({ error: 'Unsupported promotional pool action.' });
    } catch (error) {
      const status = (error as { status?: number })?.status || 500;
      const message = error instanceof Error ? error.message : 'Unable to update promotional pool.';
      res.status(status).json({ error: message });
    }
  });

  app.get('/api/economy/my-status', async (req, res) => {
    try {
      const user = await verifyFirebaseIdToken(req.headers.authorization);
      const dayKey = getUtcDayKey();
      const weekKey = getUtcIsoWeekKey();
      const monthKey = getUtcMonthKey();

      const [cfgDoc, poolDoc, statsDoc, levelDoc, progressDoc, dailyClaim, weeklyClaim, monthlyClaim] =
        await Promise.all([
          firestoreGetDoc('appSettings/coinEconomy', user.idToken),
          firestoreGetDoc('promotionalPool/main', user.idToken),
          firestoreGetDoc(`speakingStats/${user.uid}`, user.idToken),
          firestoreGetDoc('appSettings/levelConfig', user.idToken),
          firestoreGetDoc(`economyProgress/${user.uid}`, user.idToken),
          firestoreGetDoc(`economyClaims/${user.uid}_daily_${dayKey}`, user.idToken),
          firestoreGetDoc(`economyClaims/${user.uid}_weekly_${weekKey}`, user.idToken),
          firestoreGetDoc(`economyClaims/${user.uid}_monthly_${monthKey}`, user.idToken),
        ]);

      const config = cfgDoc.exists
        ? sanitizeEconomyConfig(cfgDoc.data, BOOTSTRAP_OWNER_UID)
        : DEFAULT_ECONOMY_CONFIG;
      const pool = poolDoc.exists ? sanitizePromoPool(poolDoc.data, BOOTSTRAP_OWNER_UID) : null;
      const monthlySeconds =
        statsDoc.exists && statsDoc.data.monthKey === monthKey
          ? Math.max(0, Math.trunc(Number(statsDoc.data.monthlySeconds || 0)))
          : 0;
      const userLevel = computeUserLevelIndex(monthlySeconds, levelDoc.exists ? levelDoc.data : undefined);
      const progress = normalizeUserProgress(progressDoc.exists ? progressDoc.data : undefined, user.uid);
      const claims = evaluateBonusEligibility({
        config,
        pool,
        dailyClaimed: dailyClaim.exists,
        weeklyClaimed: weeklyClaim.exists,
        monthlyClaimed: monthlyClaim.exists,
        monthlySpeakingSeconds: monthlySeconds,
        userLevel,
      });

      res.json({
        config,
        pool: {
          paused: pool ? pool.paused : false,
          remainingBudget: pool ? pool.remainingBudget : 0,
          perUserDailyCap: pool ? pool.perUserDailyCap : 500,
          perUserMonthlyCap: pool ? pool.perUserMonthlyCap : 5000,
        },
        progress,
        claims: {
          daily: claims.daily,
          weekly: claims.weekly,
          monthly: claims.monthly,
        },
        gateway: {
          stripeEnabled: Boolean(process.env.STRIPE_SECRET_KEY),
          razorpayEnabled: Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET),
          ownerApprovalEnabled: true,
        },
      });
    } catch (error) {
      const status = (error as { status?: number })?.status || 500;
      const message = error instanceof Error ? error.message : 'Unable to fetch user economy status.';
      res.status(status).json({ error: message });
    }
  });

  app.post('/api/economy/claim-bonus', async (req, res) => {
    try {
      const user = await verifyFirebaseIdToken(req.headers.authorization);
      const { bonusType } = (req.body || {}) as { bonusType?: 'daily' | 'weekly' | 'monthly' };
      if (bonusType !== 'daily' && bonusType !== 'weekly' && bonusType !== 'monthly') {
        res.status(400).json({ error: 'bonusType must be "daily", "weekly", or "monthly".' });
        return;
      }

      const userDoc = await firestoreGetDoc(`users/${user.uid}`, user.idToken);
      if (userDoc.exists && userDoc.data.isSuspended) {
        res.status(403).json({ error: 'Suspended accounts cannot claim coin rewards.' });
        return;
      }

      const dayKey = getUtcDayKey();
      const weekKey = getUtcIsoWeekKey();
      const monthKey = getUtcMonthKey();
      const [cfgDoc, poolDoc, statsDoc, levelDoc, progressDoc, dailyClaim, weeklyClaim, monthlyClaim] =
        await Promise.all([
          firestoreGetDoc('appSettings/coinEconomy', user.idToken),
          firestoreGetDoc('promotionalPool/main', user.idToken),
          firestoreGetDoc(`speakingStats/${user.uid}`, user.idToken),
          firestoreGetDoc('appSettings/levelConfig', user.idToken),
          firestoreGetDoc(`economyProgress/${user.uid}`, user.idToken),
          firestoreGetDoc(`economyClaims/${user.uid}_daily_${dayKey}`, user.idToken),
          firestoreGetDoc(`economyClaims/${user.uid}_weekly_${weekKey}`, user.idToken),
          firestoreGetDoc(`economyClaims/${user.uid}_monthly_${monthKey}`, user.idToken),
        ]);

      const config = cfgDoc.exists
        ? sanitizeEconomyConfig(cfgDoc.data, BOOTSTRAP_OWNER_UID)
        : DEFAULT_ECONOMY_CONFIG;
      const pool = poolDoc.exists ? sanitizePromoPool(poolDoc.data, BOOTSTRAP_OWNER_UID) : null;
      if (!pool || !poolDoc.exists) {
        res.status(409).json({
          error: 'Promotional Reward Pool has not been funded by the Original Owner yet.',
        });
        return;
      }
      if (pool.paused) {
        res.status(403).json({ error: 'Promotional rewards are currently paused by the Platform Owner.' });
        return;
      }

      const monthlySeconds =
        statsDoc.exists && statsDoc.data.monthKey === monthKey
          ? Math.max(0, Math.trunc(Number(statsDoc.data.monthlySeconds || 0)))
          : 0;
      const userLevel = computeUserLevelIndex(monthlySeconds, levelDoc.exists ? levelDoc.data : undefined);
      const evaluation = evaluateBonusEligibility({
        config,
        pool,
        dailyClaimed: dailyClaim.exists,
        weeklyClaimed: weeklyClaim.exists,
        monthlyClaimed: monthlyClaim.exists,
        monthlySpeakingSeconds: monthlySeconds,
        userLevel,
      });

      const targetEval = evaluation[bonusType];
      if (!targetEval.eligible) {
        res.status(targetEval.claimed ? 409 : 400).json({ error: targetEval.reason });
        return;
      }

      const coinsAwarded = targetEval.amount;
      if (coinsAwarded <= 0 || coinsAwarded > pool.maxSingleReward || pool.remainingBudget < coinsAwarded) {
        res.status(409).json({
          error: 'Insufficient Promotional Pool budget or single-reward limit exceeded.',
        });
        return;
      }

      const progress = normalizeUserProgress(progressDoc.exists ? progressDoc.data : undefined, user.uid);
      if (pool.perUserDailyCap > 0 && progress.dailyPromoCoinsEarned + coinsAwarded > pool.perUserDailyCap) {
        res.status(429).json({
          error: `Daily promotional coin limit (${pool.perUserDailyCap} coins/day) reached.`,
        });
        return;
      }
      if (pool.perUserMonthlyCap > 0 && progress.monthlyPromoCoinsEarned + coinsAwarded > pool.perUserMonthlyCap) {
        res.status(429).json({
          error: `Monthly promotional coin limit (${pool.perUserMonthlyCap} coins/month) reached.`,
        });
        return;
      }

      const walletDoc = await ensureUserWalletExists(user.uid, user.idToken);
      const prevBal = Math.trunc(Number(walletDoc.data.coinsBalance || 0));
      const prevPromo = Math.trunc(Number(walletDoc.data.totalPromotionalEarned || 0));

      const dbPath = getFirestoreDbPath();
      const claimId = `${user.uid}_${bonusType}_${targetEval.periodKey}`;
      const txId = `tx_${bonusType}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
      const ledgerId = `pl_${bonusType}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
      const txType = `${bonusType}_bonus`;
      const username = String(userDoc.data.username || userDoc.data.displayName || user.email.split('@')[0] || user.uid).slice(0, 60);
      const nextPool: PromoPoolPayload = {
        ...pool,
        distributedCoins: pool.distributedCoins + coinsAwarded,
        remainingBudget: pool.remainingBudget - coinsAwarded,
      };
      const nextProgress: ProgressPayload = {
        ...progress,
        dailyPromoCoinsEarned: progress.dailyPromoCoinsEarned + coinsAwarded,
        monthlyPromoCoinsEarned: progress.monthlyPromoCoinsEarned + coinsAwarded,
      };
      const label =
        bonusType === 'daily'
          ? `Daily Check-in Bonus (${targetEval.periodKey})`
          : bonusType === 'weekly'
          ? `Weekly Loyalty Bonus (${targetEval.periodKey})`
          : `Monthly Milestone Bonus (${targetEval.periodKey})`;

      await firestoreCommitWrites(
        [
          {
            update: {
              name: `${dbPath}/documents/economyClaims/${claimId}`,
              fields: {
                id: encodeStringField(claimId),
                userId: encodeStringField(user.uid),
                bonusType: encodeStringField(bonusType),
                periodKey: encodeStringField(targetEval.periodKey),
                coinsAwarded: encodeIntField(coinsAwarded),
                transactionId: encodeStringField(txId),
              },
            },
            currentDocument: { exists: false },
            updateTransforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }],
          },
          {
            update: {
              name: `${dbPath}/documents/wallets/${user.uid}`,
              fields: {
                coinsBalance: encodeIntField(prevBal + coinsAwarded),
                totalPromotionalEarned: encodeIntField(prevPromo + coinsAwarded),
              },
            },
            updateMask: { fieldPaths: ['coinsBalance', 'totalPromotionalEarned'] },
            currentDocument: walletDoc.updateTime ? { updateTime: walletDoc.updateTime } : { exists: true },
            updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
          },
          {
            update: {
              name: `${dbPath}/documents/promotionalPool/main`,
              fields: {
                distributedCoins: encodeIntField(nextPool.distributedCoins),
                remainingBudget: encodeIntField(nextPool.remainingBudget),
              },
            },
            updateMask: { fieldPaths: ['distributedCoins', 'remainingBudget'] },
            currentDocument: poolDoc.updateTime ? { updateTime: poolDoc.updateTime } : { exists: true },
            updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
          },
          {
            update: {
              name: `${dbPath}/documents/economyProgress/${user.uid}`,
              fields: encodeProgressFields(nextProgress),
            },
            updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
          },
          {
            update: {
              name: `${dbPath}/documents/coinTransactions/${txId}`,
              fields: {
                id: encodeStringField(txId),
                userId: encodeStringField(user.uid),
                counterpartyId: encodeStringField('promotional_pool'),
                counterpartyName: encodeStringField('BANDHU MELA Rewards'),
                type: encodeStringField(txType),
                coinsDelta: encodeIntField(coinsAwarded),
                note: encodeStringField(label),
                referenceId: encodeStringField(claimId),
                coinSource: encodeStringField('promotional'),
              },
            },
            currentDocument: { exists: false },
            updateTransforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }],
          },
          {
            update: {
              name: `${dbPath}/documents/promotionalLedger/${ledgerId}`,
              fields: {
                id: encodeStringField(ledgerId),
                entryType: encodeStringField(txType),
                userId: encodeStringField(user.uid),
                username: encodeStringField(username),
                coinsDelta: encodeIntField(coinsAwarded),
                budgetImpact: encodeIntField(-coinsAwarded),
                remainingAfter: encodeIntField(nextPool.remainingBudget),
                note: encodeStringField(label),
                actorUid: encodeStringField(user.uid),
                referenceId: encodeStringField(txId),
              },
            },
            currentDocument: { exists: false },
            updateTransforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }],
          },
        ],
        user.idToken
      );

      res.json({
        success: true,
        bonusType,
        periodKey: targetEval.periodKey,
        coinsAwarded,
        newBalance: prevBal + coinsAwarded,
        transactionId: txId,
      });
    } catch (error) {
      const status = (error as { status?: number })?.status || 500;
      const message = error instanceof Error ? error.message : 'Unable to claim bonus reward.';
      res.status(status).json({ error: message });
    }
  });

  app.post('/api/economy/speaking-heartbeat', async (req, res) => {
    try {
      const user = await verifyFirebaseIdToken(req.headers.authorization);
      const { roomId, activeSeconds } = (req.body || {}) as { roomId?: string; activeSeconds?: number };
      const cleanRoomId = String(roomId || '').trim();
      const deltaSec = clampInt(activeSeconds, 0, 25, 0);
      if (!VALID_DOC_ID_RE.test(cleanRoomId) || deltaSec <= 0) {
        res.status(400).json({ error: 'Valid roomId and activeSeconds (1..25) required.' });
        return;
      }

      const [roomDoc, partDoc, cfgDoc, poolDoc, progressDoc, userDoc] = await Promise.all([
        firestoreGetDoc(`audioRooms/${cleanRoomId}`, user.idToken),
        firestoreGetDoc(`audioRooms/${cleanRoomId}/participants/${user.uid}`, user.idToken),
        firestoreGetDoc('appSettings/coinEconomy', user.idToken),
        firestoreGetDoc('promotionalPool/main', user.idToken),
        firestoreGetDoc(`economyProgress/${user.uid}`, user.idToken),
        firestoreGetDoc(`users/${user.uid}`, user.idToken),
      ]);

      if (!roomDoc.exists || roomDoc.data.status !== 'live') {
        res.status(400).json({ error: 'Audio room must be live to count active speaking time.' });
        return;
      }
      if (!partDoc.exists || partDoc.data.isBanned || Number(partDoc.data.seatNumber || 0) < 1 || partDoc.data.isMuted) {
        res.status(403).json({ error: 'Muted, off-stage, or disconnected users do not earn speaking rewards.' });
        return;
      }

      const config = cfgDoc.exists
        ? sanitizeEconomyConfig(cfgDoc.data, BOOTSTRAP_OWNER_UID)
        : DEFAULT_ECONOMY_CONFIG;
      if (!config.speakingRewardEnabled || config.speakingRewardCoins <= 0) {
        res.json({ counted: false, coinsAwarded: 0, reason: 'Speaking rewards disabled' });
        return;
      }

      const progress = normalizeUserProgress(progressDoc.exists ? progressDoc.data : undefined, user.uid);
      const nowMs = Date.now();
      if (nowMs - progress.lastSpeakingRewardAtMs < 8000) {
        res.status(429).json({ error: 'Speaking heartbeat cooldown active.' });
        return;
      }

      const thresholdSec = Math.max(60, config.speakingMinutesPerReward * 60);
      let nextCarry = progress.speakingCarrySeconds + deltaSec;
      const units = Math.floor(nextCarry / thresholdSec);
      nextCarry = nextCarry % thresholdSec;

      let coinsAwarded = units * config.speakingRewardCoins;
      const pool = poolDoc.exists ? sanitizePromoPool(poolDoc.data, BOOTSTRAP_OWNER_UID) : null;

      if (coinsAwarded > 0) {
        if (!pool || pool.paused || pool.remainingBudget <= 0) {
          coinsAwarded = 0;
        } else {
          const speakRoomLeft = Math.max(0, config.speakingDailyMaxCoins - progress.speakingDailyCoinsEarned);
          const dailyPoolLeft =
            pool.perUserDailyCap > 0 ? Math.max(0, pool.perUserDailyCap - progress.dailyPromoCoinsEarned) : coinsAwarded;
          const monthlyPoolLeft =
            pool.perUserMonthlyCap > 0
              ? Math.max(0, pool.perUserMonthlyCap - progress.monthlyPromoCoinsEarned)
              : coinsAwarded;
          coinsAwarded = Math.min(coinsAwarded, speakRoomLeft, dailyPoolLeft, monthlyPoolLeft, pool.remainingBudget, pool.maxSingleReward);
        }
      }

      const nextProgress: ProgressPayload = {
        ...progress,
        speakingCarrySeconds: nextCarry,
        speakingDailyCoinsEarned: progress.speakingDailyCoinsEarned + coinsAwarded,
        dailyPromoCoinsEarned: progress.dailyPromoCoinsEarned + coinsAwarded,
        monthlyPromoCoinsEarned: progress.monthlyPromoCoinsEarned + coinsAwarded,
        lastSpeakingRewardAtMs: nowMs,
        lastRoomId: cleanRoomId,
      };

      const dbPath = getFirestoreDbPath();
      const writes: unknown[] = [
        {
          update: {
            name: `${dbPath}/documents/economyProgress/${user.uid}`,
            fields: encodeProgressFields(nextProgress),
          },
          updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
        },
      ];

      if (coinsAwarded > 0 && pool && poolDoc.exists) {
        const walletDoc = await ensureUserWalletExists(user.uid, user.idToken);
        const prevBal = Math.trunc(Number(walletDoc.data.coinsBalance || 0));
        const prevPromo = Math.trunc(Number(walletDoc.data.totalPromotionalEarned || 0));
        const nextRemaining = pool.remainingBudget - coinsAwarded;
        const nextDist = pool.distributedCoins + coinsAwarded;
        const txId = `tx_spk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
        const ledgerId = `pl_spk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
        const username = String(userDoc.data.username || userDoc.data.displayName || user.uid).slice(0, 60);
        const note = `Active Speaking Reward (${config.speakingMinutesPerReward}m in ${String(roomDoc.data.title || 'Audio Party')})`.slice(0, 200);

        writes.push(
          {
            update: {
              name: `${dbPath}/documents/wallets/${user.uid}`,
              fields: {
                coinsBalance: encodeIntField(prevBal + coinsAwarded),
                totalPromotionalEarned: encodeIntField(prevPromo + coinsAwarded),
              },
            },
            updateMask: { fieldPaths: ['coinsBalance', 'totalPromotionalEarned'] },
            currentDocument: walletDoc.updateTime ? { updateTime: walletDoc.updateTime } : { exists: true },
            updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
          },
          {
            update: {
              name: `${dbPath}/documents/promotionalPool/main`,
              fields: {
                distributedCoins: encodeIntField(nextDist),
                remainingBudget: encodeIntField(nextRemaining),
              },
            },
            updateMask: { fieldPaths: ['distributedCoins', 'remainingBudget'] },
            currentDocument: poolDoc.updateTime ? { updateTime: poolDoc.updateTime } : { exists: true },
            updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
          },
          {
            update: {
              name: `${dbPath}/documents/coinTransactions/${txId}`,
              fields: {
                id: encodeStringField(txId),
                userId: encodeStringField(user.uid),
                counterpartyId: encodeStringField('promotional_pool'),
                counterpartyName: encodeStringField('Speaking Rewards'),
                type: encodeStringField('speaking_reward'),
                coinsDelta: encodeIntField(coinsAwarded),
                note: encodeStringField(note),
                referenceId: encodeStringField(cleanRoomId),
                coinSource: encodeStringField('promotional'),
              },
            },
            currentDocument: { exists: false },
            updateTransforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }],
          },
          {
            update: {
              name: `${dbPath}/documents/promotionalLedger/${ledgerId}`,
              fields: {
                id: encodeStringField(ledgerId),
                entryType: encodeStringField('speaking_reward'),
                userId: encodeStringField(user.uid),
                username: encodeStringField(username),
                coinsDelta: encodeIntField(coinsAwarded),
                budgetImpact: encodeIntField(-coinsAwarded),
                remainingAfter: encodeIntField(nextRemaining),
                note: encodeStringField(note),
                actorUid: encodeStringField(user.uid),
                referenceId: encodeStringField(txId),
              },
            },
            currentDocument: { exists: false },
            updateTransforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }],
          }
        );
      }

      await firestoreCommitWrites(writes, user.idToken);
      res.json({ counted: true, coinsAwarded, progress: nextProgress });
    } catch (error) {
      const status = (error as { status?: number })?.status || 500;
      const message = error instanceof Error ? error.message : 'Speaking reward check failed.';
      res.status(status).json({ error: message });
    }
  });

  app.post('/api/economy/hosting-heartbeat', async (req, res) => {
    try {
      const user = await verifyFirebaseIdToken(req.headers.authorization);
      const { roomId, activeSeconds } = (req.body || {}) as { roomId?: string; activeSeconds?: number };
      const cleanRoomId = String(roomId || '').trim();
      const deltaSec = clampInt(activeSeconds, 15, 75, 0);
      if (!VALID_DOC_ID_RE.test(cleanRoomId) || deltaSec <= 0) {
        res.status(400).json({ error: 'Valid roomId and activeSeconds (15..75) required.' });
        return;
      }

      const [roomDoc, cfgDoc, poolDoc, progressDoc, userDoc] = await Promise.all([
        firestoreGetDoc(`audioRooms/${cleanRoomId}`, user.idToken),
        firestoreGetDoc('appSettings/coinEconomy', user.idToken),
        firestoreGetDoc('promotionalPool/main', user.idToken),
        firestoreGetDoc(`economyProgress/${user.uid}`, user.idToken),
        firestoreGetDoc(`users/${user.uid}`, user.idToken),
      ]);

      if (!roomDoc.exists || roomDoc.data.status !== 'live' || roomDoc.data.hostId !== user.uid) {
        res.status(403).json({ error: 'Only verified live room hosts can earn hosting rewards.' });
        return;
      }

      const config = cfgDoc.exists
        ? sanitizeEconomyConfig(cfgDoc.data, BOOTSTRAP_OWNER_UID)
        : DEFAULT_ECONOMY_CONFIG;
      if (!config.hostingBonusEnabled || config.hostingCoinsPerUnit <= 0) {
        res.json({ counted: false, coinsAwarded: 0, reason: 'Hosting rewards disabled' });
        return;
      }
      const participantsCount = Math.trunc(Number(roomDoc.data.participantsCount || 0));
      if (participantsCount < config.hostingMinListeners) {
        res.json({
          counted: false,
          coinsAwarded: 0,
          reason: `Requires at least ${config.hostingMinListeners} room participants.`,
        });
        return;
      }

      const progress = normalizeUserProgress(progressDoc.exists ? progressDoc.data : undefined, user.uid);
      const nowMs = Date.now();
      if (nowMs - progress.lastHostingRewardAtMs < 45000) {
        res.status(429).json({ error: 'Hosting heartbeat cooldown active.' });
        return;
      }

      const unitSeconds = config.hostingRateMode === 'per_hour' ? 3600 : 60;
      let nextCarry = progress.hostingCarrySeconds + deltaSec;
      const units = Math.floor(nextCarry / unitSeconds);
      nextCarry = nextCarry % unitSeconds;

      let coinsAwarded = units * config.hostingCoinsPerUnit;
      const pool = poolDoc.exists ? sanitizePromoPool(poolDoc.data, BOOTSTRAP_OWNER_UID) : null;

      if (coinsAwarded > 0) {
        if (!pool || pool.paused || pool.remainingBudget <= 0) {
          coinsAwarded = 0;
        } else {
          const hostDayLeft = Math.max(0, config.hostingDailyMaxCoins - progress.hostingDailyCoinsEarned);
          const hostMonthLeft = Math.max(0, config.hostingMonthlyMaxCoins - progress.hostingMonthlyCoinsEarned);
          const dailyPoolLeft =
            pool.perUserDailyCap > 0 ? Math.max(0, pool.perUserDailyCap - progress.dailyPromoCoinsEarned) : coinsAwarded;
          const monthlyPoolLeft =
            pool.perUserMonthlyCap > 0
              ? Math.max(0, pool.perUserMonthlyCap - progress.monthlyPromoCoinsEarned)
              : coinsAwarded;
          coinsAwarded = Math.min(
            coinsAwarded,
            hostDayLeft,
            hostMonthLeft,
            dailyPoolLeft,
            monthlyPoolLeft,
            pool.remainingBudget,
            pool.maxSingleReward
          );
        }
      }

      const nextProgress: ProgressPayload = {
        ...progress,
        hostingCarrySeconds: nextCarry,
        hostingDailyCoinsEarned: progress.hostingDailyCoinsEarned + coinsAwarded,
        hostingMonthlyCoinsEarned: progress.hostingMonthlyCoinsEarned + coinsAwarded,
        dailyPromoCoinsEarned: progress.dailyPromoCoinsEarned + coinsAwarded,
        monthlyPromoCoinsEarned: progress.monthlyPromoCoinsEarned + coinsAwarded,
        lastHostingRewardAtMs: nowMs,
        lastRoomId: cleanRoomId,
      };

      const dbPath = getFirestoreDbPath();
      const writes: unknown[] = [
        {
          update: {
            name: `${dbPath}/documents/economyProgress/${user.uid}`,
            fields: encodeProgressFields(nextProgress),
          },
          updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
        },
      ];

      if (coinsAwarded > 0 && pool && poolDoc.exists) {
        const walletDoc = await ensureUserWalletExists(user.uid, user.idToken);
        const prevBal = Math.trunc(Number(walletDoc.data.coinsBalance || 0));
        const prevPromo = Math.trunc(Number(walletDoc.data.totalPromotionalEarned || 0));
        const nextRemaining = pool.remainingBudget - coinsAwarded;
        const nextDist = pool.distributedCoins + coinsAwarded;
        const txId = `tx_hst_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
        const ledgerId = `pl_hst_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
        const username = String(userDoc.data.username || userDoc.data.displayName || user.uid).slice(0, 60);
        const note = `Live Room Hosting Bonus (${String(roomDoc.data.title || 'Audio Party')})`.slice(0, 200);

        writes.push(
          {
            update: {
              name: `${dbPath}/documents/wallets/${user.uid}`,
              fields: {
                coinsBalance: encodeIntField(prevBal + coinsAwarded),
                totalPromotionalEarned: encodeIntField(prevPromo + coinsAwarded),
              },
            },
            updateMask: { fieldPaths: ['coinsBalance', 'totalPromotionalEarned'] },
            currentDocument: walletDoc.updateTime ? { updateTime: walletDoc.updateTime } : { exists: true },
            updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
          },
          {
            update: {
              name: `${dbPath}/documents/promotionalPool/main`,
              fields: {
                distributedCoins: encodeIntField(nextDist),
                remainingBudget: encodeIntField(nextRemaining),
              },
            },
            updateMask: { fieldPaths: ['distributedCoins', 'remainingBudget'] },
            currentDocument: poolDoc.updateTime ? { updateTime: poolDoc.updateTime } : { exists: true },
            updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
          },
          {
            update: {
              name: `${dbPath}/documents/coinTransactions/${txId}`,
              fields: {
                id: encodeStringField(txId),
                userId: encodeStringField(user.uid),
                counterpartyId: encodeStringField('promotional_pool'),
                counterpartyName: encodeStringField('Hosting Bonus'),
                type: encodeStringField('hosting_reward'),
                coinsDelta: encodeIntField(coinsAwarded),
                note: encodeStringField(note),
                referenceId: encodeStringField(cleanRoomId),
                coinSource: encodeStringField('promotional'),
              },
            },
            currentDocument: { exists: false },
            updateTransforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }],
          },
          {
            update: {
              name: `${dbPath}/documents/promotionalLedger/${ledgerId}`,
              fields: {
                id: encodeStringField(ledgerId),
                entryType: encodeStringField('hosting_reward'),
                userId: encodeStringField(user.uid),
                username: encodeStringField(username),
                coinsDelta: encodeIntField(coinsAwarded),
                budgetImpact: encodeIntField(-coinsAwarded),
                remainingAfter: encodeIntField(nextRemaining),
                note: encodeStringField(note),
                actorUid: encodeStringField(user.uid),
                referenceId: encodeStringField(txId),
              },
            },
            currentDocument: { exists: false },
            updateTransforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }],
          }
        );
      }

      await firestoreCommitWrites(writes, user.idToken);
      res.json({ counted: true, coinsAwarded, progress: nextProgress });
    } catch (error) {
      const status = (error as { status?: number })?.status || 500;
      const message = error instanceof Error ? error.message : 'Hosting reward check failed.';
      res.status(status).json({ error: message });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR !== 'true',
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir, { maxAge: '7d' }));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`BANDHU MELA server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
