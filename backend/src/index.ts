import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { deleteCookie } from 'hono/cookie';
import { z } from 'zod';
import { checkRateLimit, clearSessionCookie, createSession, getCookie, requireSession, type MailContext, type MailEnv, sha256, verifyPassword } from './auth';
import { escapeHtml, parseInbound, sendWithBrevo } from './email';

const app = new Hono<{ Bindings: MailEnv; Variables: { userEmail: string } }>();

app.use('*', async (c, next) => {
  const origin = c.req.header('Origin');
  const allowed = [c.env.FRONTEND_ORIGIN, 'http://localhost:5173', 'http://127.0.0.1:5173'];
  if (origin && allowed.includes(origin)) {
    c.header('Access-Control-Allow-Origin', origin);
    c.header('Access-Control-Allow-Credentials', 'true');
    c.header('Vary', 'Origin');
  }
  c.header('Access-Control-Allow-Headers', 'Content-Type');
  c.header('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  if (c.req.method === 'OPTIONS') return c.body(null, 204);
  await next();
});

app.get('/health', (c) => c.json({ ok: true, service: 'slyxup-email' }));

app.use('/api/auth/login', async (c, next) => {
  const ip = c.req.header('CF-Connecting-IP') ?? 'unknown';
  if (!(await checkRateLimit(c.env.RATE_LIMIT, `login:${ip}`, 10, 300))) return c.json({ ok: false, error: 'Too many sign-in attempts. Try again later.' }, 429);
  await next();
});

app.post('/api/auth/login', zValidator('json', z.object({ email: z.string().email(), password: z.string().min(1).max(200) })), async (c) => {
  const { email, password } = c.req.valid('json');
  if (email.toLowerCase() !== c.env.MAIL_ADMIN_EMAIL.toLowerCase() || !(await verifyPassword(password, c.env.MAIL_ADMIN_PASSWORD_HASH))) {
    return c.json({ ok: false, error: 'Invalid email or password' }, 401);
  }
  const token = await createSession(c.env.DB, c.env.MAIL_ADMIN_EMAIL);
  c.header('Set-Cookie', `mail_session=${token}; Max-Age=2592000; Path=/; HttpOnly; Secure; SameSite=Lax`);
  return c.json({ ok: true, user: { email: c.env.MAIL_ADMIN_EMAIL, name: c.env.MAIL_ADMIN_NAME } });
});

app.post('/api/auth/logout', async (c) => {
  const token = getCookie(c.req.raw, 'mail_session');
  if (token) await c.env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(token)).run();
  c.header('Set-Cookie', clearSessionCookie());
  deleteCookie(c, 'mail_session', { path: '/' });
  return c.json({ ok: true });
});

app.get('/api/auth/session', requireSession, (c) => c.json({ ok: true, user: { email: c.env.MAIL_ADMIN_EMAIL, name: c.env.MAIL_ADMIN_NAME } }));

app.get('/api/aliases', requireSession, async (c) => {
  const rows = await c.env.DB.prepare('SELECT id, local_part, display_name, enabled, created_at FROM aliases ORDER BY local_part').all<AliasRow>();
  return c.json({ ok: true, aliases: rows.results.map((row) => aliasResponse(row, c.env.MAIL_DOMAIN)) });
});

app.post('/api/aliases', requireSession, zValidator('json', z.object({ localPart: z.string().regex(/^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/i), displayName: z.string().trim().max(80).optional() })), async (c) => {
  const { localPart, displayName } = c.req.valid('json');
  const local = localPart.toLowerCase();
  try {
    const id = crypto.randomUUID();
    await c.env.DB.prepare('INSERT INTO aliases (id, local_part, display_name) VALUES (?, ?, ?)').bind(id, local, displayName || null).run();
    const row = await c.env.DB.prepare('SELECT id, local_part, display_name, enabled, created_at FROM aliases WHERE id = ?').bind(id).first<AliasRow>();
    return c.json({ ok: true, alias: aliasResponse(row!, c.env.MAIL_DOMAIN) }, 201);
  } catch {
    return c.json({ ok: false, error: 'That alias already exists' }, 409);
  }
});

app.patch('/api/aliases/:id', requireSession, zValidator('json', z.object({ enabled: z.boolean().optional(), displayName: z.string().trim().max(80).nullable().optional() })), async (c) => {
  const input = c.req.valid('json');
  const id = c.req.param('id');
  const current = await c.env.DB.prepare('SELECT id, local_part, display_name, enabled, created_at FROM aliases WHERE id = ?').bind(id).first<AliasRow>();
  if (!current) return c.json({ ok: false, error: 'Alias not found' }, 404);
  await c.env.DB.prepare('UPDATE aliases SET enabled = ?, display_name = ? WHERE id = ?').bind(input.enabled ?? current.enabled, input.displayName === undefined ? current.display_name : input.displayName, id).run();
  const updated: AliasRow = { ...current, enabled: Number(input.enabled ?? current.enabled), display_name: input.displayName === undefined ? current.display_name : input.displayName };
  return c.json({ ok: true, alias: aliasResponse(updated, c.env.MAIL_DOMAIN) });
});

app.delete('/api/aliases/:id', requireSession, async (c) => {
  const id = c.req.param('id');
  const count = await c.env.DB.prepare('SELECT COUNT(*) AS count FROM aliases').first<{ count: number }>();
  if ((count?.count ?? 0) <= 1) return c.json({ ok: false, error: 'Keep at least one alias enabled' }, 400);
  await c.env.DB.prepare('DELETE FROM aliases WHERE id = ?').bind(id).run();
  return c.json({ ok: true });
});

app.get('/api/messages', requireSession, async (c) => {
  const mailbox = c.req.query('mailbox') ?? 'inbox';
  const search = c.req.query('q')?.trim() ?? '';
  const page = Math.max(Number(c.req.query('page') ?? 1), 1);
  const limit = Math.min(Math.max(Number(c.req.query('limit') ?? 50), 1), 100);
  const offset = (page - 1) * limit;
  const conditions: string[] = [];
  const params: string[] = [];
  if (mailbox === 'sent') conditions.push("m.direction = 'outbound'");
  else if (mailbox === 'starred') conditions.push('m.starred = 1 AND m.trashed = 0');
  else if (mailbox === 'archive') conditions.push('m.archived = 1 AND m.trashed = 0');
  else if (mailbox === 'trash') conditions.push('m.trashed = 1');
  else conditions.push("m.direction = 'inbound' AND m.archived = 0 AND m.trashed = 0");
  if (search) {
    conditions.push('(LOWER(m.sender) LIKE ? OR LOWER(m.subject) LIKE ? OR LOWER(m.text_body) LIKE ? OR LOWER(m.recipients_json) LIKE ?)');
    const value = `%${search.toLowerCase()}%`;
    params.push(value, value, value, value);
  }
  const where = conditions.join(' AND ');
  const query = `SELECT m.*, (SELECT COUNT(*) FROM attachments a WHERE a.message_id = m.id) AS attachment_count FROM messages m WHERE ${where} ORDER BY COALESCE(m.received_at, m.sent_at, m.created_at) DESC LIMIT ? OFFSET ?`;
  const rows = await c.env.DB.prepare(query).bind(...params, limit, offset).all<MessageRow>();
  const count = await c.env.DB.prepare(`SELECT COUNT(*) AS count FROM messages m WHERE ${where}`).bind(...params).first<{ count: number }>();
  const unread = await c.env.DB.prepare("SELECT COUNT(*) AS count FROM messages WHERE direction = 'inbound' AND archived = 0 AND trashed = 0 AND read_at IS NULL").first<{ count: number }>();
  return c.json({ ok: true, messages: rows.results.map(messageResponse), total: count?.count ?? 0, unread: unread?.count ?? 0 });
});

app.get('/api/messages/:id', requireSession, async (c) => {
  const id = c.req.param('id');
  const row = await c.env.DB.prepare('SELECT m.*, (SELECT COUNT(*) FROM attachments a WHERE a.message_id = m.id) AS attachment_count FROM messages m WHERE m.id = ?').bind(id).first<MessageRow>();
  if (!row) return c.json({ ok: false, error: 'Message not found' }, 404);
  await c.env.DB.prepare('UPDATE messages SET read_at = COALESCE(read_at, CURRENT_TIMESTAMP) WHERE id = ?').bind(id).run();
  const attachments = await c.env.DB.prepare('SELECT id, filename, content_type, size FROM attachments WHERE message_id = ?').bind(id).all<AttachmentRow>();
  const thread = await c.env.DB.prepare('SELECT m.*, (SELECT COUNT(*) FROM attachments a WHERE a.message_id = m.id) AS attachment_count FROM messages m WHERE thread_id = ? ORDER BY created_at ASC').bind(row.thread_id).all<MessageRow>();
  return c.json({ ok: true, message: { ...messageResponse(row), attachments: attachments.results.map((item) => ({ ...item, url: `/api/attachments/${item.id}` })) }, thread: thread.results.map(messageResponse) });
});

app.patch('/api/messages/:id', requireSession, zValidator('json', z.object({ read: z.boolean().optional(), starred: z.boolean().optional(), archived: z.boolean().optional(), trashed: z.boolean().optional() })), async (c) => {
  const input = c.req.valid('json');
  const id = c.req.param('id');
  const current = await c.env.DB.prepare('SELECT id, read_at, starred, archived, trashed FROM messages WHERE id = ?').bind(id).first<{ id: string; read_at: string | null; starred: number; archived: number; trashed: number }>();
  if (!current) return c.json({ ok: false, error: 'Message not found' }, 404);
  const readAt = input.read === false ? null : input.read === true ? new Date().toISOString() : current.read_at;
  await c.env.DB.prepare('UPDATE messages SET read_at = ?, starred = ?, archived = ?, trashed = ? WHERE id = ?').bind(readAt, input.starred === undefined ? current.starred : Number(input.starred), input.archived === undefined ? current.archived : Number(input.archived), input.trashed === undefined ? current.trashed : Number(input.trashed), id).run();
  return c.json({ ok: true });
});

app.delete('/api/messages/:id', requireSession, async (c) => {
  await c.env.DB.prepare('UPDATE messages SET trashed = 1 WHERE id = ?').bind(c.req.param('id')).run();
  return c.json({ ok: true });
});

const sendSchema = z.object({ fromAliasId: z.string().min(1).max(100), to: z.array(z.string().email()).min(1).max(50), cc: z.array(z.string().email()).max(50).optional(), subject: z.string().max(500).default('(no subject)'), text: z.string().max(100000), replyToMessageId: z.string().min(1).max(100).optional() });

const MAX_SEND_ATTACHMENTS = 5;
const MAX_SEND_FILE_BYTES = 10 * 1024 * 1024;
const MAX_SEND_TOTAL_BYTES = 20 * 1024 * 1024;

app.post('/api/messages/send', requireSession, async (c) => {
  const ip = c.req.header('CF-Connecting-IP') ?? 'unknown';
  if (!(await checkRateLimit(c.env.RATE_LIMIT, `send:${ip}`, 30, 3600))) return c.json({ ok: false, error: 'Sending limit reached. Try again later.' }, 429);
  const contentType = c.req.header('content-type') ?? '';
  let input: z.infer<typeof sendSchema>;
  let uploadFiles: File[] = [];
  try {
    if (contentType.includes('multipart/form-data')) {
      const form = await c.req.parseBody();
      const pickText = (value: unknown): string => (typeof value === 'string' ? value : '');
      const toRaw = pickText(form['to']);
      const ccRaw = pickText(form['cc']);
      const parsed = sendSchema.parse({
        fromAliasId: pickText(form['fromAliasId']),
        to: toRaw.split(',').map((value) => value.trim()).filter(Boolean),
        cc: ccRaw ? ccRaw.split(',').map((value) => value.trim()).filter(Boolean) : undefined,
        subject: pickText(form['subject']),
        text: pickText(form['text']),
        replyToMessageId: pickText(form['replyToMessageId']) || undefined,
      });
      input = parsed;
      const rawUploads = form['attachments'];
      if (rawUploads) uploadFiles = (Array.isArray(rawUploads) ? rawUploads : [rawUploads]).filter((item): item is File => item instanceof File && item.size > 0);
    } else {
      input = sendSchema.parse(await c.req.json());
    }
  } catch {
    return c.json({ ok: false, error: 'Invalid message. Check recipients and try again.' }, 400);
  }
  if (uploadFiles.length > MAX_SEND_ATTACHMENTS) return c.json({ ok: false, error: `Attach up to ${MAX_SEND_ATTACHMENTS} files` }, 400);
  const validatedUploads: Array<{ filename: string; contentType: string; bytes: ArrayBuffer; size: number }> = [];
  let totalBytes = 0;
  for (const file of uploadFiles) {
    const filename = sanitizeAttachmentName((file as File & { name?: string }).name || 'attachment');
    const size = file.size;
    if (size <= 0) return c.json({ ok: false, error: `“${filename}” is empty` }, 400);
    if (size > MAX_SEND_FILE_BYTES) return c.json({ ok: false, error: `“${filename}” exceeds the 10 MB per-file limit` }, 400);
    totalBytes += size;
    if (totalBytes > MAX_SEND_TOTAL_BYTES) return c.json({ ok: false, error: 'Attachments exceed the 20 MB total limit' }, 400);
    const bytes = await file.arrayBuffer();
    validatedUploads.push({ filename, contentType: file.type || 'application/octet-stream', bytes, size: bytes.byteLength });
  }
  const alias = await c.env.DB.prepare('SELECT id, local_part, display_name, enabled, created_at FROM aliases WHERE id = ? AND enabled = 1').bind(input.fromAliasId).first<AliasRow>();
  if (!alias) return c.json({ ok: false, error: 'Choose an enabled sender alias' }, 400);
  const from = `${alias.local_part}@${c.env.MAIL_DOMAIN}`;
  const reply = input.replyToMessageId ? await c.env.DB.prepare('SELECT thread_id, message_id FROM messages WHERE id = ?').bind(input.replyToMessageId).first<{ thread_id: string; message_id: string | null }>() : null;
  const threadId = reply?.thread_id ?? crypto.randomUUID();
  const messageId = `<${crypto.randomUUID()}@${c.env.MAIL_DOMAIN}>`;
  const subject = input.subject.trim() || '(no subject)';
  const html = `<div style="font-family:Arial,sans-serif;white-space:pre-wrap">${escapeHtml(input.text)}</div>`;
  try {
    const providerId = await sendWithBrevo(c.env, {
      from, fromName: alias.display_name ?? from, to: input.to, cc: input.cc, subject, text: input.text, html, replyTo: from,
      attachments: validatedUploads.map((item) => ({ filename: item.filename, contentType: item.contentType, size: item.size, base64: arrayBufferToBase64(item.bytes) })),
    });
    await c.env.DB.prepare('INSERT OR IGNORE INTO threads (id, subject) VALUES (?, ?)').bind(threadId, subject).run();
    const id = crypto.randomUUID();
    await c.env.DB.prepare('INSERT INTO messages (id, thread_id, direction, sender, recipients_json, cc_json, subject, text_body, html_body, message_id, in_reply_to, alias_id, status, sent_at, headers_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(id, threadId, 'outbound', from, JSON.stringify(input.to), JSON.stringify(input.cc ?? []), subject, input.text, html, messageId, reply?.message_id ?? null, alias.id, 'sent', new Date().toISOString(), JSON.stringify({ 'x-provider-id': providerId })).run();
    for (const item of validatedUploads) {
      const attachmentId = crypto.randomUUID();
      const objectKey = `messages/${id}/${attachmentId}-${item.filename}`;
      await c.env.ATTACHMENTS.put(objectKey, item.bytes, { httpMetadata: { contentType: item.contentType } });
      await c.env.DB.prepare('INSERT INTO attachments (id, message_id, filename, content_type, size, object_key) VALUES (?, ?, ?, ?, ?, ?)').bind(attachmentId, id, item.filename, item.contentType, item.size, objectKey).run();
    }
    return c.json({ ok: true, id, threadId, attachmentCount: validatedUploads.length });
  } catch (error) {
    return c.json({ ok: false, error: error instanceof Error ? error.message : 'Email could not be sent' }, 502);
  }
});

app.get('/api/attachments/:id', requireSession, async (c) => {
  const attachment = await c.env.DB.prepare('SELECT filename, content_type, object_key FROM attachments WHERE id = ?').bind(c.req.param('id')).first<{ filename: string; content_type: string; object_key: string }>();
  if (!attachment) return c.json({ ok: false, error: 'Attachment not found' }, 404);
  const object = await c.env.ATTACHMENTS.get(attachment.object_key);
  if (!object) return c.json({ ok: false, error: 'Attachment unavailable' }, 404);
  c.header('Content-Type', attachment.content_type);
  c.header('Content-Disposition', `attachment; filename="${attachment.filename.replace(/"/g, '')}"`);
  return new Response(object.body);
});

export default {
  fetch: app.fetch,
  async email(message: ForwardableEmailMessage, env: MailEnv): Promise<void> {
    const localPart = message.to.toLowerCase().split('@')[0].split('+')[0];
    const alias = await env.DB.prepare('SELECT id, local_part, display_name, enabled, created_at FROM aliases WHERE local_part = ? AND enabled = 1').bind(localPart).first<AliasRow>();
    if (!alias) {
      message.setReject('This address is not configured');
      return;
    }
    try {
      const parsed = await parseInbound(message.raw);
      const referenceIds = [...parsed.references, parsed.inReplyTo].filter(Boolean) as string[];
      let thread = referenceIds.length ? await env.DB.prepare(`SELECT thread_id FROM messages WHERE message_id IN (${referenceIds.map(() => '?').join(',')}) ORDER BY created_at DESC LIMIT 1`).bind(...referenceIds).first<{ thread_id: string }>() : null;
      const threadId = thread?.thread_id ?? crypto.randomUUID();
      await env.DB.prepare('INSERT OR IGNORE INTO threads (id, subject) VALUES (?, ?)').bind(threadId, parsed.subject).run();
      const id = crypto.randomUUID();
      await env.DB.prepare('INSERT INTO messages (id, thread_id, direction, sender, recipients_json, cc_json, subject, text_body, html_body, headers_json, message_id, in_reply_to, alias_id, status, received_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(id, threadId, 'inbound', parsed.from || message.from, JSON.stringify([parsed.to || message.to]), '[]', parsed.subject, parsed.text, parsed.html, JSON.stringify(parsed.headers), parsed.messageId, parsed.inReplyTo, alias.id, 'received', new Date().toISOString()).run();
      for (const attachment of parsed.attachments) {
        const attachmentId = crypto.randomUUID();
        const objectKey = `messages/${id}/${attachmentId}-${attachment.filename}`;
        await env.ATTACHMENTS.put(objectKey, attachment.content, { httpMetadata: { contentType: attachment.mimeType } });
        await env.DB.prepare('INSERT INTO attachments (id, message_id, filename, content_type, size, object_key) VALUES (?, ?, ?, ?, ?, ?)').bind(attachmentId, id, attachment.filename, attachment.mimeType, attachment.size, objectKey).run();
      }
    } catch (error) {
      console.error(JSON.stringify({ event: 'inbound_email_failed', error: String(error), to: message.to }));
      message.setReject('Email processing failed');
    }
  },
} satisfies ExportedHandler<MailEnv>;

interface AliasRow { id: string; local_part: string; display_name: string | null; enabled: number; created_at: string }
interface AttachmentRow { id: string; filename: string; content_type: string; size: number }
interface MessageRow { id: string; thread_id: string; direction: 'inbound' | 'outbound'; sender: string; recipients_json: string; cc_json: string; subject: string; text_body: string; html_body: string | null; message_id: string | null; in_reply_to: string | null; alias_id: string | null; status: 'received' | 'queued' | 'sent' | 'failed'; read_at: string | null; starred: number; archived: number; trashed: number; received_at: string | null; sent_at: string | null; created_at: string; attachment_count: number }

function aliasResponse(row: AliasRow, domain: string) {
  return { id: row.id, localPart: row.local_part, address: `${row.local_part}@${domain}`, displayName: row.display_name, enabled: Boolean(row.enabled), createdAt: row.created_at };
}

function messageResponse(row: MessageRow) {
  return { id: row.id, threadId: row.thread_id, direction: row.direction, from: row.sender, to: parseJson<string[]>(row.recipients_json, []), cc: parseJson<string[]>(row.cc_json, []), subject: row.subject, textBody: row.text_body, htmlBody: row.html_body, messageId: row.message_id, sentAt: row.sent_at, receivedAt: row.received_at, readAt: row.read_at, starred: Boolean(row.starred), archived: Boolean(row.archived), trashed: Boolean(row.trashed), status: row.status, alias: row.alias_id, attachmentCount: row.attachment_count ?? 0 };
}

function parseJson<T>(value: string, fallback: T): T {
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

function sanitizeAttachmentName(raw: string): string {
  const base = raw.split(/[\\/]/).pop()?.trim() || 'attachment';
  const cleaned = base.replace(/[\0-\x1f\x7f]+/g, '').replace(/["<>|:?*]+/g, '_').slice(0, 180);
  return cleaned || 'attachment';
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
}
