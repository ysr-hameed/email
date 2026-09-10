import type { Context, Next } from 'hono';

export interface MailEnv {
  DB: D1Database;
  ATTACHMENTS: R2Bucket;
  RATE_LIMIT: KVNamespace;
  MAIL_ADMIN_EMAIL: string;
  MAIL_ADMIN_NAME: string;
  MAIL_DOMAIN: string;
  FRONTEND_ORIGIN: string;
  MAIL_ADMIN_PASSWORD_HASH: string;
  BREVO_API_KEY: string;
}

export type MailContext = Context<{ Bindings: MailEnv; Variables: { userEmail: string } }>;

export async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [algorithm, iterationsRaw, salt, expected] = encoded.split('$');
  if (algorithm !== 'pbkdf2' || !iterationsRaw || !salt || !expected) return false;
  const iterations = Number(iterationsRaw);
  if (!Number.isInteger(iterations) || iterations < 10000 || iterations > 1000000) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const saltBytes = decodeBase64Url(salt);
  const saltBuffer = new Uint8Array(saltBytes.byteLength);
  saltBuffer.set(saltBytes);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: saltBuffer, iterations, hash: 'SHA-256' }, key, 256);
  return constantTimeEqual(encodeBase64Url(new Uint8Array(bits)), expected);
}

export async function createSession(db: D1Database, email: string): Promise<string> {
  const token = `${crypto.randomUUID()}${crypto.randomUUID()}`;
  const tokenHash = await sha256(token);
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString();
  await db.prepare('INSERT INTO sessions (id, token_hash, email, expires_at) VALUES (?, ?, ?, ?)')
    .bind(crypto.randomUUID(), tokenHash, email, expiresAt).run();
  return token;
}

export function sessionCookie(token: string, maxAge = 60 * 60 * 24 * 30): string {
  return `mail_session=${token}; Max-Age=${maxAge}; Path=/; HttpOnly; Secure; SameSite=Lax`;
}

export function clearSessionCookie(): string {
  return 'mail_session=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax';
}

export function getCookie(request: Request, name: string): string | null {
  const cookies = request.headers.get('Cookie')?.split(';') ?? [];
  for (const cookie of cookies) {
    const [key, ...parts] = cookie.trim().split('=');
    if (key === name) return parts.join('=') || null;
  }
  return null;
}

export async function requireSession(c: MailContext, next: Next): Promise<Response | void> {
  const token = getCookie(c.req.raw, 'mail_session');
  if (!token) return c.json({ ok: false, error: 'Unauthorized' }, 401);
  const tokenHash = await sha256(token);
  const session = await c.env.DB.prepare('SELECT email, expires_at FROM sessions WHERE token_hash = ?')
    .bind(tokenHash).first<{ email: string; expires_at: string }>();
  if (!session || Date.parse(session.expires_at) <= Date.now()) return c.json({ ok: false, error: 'Session expired' }, 401);
  c.set('userEmail', session.email);
  await next();
}

function decodeBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((value.length + 3) % 4);
  const binary = atob(normalized);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  if (leftBytes.length !== rightBytes.length) return false;
  let result = 0;
  for (let index = 0; index < leftBytes.length; index += 1) result |= leftBytes[index] ^ rightBytes[index];
  return result === 0;
}
