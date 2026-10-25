import { useEffect, useMemo, useState } from 'react';
import DOMPurify from 'dompurify';
import type { MailAlias, MailMessage, Mailbox, SessionUser } from '@slyxup/mail-shared';
import { Archive, ArchiveRestore, ArrowLeft, ChevronDown, ChevronLeft, ChevronRight, FileText, Inbox, LogOut, Mail, Menu, MoreHorizontal, Paperclip, Pencil, Plus, RefreshCw, Search, Send, Settings2, ShieldCheck, Star, Trash2, X } from 'lucide-react';
import { api, ApiError } from './api';

const mailboxes: Array<{ id: Mailbox; label: string; icon: typeof Inbox }> = [
  { id: 'inbox', label: 'Inbox', icon: Inbox },
  { id: 'starred', label: 'Starred', icon: Star },
  { id: 'sent', label: 'Sent', icon: Send },
  { id: 'archive', label: 'Archive', icon: Archive },
  { id: 'trash', label: 'Trash', icon: Trash2 },
];

function FoxMark({ size = 36 }: { size?: number }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden="true" style={{ imageRendering: 'pixelated', display: 'block', flexShrink: 0 }}>
      <g fill="#DC2626">
        <rect x={8} y={8} width={6} height={6} /><rect x={50} y={8} width={6} height={6} />
        <rect x={8} y={14} width={6} height={6} /><rect x={14} y={14} width={6} height={6} /><rect x={44} y={14} width={6} height={6} /><rect x={50} y={14} width={6} height={6} />
        <rect x={8} y={20} width={6} height={6} /><rect x={14} y={20} width={6} height={6} /><rect x={20} y={20} width={6} height={6} /><rect x={26} y={20} width={6} height={6} /><rect x={32} y={20} width={6} height={6} /><rect x={38} y={20} width={6} height={6} /><rect x={44} y={20} width={6} height={6} /><rect x={50} y={20} width={6} height={6} />
        <rect x={8} y={26} width={6} height={6} /><rect x={14} y={26} width={6} height={6} /><rect x={26} y={26} width={6} height={6} /><rect x={32} y={26} width={6} height={6} /><rect x={44} y={26} width={6} height={6} /><rect x={50} y={26} width={6} height={6} />
        <rect x={8} y={32} width={6} height={6} /><rect x={14} y={32} width={6} height={6} /><rect x={20} y={32} width={6} height={6} /><rect x={38} y={32} width={6} height={6} /><rect x={44} y={32} width={6} height={6} /><rect x={50} y={32} width={6} height={6} />
        <rect x={14} y={38} width={6} height={6} /><rect x={20} y={38} width={6} height={6} /><rect x={38} y={38} width={6} height={6} /><rect x={44} y={38} width={6} height={6} />
        <rect x={20} y={44} width={6} height={6} /><rect x={26} y={44} width={6} height={6} /><rect x={32} y={44} width={6} height={6} /><rect x={38} y={44} width={6} height={6} />
      </g>
      <g fill="#7F1D1D">
        <rect x={20} y={26} width={6} height={6} /><rect x={38} y={26} width={6} height={6} /><rect x={26} y={38} width={6} height={6} /><rect x={32} y={38} width={6} height={6} />
      </g>
    </svg>
  );
}

export function App() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [checking, setChecking] = useState(true);
  useEffect(() => { api.session().then(({ user: current }) => setUser(current)).catch(() => setUser(null)).finally(() => setChecking(false)); }, []);
  if (checking) return <div className="loading-screen"><FoxMark size={36} /><span>Opening your mailbox</span></div>;
  return user ? <MailboxApp user={user} onLogout={async () => { await api.logout(); setUser(null); }} /> : <Login onLogin={setUser} />;
}

function Login({ onLogin }: { onLogin: (user: SessionUser) => void }) {
  const [email, setEmail] = useState('slyxup@gmail.com');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try { const result = await api.login(email, password); onLogin(result.user); } catch (err) { setError(err instanceof ApiError ? err.message : 'Could not sign in'); } finally { setBusy(false); }
  }
  return <main className="auth-shell"><section className="auth-card"><div className="brand-lockup"><FoxMark size={36} /><span>SMail</span></div><div className="eyebrow">PRIVATE WORKSPACE</div><h1>Your correspondence,<br /><em>kept close.</em></h1><p className="auth-copy">A quiet, focused home for mail arriving at your SlyxUp addresses.</p><form onSubmit={submit} className="auth-form"><label>Email address<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="username" required /></label><label>Password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required /></label>{error && <div className="error-banner">{error}</div>}<button className="primary-button" disabled={busy}>{busy ? 'Signing in…' : 'Open SMail'} <ArrowLeft size={17} className="rotate-180" /></button></form><div className="secure-note"><ShieldCheck size={15} /> Private to your SlyxUp account</div></section><aside className="auth-aside"><div className="aside-stamp">SMAIL / 01</div><div><p className="aside-quote">“The inbox is a room. Keep only what deserves a chair.”</p><span className="aside-caption">A personal mail desk for <b>slyxup.com</b></span></div><div className="aside-footer">INBOX / SENT / ALIASES</div></aside></main>;
}

function MailboxApp({ user, onLogout }: { user: SessionUser; onLogout: () => Promise<void> }) {
  const [mailbox, setMailbox] = useState<Mailbox>('inbox');
  const [messages, setMessages] = useState<MailMessage[]>([]);
  const [unread, setUnread] = useState(0);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState<MailMessage | null>(null);
  const [aliases, setAliases] = useState<MailAlias[]>([]);
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [toast, setToast] = useState('');
  const refresh = async () => { const result = await api.messages(mailbox, query); setMessages(result.messages); setTotal(result.total); setUnread(result.unread); };
  useEffect(() => { refresh().catch(() => setToast('Mailbox could not be loaded')); }, [mailbox, query]);
  useEffect(() => { api.aliases().then((result) => setAliases(result.aliases)).catch(() => setToast('Aliases could not be loaded')); }, []);
  async function openMessage(message: MailMessage) { setSelected(message); if (!message.readAt) { await api.updateMessage(message.id, { read: true }); setMessages((items) => items.map((item) => item.id === message.id ? { ...item, readAt: new Date().toISOString() } : item)); setUnread((value) => Math.max(0, value - 1)); } }
  async function updateMessage(id: string, update: Parameters<typeof api.updateMessage>[1]) { await api.updateMessage(id, update); setMessages((items) => items.map((item) => item.id === id ? { ...item, ...update, readAt: update.read ? new Date().toISOString() : item.readAt } : item)); if (selected?.id === id) setSelected(null); }
  const activeLabel = mailboxes.find((item) => item.id === mailbox)?.label ?? 'Inbox';
  return <div className="app-shell"><header className="topbar"><button className="icon-button mobile-only" aria-label="Open menu" onClick={() => setMobileNav(true)}><Menu size={20} /></button><div className="brand-lockup compact"><FoxMark size={31} /><span>SMail</span></div><div className={`search-box ${searchOpen ? 'is-open' : ''}`}><Search size={18} /><input placeholder="Search mail" value={query} onChange={(event) => setQuery(event.target.value)} onFocus={() => setSearchOpen(true)} /><button aria-label="Close search" className="search-close" onClick={() => { setQuery(''); setSearchOpen(false); }}><X size={16} /></button></div><div className="top-actions"><button className="icon-button" aria-label="Refresh" onClick={() => refresh()}><RefreshCw size={18} /></button><button className="avatar" aria-label="Account menu">{initials(user.name)}</button></div></header><div className={`workspace ${selected ? 'has-panel' : ''}`}><Sidebar active={mailbox} unread={unread} onSelect={(next) => { setMailbox(next); setSelected(null); setMobileNav(false); }} onCompose={() => { setComposeOpen(true); setMobileNav(false); }} onSettings={() => { setSettingsOpen(true); setMobileNav(false); }} user={user} onLogout={onLogout} mobileOpen={mobileNav} onClose={() => setMobileNav(false)} /><main className="mail-main"><div className="view-header"><div><div className="eyebrow">SlyxUp / {mailbox}</div><h2>{activeLabel}<span className="count">{total}</span></h2></div><div className="view-tools"><button className="icon-button" aria-label="Previous page"><ChevronLeft size={18} /></button><button className="icon-button" aria-label="Next page"><ChevronRight size={18} /></button><button className="icon-button" aria-label="More actions"><MoreHorizontal size={18} /></button></div></div>{messages.length ? <div className="message-list">{messages.map((message) => <MessageRow key={message.id} message={message} onOpen={() => openMessage(message)} onStar={() => updateMessage(message.id, { starred: !message.starred })} onArchive={() => updateMessage(message.id, { archived: true })} onDelete={() => updateMessage(message.id, { trashed: true })} />)}</div> : <EmptyState mailbox={mailbox} query={query} onCompose={() => setComposeOpen(true)} />}</main>{selected && <MessagePanel message={selected} onClose={() => setSelected(null)} onReply={() => setComposeOpen(true)} onStar={() => updateMessage(selected.id, { starred: !selected.starred })} onArchive={() => updateMessage(selected.id, { archived: true })} onDelete={() => updateMessage(selected.id, { trashed: true })} />}</div>{composeOpen && <Compose aliases={aliases} reply={selected} onClose={() => setComposeOpen(false)} onSent={() => { setComposeOpen(false); setMailbox('sent'); setToast('Message sent'); refresh(); }} />}{settingsOpen && <Settings aliases={aliases} setAliases={setAliases} onClose={() => setSettingsOpen(false)} />}{toast && <button className="toast" onClick={() => setToast('')}>{toast}</button>}</div>;
}

function Sidebar({ active, unread, onSelect, onCompose, onSettings, user, onLogout, mobileOpen, onClose }: { active: Mailbox; unread: number; onSelect: (mailbox: Mailbox) => void; onCompose: () => void; onSettings: () => void; user: SessionUser; onLogout: () => Promise<void>; mobileOpen: boolean; onClose: () => void }) {
  return <><div className={`nav-backdrop ${mobileOpen ? 'visible' : ''}`} onClick={onClose} /><aside className={`sidebar ${mobileOpen ? 'mobile-open' : ''}`}><div className="sidebar-top"><div className="sidebar-kicker">YOUR DESK <button className="icon-button mobile-only" onClick={onClose} aria-label="Close menu"><X size={18} /></button></div><button className="compose-button" onClick={onCompose}><Pencil size={17} /> Compose <span>⌘ N</span></button><nav>{mailboxes.map(({ id, label, icon: Icon }) => <button key={id} className={`nav-item ${active === id ? 'active' : ''}`} onClick={() => onSelect(id)}><Icon size={18} strokeWidth={active === id ? 2.4 : 1.8} /><span>{label}</span>{id === 'inbox' && unread > 0 && <b>{unread}</b>}</button>)}</nav></div><div className="sidebar-bottom"><button className="alias-card" onClick={onSettings}><div className="alias-icon">@</div><div><strong>Sender aliases</strong><small>Manage your addresses</small></div><ChevronRight size={16} /></button><div className="account-row"><div className="avatar small">{initials(user.name)}</div><div className="account-copy"><strong>{user.name}</strong><small>{user.email}</small></div><button className="icon-button" aria-label="Sign out" onClick={onLogout}><LogOut size={16} /></button></div></div></aside></>;
}

function MessageRow({ message, onOpen, onStar, onArchive, onDelete }: { message: MailMessage; onOpen: () => void; onStar: () => void; onArchive: () => void; onDelete: () => void }) {
  const person = message.direction === 'outbound' ? `To ${message.to[0] ?? 'recipient'}` : message.from;
  return <article className={`message-row ${message.readAt ? '' : 'unread'}`} onClick={onOpen}><button className={`row-star ${message.starred ? 'starred' : ''}`} aria-label={message.starred ? 'Unstar' : 'Star'} onClick={(event) => { event.stopPropagation(); onStar(); }}><Star size={16} fill={message.starred ? 'currentColor' : 'none'} /></button><div className="sender-avatar">{initials(person)}</div><div className="message-copy"><div className="sender-line"><strong>{person}</strong>{message.direction === 'outbound' && <span className="sent-label">SENT</span>}<time>{formatDate(message.receivedAt ?? message.sentAt)}</time></div><div className="subject-line"><strong>{message.subject}</strong><span> — {snippet(message.textBody)}</span></div></div>{message.attachmentCount > 0 && <Paperclip size={15} className="attachment-icon" />}<div className="row-actions"><button aria-label="Archive" onClick={(event) => { event.stopPropagation(); onArchive(); }}><Archive size={15} /></button><button aria-label="Delete" onClick={(event) => { event.stopPropagation(); onDelete(); }}><Trash2 size={15} /></button></div></article>;
}

function MessagePanel({ message, onClose, onReply, onStar, onArchive, onDelete }: { message: MailMessage; onClose: () => void; onReply: () => void; onStar: () => void; onArchive: () => void; onDelete: () => void }) {
  const sender = message.direction === 'outbound' ? message.to.join(', ') : message.from;
  return <aside className="message-panel"><div className="panel-toolbar"><button className="back-button" onClick={onClose}><ArrowLeft size={17} /> Back to {message.direction === 'outbound' ? 'sent' : 'inbox'}</button><div className="panel-actions"><button className="icon-button" onClick={onStar} aria-label="Star"><Star size={18} fill={message.starred ? 'currentColor' : 'none'} /></button><button className="icon-button" onClick={onArchive} aria-label="Archive"><Archive size={18} /></button><button className="icon-button" onClick={onDelete} aria-label="Delete"><Trash2 size={18} /></button></div></div><div className="message-detail"><div className="eyebrow">{message.direction === 'outbound' ? 'SENT MESSAGE' : 'RECEIVED MESSAGE'}</div><h1>{message.subject}</h1><div className="detail-meta"><div className="sender-avatar large">{initials(sender)}</div><div><strong>{sender}</strong><span>{message.direction === 'outbound' ? `to ${message.to.join(', ')}` : `to ${message.alias ?? 'SlyxUp'}`}</span></div><time>{formatLongDate(message.receivedAt ?? message.sentAt)}</time></div><div className="body-content">{message.htmlBody && message.direction === 'inbound' ? <div className="inbound-html" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(message.htmlBody, { FORBID_TAGS: ['style', 'script', 'iframe', 'object', 'embed', 'form'] }) }} /> : <p>{message.textBody}</p>}</div>{message.attachmentCount > 0 && <div className="attachment-strip"><FileText size={17} /><span>{message.attachmentCount} attachment{message.attachmentCount > 1 ? 's' : ''}</span></div>}<div className="detail-footer"><button className="secondary-button" onClick={onReply}><ArrowLeft size={16} className="reply-icon" /> Reply</button><button className="secondary-button" onClick={onReply}>Forward <ArrowLeft size={16} className="forward-icon" /></button></div></div></aside>;
}

const MAX_COMPOSE_FILES = 5;
const MAX_COMPOSE_FILE_BYTES = 10 * 1024 * 1024;
const MAX_COMPOSE_TOTAL_BYTES = 20 * 1024 * 1024;

function Compose({ aliases, reply, onClose, onSent }: { aliases: MailAlias[]; reply: MailMessage | null; onClose: () => void; onSent: () => void }) {
  const activeAliases = aliases.filter((alias) => alias.enabled); const [fromAliasId, setFromAliasId] = useState(activeAliases[0]?.id ?? ''); const [to, setTo] = useState(reply?.direction === 'inbound' ? reply.from : ''); const [subject, setSubject] = useState(reply ? (reply.subject.startsWith('Re:') ? reply.subject : `Re: ${reply.subject}`) : ''); const [text, setText] = useState(''); const [files, setFiles] = useState<File[]>([]); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  function addFiles(list: FileList | null) {
    if (!list) return; setError('');
    const next = [...files];
    for (const file of Array.from(list)) {
      if (next.length >= MAX_COMPOSE_FILES) { setError(`Attach up to ${MAX_COMPOSE_FILES} files`); break; }
      if (file.size <= 0) { setError(`“${file.name}” is empty`); continue; }
      if (file.size > MAX_COMPOSE_FILE_BYTES) { setError(`“${file.name}” exceeds the 10 MB per-file limit`); continue; }
      const total = next.reduce((sum, item) => sum + item.size, 0) + file.size;
      if (total > MAX_COMPOSE_TOTAL_BYTES) { setError('Attachments exceed the 20 MB total limit'); continue; }
      next.push(file);
    }
    setFiles(next);
  }
  function removeFile(index: number) { setFiles((items) => items.filter((_, i) => i !== index)); }
  async function submit(event: React.FormEvent) { event.preventDefault(); setBusy(true); setError(''); try { await api.send({ fromAliasId, to: to.split(',').map((value) => value.trim()).filter(Boolean), subject, text, replyToMessageId: reply?.id, files }); onSent(); } catch (err) { setError(err instanceof ApiError ? err.message : 'Message could not be sent'); } finally { setBusy(false); } }
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  return <div className="modal-backdrop"><form className="compose-window" onSubmit={submit}><header><div><span className="eyebrow">NEW MESSAGE</span><h2>Write something worth sending.</h2></div><button type="button" className="icon-button" onClick={onClose} aria-label="Close compose"><X size={19} /></button></header><div className="compose-fields"><label>From<select value={fromAliasId} onChange={(event) => setFromAliasId(event.target.value)}>{activeAliases.map((alias) => <option key={alias.id} value={alias.id}>{alias.displayName ? `${alias.displayName} · ` : ''}{alias.address}</option>)}</select></label><label>To<input value={to} onChange={(event) => setTo(event.target.value)} placeholder="recipient@example.com" required /></label><label>Subject<input value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="Subject" /></label><textarea value={text} onChange={(event) => setText(event.target.value)} placeholder="Write your message…" required rows={9} /><div className="compose-attachments"><label className="attach-button" htmlFor="compose-file-input"><Paperclip size={15} /> Attach files <span>{files.length}/{MAX_COMPOSE_FILES} · {formatBytes(totalBytes)} / 20 MB</span></label><input id="compose-file-input" type="file" multiple hidden onChange={(event) => { addFiles(event.target.files); event.target.value = ''; }} />{files.length > 0 && <ul className="attach-list">{files.map((file, index) => <li key={`${file.name}-${file.size}-${index}`}><FileText size={15} /><div><strong>{file.name}</strong><span>{formatBytes(file.size)}</span></div><button type="button" className="icon-button" aria-label={`Remove ${file.name}`} onClick={() => removeFile(index)}><X size={15} /></button></li>)}</ul>}</div></div>{error && <div className="error-banner compose-error">{error}</div>}<footer><button type="button" className="secondary-button" onClick={onClose}>Discard</button><button type="submit" className="primary-button send-button" disabled={busy || !fromAliasId}>{busy ? 'Sending…' : 'Send message'} <Send size={16} /></button></footer></form></div>;
}

function formatBytes(value: number) { if (!value) return '0 KB'; const kb = value / 1024; if (kb < 1024) return `${kb < 1 ? value + ' B' : Math.round(kb) + ' KB'}`; return `${(kb / 1024).toFixed(1)} MB`; }

function Settings({ aliases, setAliases, onClose }: { aliases: MailAlias[]; setAliases: (aliases: MailAlias[]) => void; onClose: () => void }) {
  const [localPart, setLocalPart] = useState(''); const [displayName, setDisplayName] = useState(''); const [error, setError] = useState('');
  async function add(event: React.FormEvent) { event.preventDefault(); try { const result = await api.createAlias(localPart, displayName); setAliases([...aliases, result.alias]); setLocalPart(''); setDisplayName(''); setError(''); } catch (err) { setError(err instanceof ApiError ? err.message : 'Could not create alias'); } }
  async function toggle(alias: MailAlias) { const result = await api.updateAlias(alias.id, { enabled: !alias.enabled }); setAliases(aliases.map((item) => item.id === alias.id ? result.alias : item)); }
  return <div className="modal-backdrop"><section className="settings-window"><header><div><span className="eyebrow">MAIL SETTINGS</span><h2>Sender aliases</h2><p>Every enabled address can receive mail and send through Brevo.</p></div><button className="icon-button" onClick={onClose} aria-label="Close settings"><X size={19} /></button></header><div className="alias-list">{aliases.map((alias) => <div className="alias-row" key={alias.id}><div className="alias-icon">@</div><div><strong>{alias.displayName || alias.localPart}</strong><span>{alias.address}</span></div><button className={`toggle ${alias.enabled ? 'on' : ''}`} onClick={() => toggle(alias)} aria-label={`${alias.enabled ? 'Disable' : 'Enable'} ${alias.address}`}><span /></button></div>)}</div><form className="new-alias" onSubmit={add}><div className="eyebrow">ADD AN ADDRESS</div><div className="alias-form-grid"><label>Local part<input value={localPart} onChange={(event) => setLocalPart(event.target.value)} placeholder="support" required pattern="[a-zA-Z0-9._-]+" /></label><label>Display name<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Support" /></label><button className="primary-button" type="submit"><Plus size={16} /> Add alias</button></div>{error && <div className="error-banner">{error}</div>}</form><footer><button className="secondary-button" onClick={onClose}>Close</button></footer></section></div>;
}

function EmptyState({ mailbox, query, onCompose }: { mailbox: Mailbox; query: string; onCompose: () => void }) { return <div className="empty-state"><div className="empty-art"><Mail size={28} /></div><h3>{query ? 'No messages match that search' : mailbox === 'inbox' ? 'Your inbox is clear' : `Nothing in ${mailbox}`}</h3><p>{query ? 'Try a sender, subject, or a shorter search.' : mailbox === 'inbox' ? 'New mail sent to an enabled SlyxUp alias will appear here.' : 'Messages will collect here as you use your mailbox.'}</p>{mailbox === 'inbox' && <button className="secondary-button" onClick={onCompose}><Pencil size={15} /> Write a message</button>}</div>; }

function initials(value: string) { return value.split(/[@ ._-]/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase(); }
function snippet(value: string) { return value.replace(/\s+/g, ' ').trim().slice(0, 110); }
function formatDate(value: string | null) { if (!value) return ''; const date = new Date(value); return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); }
function formatLongDate(value: string | null) { if (!value) return ''; return new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }); }
