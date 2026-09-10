import PostalMime from 'postal-mime';
import type { MailEnv } from './auth';

export interface ParsedInbound {
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string | null;
  messageId: string | null;
  inReplyTo: string | null;
  references: string[];
  headers: Record<string, string>;
  attachments: Array<{ filename: string; mimeType: string; content: ArrayBuffer; size: number }>;
}

export async function parseInbound(raw: ReadableStream): Promise<ParsedInbound> {
  const parsed = await PostalMime.parse(raw);
  const headers: Record<string, string> = {};
  for (const header of parsed.headers ?? []) headers[header.key.toLowerCase()] = header.value;
  return {
    from: parsed.from?.address ?? '',
    to: parsed.to?.[0]?.address ?? '',
    subject: cleanSubject(parsed.subject),
    text: parsed.text ?? '',
    html: parsed.html ?? null,
    messageId: parsed.messageId ?? headers['message-id'] ?? null,
    inReplyTo: parsed.inReplyTo ?? headers['in-reply-to'] ?? null,
    references: splitReferences(parsed.references ?? headers.references ?? ''),
    headers,
    attachments: (parsed.attachments ?? []).map((attachment) => ({
      filename: attachment.filename || 'attachment',
      mimeType: attachment.mimeType || 'application/octet-stream',
      content: toArrayBuffer(attachment.content),
      size: toArrayBuffer(attachment.content).byteLength,
    })),
  };
}

export async function sendWithBrevo(env: MailEnv, input: {
  from: string;
  fromName?: string;
  to: string[];
  cc?: string[];
  subject: string;
  text: string;
  html: string;
  replyTo?: string;
}): Promise<string> {
  if (!env.BREVO_API_KEY) throw new Error('Brevo is not configured');
  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'api-key': env.BREVO_API_KEY },
    body: JSON.stringify({
      sender: { email: input.from, name: input.fromName ?? input.from },
      to: input.to.map((email) => ({ email })),
      cc: input.cc?.map((email) => ({ email })),
      subject: input.subject,
      textContent: input.text,
      htmlContent: input.html,
      replyTo: input.replyTo ? { email: input.replyTo } : undefined,
    }),
  });
  if (!response.ok) {
    const error = await response.text().catch(() => 'provider error');
    throw new Error(`Brevo send failed (${response.status}): ${error.slice(0, 300)}`);
  }
  const body = await response.json() as { messageId?: string };
  return body.messageId ?? crypto.randomUUID();
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character);
}

function cleanSubject(subject: string | undefined): string {
  const value = (subject ?? '').replace(/[\r\n]/g, ' ').trim();
  return value.slice(0, 500) || '(no subject)';
}

function splitReferences(value: string): string[] {
  return value.match(/<[^>]+>/g) ?? [];
}

function toArrayBuffer(value: string | ArrayBuffer | Uint8Array): ArrayBuffer {
  if (typeof value === 'string') return new TextEncoder().encode(value).buffer;
  if (value instanceof ArrayBuffer) return value;
  return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer;
}
