import { bus } from './bus';

// Discord-artiges Mini-Markdown: ```code```, `code`, **fett**, *kursiv*, ~~durch~~, ||spoiler||, Links, @Erwähnungen
const INLINE = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\*[^*\n]+\*)|(~~[^~\n]+~~)|(\|\|[^|\n]+\|\|)|(https?:\/\/[^\s<]+)|(@[\wäöüÄÖÜß.\-]+)|(hyco:\/\/invite\/[A-Za-z0-9]{6,16})/g;

function inline(text, k, ctx) {
  const out = [];
  let last = 0;
  let m;
  INLINE.lastIndex = 0;
  while ((m = INLINE.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    const key = `${k}-${m.index}`;
    if (m[1]) out.push(<code key={key}>{t.slice(1, -1)}</code>);
    else if (m[2]) out.push(<b key={key}>{t.slice(2, -2)}</b>);
    else if (m[3]) out.push(<i key={key}>{t.slice(1, -1)}</i>);
    else if (m[4]) out.push(<s key={key}>{t.slice(2, -2)}</s>);
    else if (m[5]) out.push(<span key={key} className="spoiler" onClick={(e) => e.currentTarget.classList.add('shown')}>{t.slice(2, -2)}</span>);
    else if (m[6]) out.push(<a key={key} href={t} target="_blank" rel="noreferrer">{t}</a>);
    else if (m[8]) out.push(<button key={key} className="invite-link" onClick={() => bus.emit('join-invite', t)}>📨 Server-Einladung annehmen</button>);
    else {
      const name = t.slice(1).toLowerCase();
      if (name === 'everyone' || ctx.names.has(name)) out.push(<span key={key} className="mention">{t}</span>);
      else out.push(t);
    }
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function renderContent(text, ctx) {
  return text.split(/```([\s\S]*?)```/g).map((p, i) => (i % 2 ? <pre key={i}>{p.replace(/^\n|\n$/g, '')}</pre> : inline(p, i, ctx)));
}

export const mentionsUser = (text, username) =>
  new RegExp(`@(everyone|${username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})(?![\\w])`, 'i').test(text || '');

export const isImage = (url) => /\.(png|jpe?g|gif|webp|avif)(\?|$)/i.test(url || '');
