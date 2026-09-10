export type Mailbox = 'inbox' | 'sent' | 'starred' | 'archive' | 'trash';

export interface MailMessage {
  id: string;
  threadId: string;
  direction: 'inbound' | 'outbound';
  from: string;
  to: string[];
  cc: string[];
  subject: string;
  textBody: string;
  htmlBody: string | null;
  messageId: string | null;
  sentAt: string | null;
  receivedAt: string | null;
  readAt: string | null;
  starred: boolean;
  archived: boolean;
  trashed: boolean;
  status: 'received' | 'queued' | 'sent' | 'failed';
  alias: string | null;
  attachmentCount: number;
}

export interface MailAlias {
  id: string;
  localPart: string;
  address: string;
  displayName: string | null;
  enabled: boolean;
  createdAt: string;
}

export interface SessionUser {
  email: string;
  name: string;
}

export interface MessageListResponse {
  messages: MailMessage[];
  total: number;
  unread: number;
}
