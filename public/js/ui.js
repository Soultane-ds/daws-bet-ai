export const state = { token: null, user: null, features: null, config: null, unread: 0 };
try { state.token = localStorage.getItem('dbai_token'); } catch {}
export const setToken = (t) => { state.token = t; try { t ? localStorage.setItem('dbai_token', t) : localStorage.removeItem('dbai_token'); } catch {} };

export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export async function api(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch('/api' + path, { method, headers: { 'Content-Type': 'application/json', ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  } catch { throw Object.assign(new Error('You appear to be offline. Check your connection and try again.'), { offline: true }); }
  let data = {};
  try { data = await res.json(); } catch {}
  if (!res.ok) {
    if (res.status === 401 && state.token) { setToken(null); state.user = null; }
    throw Object.assign(new Error(data.error || 'Something went wrong. Please try again.'), { status: res.status, data });
  }
  return data;
}

let toastT;
export function toast(msg) {
  const el = $('#toast'); el.textContent = msg; el.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('show'), 2600);
}

/* ---- dates ---- */
export const tzOffset = () => new Date().getTimezoneOffset();
export const localDate = (offsetDays = 0) => { const d = new Date(); d.setDate(d.getDate() + offsetDays); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
export const fmtTime = (iso) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
export const fmtDay = (iso) => new Date(iso).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
export const fmtDateTime = (iso) => `${fmtDay(iso)}, ${fmtTime(iso)}`;
export const dayChip = (off) => { const d = new Date(); d.setDate(d.getDate() + off); return off === 0 ? 'Today' : off === 1 ? 'Tomorrow' : off === -1 ? 'Yesterday' : d.toLocaleDateString([], { weekday: 'short', day: 'numeric' }); };

/* ---- icons ---- */
const I = {
  home: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v9.5h13V10"/><path d="M10 19.5v-5h4v5"/>',
  matches: '<circle cx="12" cy="12" r="9"/><path d="m12 8 3.2 2.3-1.2 3.7h-4l-1.2-3.7Z"/><path d="M12 3v5M20.6 9.5 15.2 10.3M17.4 19l-3.4-5M6.6 19l3.4-5M3.4 9.5l5.4.8"/>',
  picks: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4"/><path d="m6.3 6.3 2.4 2.4M15.3 15.3l2.4 2.4M17.7 6.3l-2.4 2.4M8.7 15.3l-2.4 2.4"/><circle cx="12" cy="12" r="2.2"/>',
  machine: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 9h8M8 13h3M14 13h2M8 16.5h8"/>',
  star: '<path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 16.9l-5.2 2.8 1-5.9-4.3-4.1 5.9-.8Z"/>',
  user: '<circle cx="12" cy="8.5" r="3.7"/><path d="M4.5 20c.6-3.7 3.7-5.6 7.5-5.6s6.9 1.9 7.5 5.6"/>',
  bell: '<path d="M6 17V11a6 6 0 1 1 12 0v6l1.5 2h-15Z"/><path d="M10 21h4"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
};
export const icon = (n) => `<svg viewBox="0 0 24 24" aria-hidden="true">${I[n]}</svg>`;

/* ---- components ---- */
export function crest(t, size) {
  const s = size ? ` style="width:${size}px;height:${size}px"` : '';
  return t.logo ? `<span class="crest"${s}><img src="${esc(t.logo)}" alt="" loading="lazy" onerror="this.parentNode.textContent='${esc((t.name || '?')[0])}'"></span>` : `<span class="crest"${s}>${esc((t.name || '?')[0])}</span>`;
}
export function ring(conf, level, size = 46) {
  const c = 2 * Math.PI * 18, off = c * (1 - Math.min(conf, 100) / 100);
  return `<svg class="ring lv-${level}" width="${size}" height="${size}" viewBox="0 0 44 44" role="img" aria-label="Confidence ${Math.round(conf)} out of 100"><circle class="rt" cx="22" cy="22" r="18"/><circle class="rv" cx="22" cy="22" r="18" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}" transform="rotate(-90 22 22)"/><text x="22" y="26.5" text-anchor="middle">${Math.round(conf)}</text></svg>`;
}
export const badge = (p) => `<span class="badge lv-${p.level}">${esc(p.levelText)}</span>`;
export const lockChip = (txt = 'Unlock') => `<span class="lockchip">${icon('lock')}${esc(txt)}</span>`;
export const odd = (x) => (x == null ? '–' : Number(x).toFixed(2));
export const pct = (x) => `${Math.round(x * 10) / 10}%`;
export const needs = (p) => (p.lockReason === 'limit' ? 'Free limit reached' : `${(p.requiredTier || 'vip').toUpperCase()} only`);

export function pickStrip(p) {
  if (!p) return '';
  if (p.locked) return `<div class="pickstrip lv-${p.level}">${ring(p.confidence, p.level, 40)}<div class="grow"><div class="t">${lockChip(needs(p))}</div><div class="muted tiny">${esc(p.levelText)} confidence pick</div></div></div>`;
  return `<div class="pickstrip lv-${p.level}">${ring(p.confidence, p.level, 40)}<div class="grow"><div class="t ellip">${esc(p.text)}</div><div class="muted tiny">${pct(p.probability)} chance · ${esc(p.risk)} risk${p.unpriced ? '' : ''}</div></div><div class="right num">${p.priced ? `<b>${odd(p.marketOdds)}</b>` : '<span class="muted tiny">no odds yet</span>'}${p.value ? '<div class="tag value">VALUE</div>' : ''}</div></div>`;
}

export function matchCard(m) {
  const live = m.status === 'live', fin = m.status === 'finished';
  let mid;
  if ((live || fin) && m.score) mid = `<div class="score">${m.score.home}<i>:</i>${m.score.away}</div><div class="state">${live ? `<span class="live"><b></b>${m.minute ? m.minute + "'" : 'LIVE'}</span>` : 'FT'}</div>`;
  else if (m.status === 'postponed') mid = '<div class="ko">v</div><div class="state" style="color:var(--amber)">POSTPONED</div>';
  else if (m.status === 'cancelled') mid = '<div class="ko">v</div><div class="state" style="color:var(--red)">CANCELLED</div>';
  else if (m.status === 'suspended') mid = '<div class="ko">v</div><div class="state" style="color:var(--amber)">SUSPENDED</div>';
  else mid = `<div class="ko">${fmtTime(m.kickoff)}</div><div class="state">${fmtDay(m.kickoff)}</div>`;
  const o = m.odds;
  const odds = o && (live || m.status === 'scheduled') ? `<div class="odds"><div class="od"><small>1</small><b>${odd(o['1'])}</b></div><div class="od"><small>X</small><b>${odd(o.X)}</b></div><div class="od"><small>2</small><b>${odd(o['2'])}</b></div></div>` : '';
  return `<a class="mcard" href="#/match/${m.id}" data-id="${m.id}">
    <div class="mhead"><div class="grow">${m.competition.logo ? `<img src="${esc(m.competition.logo)}" alt="" loading="lazy">` : ''}<span class="ellip">${esc(m.competition.name)}${m.competition.country ? ' · ' + esc(m.competition.country) : ''}</span></div>
      <button class="fav ${m.favorite ? 'on' : ''}" data-fav="${m.id}" aria-label="${m.favorite ? 'Remove from' : 'Add to'} favourites" aria-pressed="${!!m.favorite}">${icon('star')}</button></div>
    <div class="mbody"><div class="team">${crest(m.home)}<span>${esc(m.home.name)}</span></div><div class="mid">${mid}</div><div class="team">${crest(m.away)}<span>${esc(m.away.name)}</span></div></div>
    ${odds}${m.status === 'scheduled' || live ? pickStrip(m.pick) : ''}</a>`;
}

export function pickRow(p) {
  if (p.locked) return `<a class="prow locked lv-${p.level}" href="#/match/${p.matchId}">${ring(p.confidence, p.level)}<div class="grow"><div class="t">Locked selection</div><div class="muted small">${lockChip(needs(p))}</div></div>${badge(p)}</a>`;
  return `<a class="prow lv-${p.level}" href="#/match/${p.matchId}">${ring(p.confidence, p.level)}<div class="grow"><div class="muted tiny ellip">${esc(p.matchLabel)} · ${fmtTime(p.kickoff)}</div><div class="t ellip">${esc(p.text)}</div><div class="row small muted" style="margin-top:3px">${badge(p)}<span>${pct(p.probability)} · ${esc(p.risk)} risk</span>${p.value ? '<span class="tag value">VALUE</span>' : ''}</div></div><div class="o"><b>${odd(p.marketOdds)}</b><span class="muted tiny">${p.priced ? esc(p.bookmaker || '') : 'fair ' + odd(p.modelOdds)}</span></div></a>`;
}

export const skeleton = (n = 3, kind = 'card') => Array.from({ length: n }, () => `<div class="sk ${kind}"></div>`).join('');
export const empty = (title, body, action = '') => `<div class="empty"><h3>${esc(title)}</h3><p>${esc(body)}</p>${action}</div>`;
export function warnBox(d) {
  if (!d.warnings?.length) return '';
  const unconfigured = d.warnings.some((w) => /not configured|API_FOOTBALL_KEY|No football data provider/i.test(w));
  return `<div class="notice" style="margin-bottom:14px"><b>${unconfigured ? 'Football data is not connected yet' : 'Some live data is unavailable'}</b><div class="small" style="margin-top:4px">${unconfigured ? 'The owner needs to add a football data API key on the server. Nothing is shown until real data is available.' : esc(d.warnings[0]) + ' Showing the latest saved data.'}</div></div>`;
}
export const levelsLegend = () => {
  const t = state.config.thresholds;
  return `<div class="small muted">Confidence: <span class="lv-very_high" style="color:var(--lv)">VERY HIGH ${t.very_high}+</span> · <span class="lv-high" style="color:var(--lv)">HIGH ${t.high}–${t.very_high - 1}</span> · <span class="lv-good" style="color:var(--lv)">GOOD ${t.good}–${t.high - 1}</span> · <span class="lv-medium" style="color:var(--lv)">MEDIUM ${t.medium}–${t.good - 1}</span> · <span class="lv-risky" style="color:var(--lv)">RISKY &lt;${t.medium}</span></div>`;
};
export const tierPill = (t) => `<span class="pill ${t}">${t.toUpperCase()}</span>`;
export function debounce(fn, ms = 300) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
