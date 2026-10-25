import type { MailAlias, MailMessage, Mailbox, MessageListResponse, SessionUser } from '@slyxup/mail-shared';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8787';

export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const isForm = typeof FormData !== 'undefined' && init?.body instanceof FormData;
  const response = await fetch(`${API_URL}${path}`, { credentials: 'include', ...init, headers: { ...(isForm ? {} : { 'Content-Type': 'application/json' }), ...(init?.headers ?? {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError((body as { error?: string }).error || `Request failed (${response.status})`, response.status);
  return body as T;
}

export const api = {
  session: () => request<{ ok: true; user: SessionUser }>('/api/auth/session'),
  login: (email: string, password: string) => request<{ ok: true; user: SessionUser }>('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  logout: () => request<{ ok: true }>('/api/auth/logout', { method: 'POST' }),
  messages: (mailbox: Mailbox, query = '') => request<{ ok: true } & MessageListResponse>(`/api/messages?mailbox=${mailbox}&q=${encodeURIComponent(query)}`),
  message: (id: string) => request<{ ok: true; message: MailMessage & { attachments?: Attachment[] }; thread: MailMessage[] }>(`/api/messages/${id}`),
  updateMessage: (id: string, input: { read?: boolean; starred?: boolean; archived?: boolean; trashed?: boolean }) => request<{ ok: true }>(`/api/messages/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
  aliases: () => request<{ ok: true; aliases: MailAlias[] }>('/api/aliases'),
  createAlias: (localPart: string, displayName: string) => request<{ ok: true; alias: MailAlias }>('/api/aliases', { method: 'POST', body: JSON.stringify({ localPart, displayName }) }),
  updateAlias: (id: string, input: { enabled?: boolean; displayName?: string | null }) => request<{ ok: true; alias: MailAlias }>(`/api/aliases/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
  deleteAlias: (id: string) => request<{ ok: true }>(`/api/aliases/${id}`, { method: 'DELETE' }),
  send: (input: { fromAliasId: string; to: string[]; cc?: string[]; subject: string; text: string; replyToMessageId?: string; files?: File[] }) => {
    if (input.files?.length) {
      const form = new FormData();
      form.append('fromAliasId', input.fromAliasId);
      form.append('to', input.to.join(', '));
      if (input.cc?.length) form.append('cc', input.cc.join(', '));
      form.append('subject', input.subject);
      form.append('text', input.text);
      if (input.replyToMessageId) form.append('replyToMessageId', input.replyToMessageId);
      for (const file of input.files) form.append('attachments', file, file.name);
      return request<{ ok: true; id: string; threadId: string; attachmentCount?: number }>('/api/messages/send', { method: 'POST', body: form });
    }
    const { files: _ignored, ...json } = input;
    return request<{ ok: true; id: string; threadId: string; attachmentCount?: number }>('/api/messages/send', { method: 'POST', body: JSON.stringify(json) });
  },
};

export interface Attachment { id: string; filename: string; content_type: string; size: number; url: string }
