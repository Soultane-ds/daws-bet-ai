import { state, setToken, $, $$, esc, api, toast, tzOffset, localDate, fmtTime, fmtDay, fmtDateTime, dayChip, icon, crest, ring, badge, lockChip, odd, pct, needs, pickStrip, matchCard, pickRow, skeleton, empty, warnBox, levelsLegend, tierPill, debounce } from './ui.js';

let renderId = 0;
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const NAV = [['#/', 'Home', 'home'], ['#/matches', 'Matches', 'matches'], ['#/picks', 'AI Picks', 'picks'], ['#/machine', 'Bet Machine', 'machine'], ['#/favorites', 'Favorites', 'star'], ['#/profile', 'Profile', 'user']];

/* ---------------- chrome ---------------- */
function chrome() {
  const name = state.config.appName;
  const brand = `<img src="/icon.svg" alt="" width="34" height="34"><span>${esc(name.replace(/ AI$/, ''))} <b>AI</b></span>`;
  $('#nav').innerHTML = `<div class="nav-brand">${brand}</div>` + NAV.map(([h, l, i]) => `<a href="${h}" data-nav="${h}" aria-label="${l}">${icon(i)}<span>${l}</span></a>`).join('');
  $('#top').innerHTML = `<a class="brand" href="#/">${brand}</a><a class="iconbtn" href="#/notifications" aria-label="Notifications">${icon('bell')}${state.unread ? '<i class="dot"></i>' : ''}</a>`;
  $('#foot').innerHTML = `<p><span class="age">18+</span>${esc(state.config.disclaimer)}</p><p>Odds shown are the best price found across bookmakers and can change. Predictions are model estimates and are never guaranteed.</p>`;
}
function setActive() {
  const h = location.hash || '#/';
  const key = h.startsWith('#/match/') || h.startsWith('#/matches') ? '#/matches' : h.startsWith('#/combos') ? '#/picks' : h.startsWith('#/notifications') || h.startsWith('#/history') || h.startsWith('#/login') || h.startsWith('#/admin') ? '#/profile' : '#/' + h.slice(2).split('/')[0].split('?')[0];
  $$('#nav a').forEach((a) => a.classList.toggle('on', a.dataset.nav === (key === '#/' ? '#/' : key)));
}
const setUser = (d) => { if (d.token) setToken(d.token); state.user = d.user; state.features = d.features; };
async function refreshMe() { const c = await api('/config'); state.config = c; state.features = c.features; state.user = c.user; state.unread = c.unread; chrome(); setActive(); }

/* ---------------- router ---------------- */
const routes = [
  [/^#\/?$/, homeView], [/^#\/matches/, matchesView], [/^#\/match\/(\d+)/, matchView], [/^#\/picks/, picksView], [/^#\/combos/, combosView],
  [/^#\/machine/, machineView], [/^#\/favorites/, favoritesView], [/^#\/profile/, profileView], [/^#\/login/, authView],
  [/^#\/notifications/, notificationsView], [/^#\/history/, historyView], [/^#\/admin/, adminView],
];
async function route() {
  const id = ++renderId, el = $('#app'), h = location.hash || '#/';
  setActive(); window.scrollTo(0, 0);
  const r = routes.find(([re]) => re.test(h));
  if (!r) { el.innerHTML = empty('Page not found', 'That page does not exist.', '<a class="btn primary" href="#/">Back to home</a>'); return; }
  const m = h.match(r[0]);
  try { await r[1](el, () => id === renderId, m); }
  catch (e) { if (id === renderId) el.innerHTML = errBox(e); }
}
const errBox = (e) => empty(e.offline ? 'You are offline' : 'Could not load this page', e.message, '<button class="btn" data-reload>Try again</button>');
const sec = (title, link, body) => `<section class="sec"><div class="row between"><h2>${title}</h2>${link || ''}</div>${body}</section>`;
const needLogin = (el, why) => { el.innerHTML = empty('Sign in to continue', why, '<a class="btn primary" href="#/login">Sign in or create account</a>'); };

/* ---------------- search ---------------- */
function searchBox() { return `<div class="search" id="sbox">${icon('search')}<input id="q" type="search" placeholder="Search teams or matches" autocomplete="off" aria-label="Search teams or matches"><div class="sresults" id="sres" hidden></div></div>`; }
function wireSearch() {
  const q = $('#q'), res = $('#sres');
  if (!q) return;
  const run = debounce(async () => {
    const v = q.value.trim();
    if (v.length < 2) { res.hidden = true; return; }
    try {
      const d = await api('/search?q=' + encodeURIComponent(v));
      res.innerHTML = (d.teams.map((t) => `<button data-team="${t.id}" data-name="${esc(t.name)}">${crest(t, 28)}<span class="grow">${esc(t.name)}</span><span class="muted tiny">${t.favorite ? '★ Following' : 'Follow'}</span></button>`).join('') +
        d.matches.map((m) => `<a href="#/match/${m.id}">${crest(m.home, 28)}<span class="grow small">${esc(m.home.name)} v ${esc(m.away.name)}<br><span class="muted tiny">${fmtDateTime(m.kickoff)}</span></span></a>`).join('')) || '<div class="empty small" style="padding:14px">No teams or matches found.</div>';
      res.hidden = false;
    } catch { res.hidden = true; }
  }, 280);
  q.addEventListener('input', run);
  q.addEventListener('keydown', (e) => { if (e.key === 'Enter' && q.value.trim()) location.hash = '#/matches?q=' + encodeURIComponent(q.value.trim()); });
}

/* ---------------- home ---------------- */
function comboCard(c) {
  if (c.locked) return `<div class="combo"><div class="row between"><h3>${esc(c.label)}</h3>${lockChip((c.requiredTier || 'vip').toUpperCase() + ' only')}</div><p class="muted small" style="margin:8px 0 0">${c.available ? `${c.available} qualifying selection${c.available > 1 ? 's' : ''} today.` : 'No qualifying selections yet.'} Upgrade to see the legs.</p></div>`;
  if (!c.count) return `<div class="combo"><h3>${esc(c.label)}</h3><p class="muted small" style="margin:8px 0 0">${esc(c.message || 'No selections meet the criteria yet. Check back once odds and analysis are published.')}</p></div>`;
  return `<div class="combo"><div class="row between"><h3>${esc(c.label)}</h3><span class="badge lv-${c.risk === 'Low' ? 'high' : c.risk === 'Moderate' ? 'good' : c.risk === 'Elevated' ? 'medium' : 'risky'}">${esc(c.risk.toUpperCase())} RISK</span></div>
    <div class="stat3"><div><small>Selections</small><b>${c.count}</b></div><div><small>Combined odds</small><b>${odd(c.combinedOdds)}</b></div><div><small>Avg confidence</small><b>${Math.round(c.avgConfidence)}</b></div></div>
    ${c.legs.map((l) => `<a class="leg lv-${l.level}" href="#/match/${l.matchId}">${ring(l.confidence, l.level, 38)}<div class="grow"><div class="t ellip">${esc(l.text)}</div><div class="muted tiny ellip">${esc(l.matchLabel)} · ${fmtTime(l.kickoff)}</div></div><b class="num">${odd(l.odds)}</b></a>`).join('')}
    <p class="muted tiny" style="margin:10px 0 0">Estimated chance all ${c.count} come in: ~${pct(c.estProbability)}. ${esc(c.note)}</p></div>`;
}
async function homeView(el, live) {
  el.innerHTML = `${searchBox()}<div style="margin-top:16px">${skeleton(3)}</div>`; wireSearch();
  const d = await api(`/home?date=${localDate()}&tz=${tzOffset()}`);
  if (!live()) return;
  const cards = (arr) => `<div class="cards">${arr.map(matchCard).join('')}</div>`;
  let h = searchBox() + `<div style="margin-top:14px">${warnBox(d)}${d.banners.map((b) => `<div class="banner"><b>${esc(b.title)}</b><span class="small muted">${esc(b.body || '')}</span></div>`).join('')}</div>`;
  if (d.live.length) h += sec('<span class="live"><b></b>Live now</span>', '<a class="link" href="#/matches?status=live">All live</a>', cards(d.live));
  if (d.picks.length) h += sec('AI predictions', '<a class="link" href="#/picks">See all</a>', d.picks.slice(0, 5).map(pickRow).join('') + levelsLegend());
  h += sec("Today's matches", '<a class="link" href="#/matches">All matches</a>', d.today.items.length ? cards(d.today.items) : empty('No matches listed for today', d.warnings ? 'Data is currently unavailable.' : 'Check tomorrow or browse other dates.'));
  if (d.highConfidence.some((p) => !p.locked || true) && d.highConfidence.length) h += sec('High confidence', '<a class="link" href="#/picks?type=high">More</a>', d.highConfidence.slice(0, 4).map(pickRow).join(''));
  h += sec('Value bets', '<a class="link" href="#/picks?type=value">More</a>', d.valueBets.locked ? `<div class="card">${lockChip('VIP and Premium')}<p class="muted small" style="margin:8px 0 0">${d.valueBets.count} selection${d.valueBets.count === 1 ? '' : 's'} currently priced above the model's fair odds.</p></div>` : d.valueBets.length ? d.valueBets.slice(0, 4).map(pickRow).join('') + '<p class="muted tiny">Value means the bookmaker price is higher than the model\'s estimate suggests. It does not mean the selection is likely to win.</p>' : '<p class="muted small">No value bets found right now.</p>');
  h += sec('Daily accumulators', '<a class="link" href="#/combos">Open</a>', d.combos.slice(0, 2).map(comboCard).join(''));
  h += `<a class="card row" href="#/machine" style="margin-top:22px;background:linear-gradient(120deg,var(--turf3),var(--turf))">${icon('machine').replace('<svg', '<svg width="34" height="34" style="stroke:var(--grass);fill:none;stroke-width:1.6"')}<div class="grow"><h3>AI Bet Machine</h3><div class="muted small">Set target odds, legs and minimum confidence. We build the closest accumulator from real prices.</div></div></a>`;
  if (d.top.length) h += sec('Top matches', '', cards(d.top));
  if (d.upcoming.length) h += sec('Upcoming', '<a class="link" href="#/matches">Browse</a>', cards(d.upcoming));
  if (d.competitions.length) h += sec('Popular competitions', '', `<div class="chips">${d.competitions.map((c) => `<a class="chip" href="#/matches?competition=${c.id}">${esc(c.name)}${c.matches ? ` <small>${c.matches}</small>` : ''}</a>`).join('')}</div>`);
  el.innerHTML = h; wireSearch();
}

/* ---------------- matches ---------------- */
async function matchesView(el, live) {
  const qs = new URLSearchParams((location.hash.split('?')[1]) || '');
  const f = { date: qs.get('date') || localDate(), status: qs.get('status') || '', competition: qs.get('competition') || '', q: qs.get('q') || '', page: 1 };
  const comps = (await api('/competitions?popular=1')).items;
  if (!live()) return;
  const draw = () => {
    const days = [-1, 0, 1, 2, 3, 4, 5].map((o) => ({ o, d: localDate(o) }));
    el.innerHTML = `<h1>Matches</h1><div class="stack" style="margin-top:12px"><input id="mq" type="search" placeholder="Search team or competition" value="${esc(f.q)}" aria-label="Search matches">
      <div class="chips" id="days">${days.map((x) => `<button class="chip ${!f.q && f.date === x.d ? 'on' : ''}" data-date="${x.d}">${dayChip(x.o)}</button>`).join('')}</div>
      <div class="chips" id="sts">${[['', 'All'], ['live', 'Live'], ['scheduled', 'Upcoming'], ['finished', 'Finished']].map(([v, l]) => `<button class="chip ${f.status === v ? 'on' : ''}" data-st="${v}">${l}</button>`).join('')}</div>
      <select id="cp" aria-label="Competition"><option value="">All competitions</option>${comps.map((c) => `<option value="${c.id}" ${String(c.id) === f.competition ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
      <div id="list" style="margin-top:14px"></div>`;
    $('#mq').addEventListener('input', debounce((e) => { f.q = e.target.value.trim(); f.page = 1; load(true); }, 350));
    $('#days').onclick = (e) => { const b = e.target.closest('[data-date]'); if (b) { f.date = b.dataset.date; f.q = ''; f.page = 1; draw(); } };
    $('#sts').onclick = (e) => { const b = e.target.closest('[data-st]'); if (b) { f.status = b.dataset.st; f.page = 1; draw(); } };
    $('#cp').onchange = (e) => { f.competition = e.target.value; f.page = 1; load(true); };
    load(true);
  };
  const load = async (reset) => {
    const box = $('#list'); if (!box) return;
    if (reset) box.innerHTML = skeleton(3);
    const p = new URLSearchParams({ tz: tzOffset(), page: f.page, pageSize: 20 });
    if (f.q) p.set('q', f.q); else p.set('date', f.date);
    if (f.status) p.set('status', f.status);
    if (f.competition) p.set('competition', f.competition);
    try {
      const d = await api('/matches?' + p);
      if (!live() || !$('#list')) return;
      const html = d.items.map(matchCard).join('');
      if (reset) box.innerHTML = (warnBox(d)) + (html ? `<div class="cards" id="grid">${html}</div>` : empty('No matches found', f.q ? 'Try a different team or competition name.' : 'Nothing scheduled for these filters. Try another day.'));
      else $('#grid').insertAdjacentHTML('beforeend', html);
      $('#more')?.remove();
      if (d.page < d.pages) box.insertAdjacentHTML('beforeend', `<button class="btn block" id="more">Load more (${d.total - d.page * 20} left)</button>`);
      $('#more')?.addEventListener('click', () => { f.page++; load(false); });
    } catch (e) { box.innerHTML = errBox(e); }
  };
  draw();
}

/* ---------------- match detail ---------------- */
const selLabel = (mk, s, l) => ({ '1X2': { 1: 'Home', X: 'Draw', 2: 'Away' }, HT_1X2: { 1: 'Home', X: 'Draw', 2: 'Away' }, DC: { '1X': 'Home / Draw', 12: 'Home / Away', X2: 'Draw / Away' }, BTTS: { yes: 'Yes', no: 'No' } }[mk]?.[s]) || (mk === 'AH' ? `${cap(s)} ${l > 0 ? '+' : ''}${l}` : /OU$/.test(mk) ? `${cap(s)} ${l}` : s);
function cmpRow(label, a, b, fmt = (x) => x) {
  const na = parseFloat(String(a).replace('%', '')) || 0, nb = parseFloat(String(b).replace('%', '')) || 0, mx = Math.max(na, nb, 0.0001);
  return `<div><div class="v right">${fmt(a ?? '–')}</div><div class="bar l"><i style="width:${(na / mx) * 100}%"></i></div></div><div class="lab">${esc(label)}</div><div><div class="v">${fmt(b ?? '–')}</div><div class="bar r"><i style="width:${(nb / mx) * 100}%"></i></div></div>`;
}
const formDots = (arr) => (arr.length ? `<div class="form">${arr.map((x) => `<span class="${x}">${x}</span>`).join('')}</div>` : '<span class="muted small">No recent matches</span>');
const candRow = (p) => p.locked ? `<div class="row" style="padding:10px 0;border-top:1px solid var(--line2)">${lockChip(needs(p))}<span class="grow"></span>${badge(p)}</div>` :
  `<div class="row" style="padding:10px 0;border-top:1px solid var(--line2)"><div class="grow"><div style="font-weight:700">${esc(p.text)}</div><div class="muted tiny">${pct(p.probability)} chance · fair odds ${odd(p.modelOdds)}</div></div>${p.value ? '<span class="tag value">VALUE</span>' : ''}${badge(p)}<b class="num" style="min-width:42px;text-align:right">${p.priced ? odd(p.marketOdds) : '–'}</b></div>`;

function tabAI(d) {
  const a = d.analysis, n = { home: d.match.home.name, away: d.match.away.name };
  if (a.status !== 'ok') return `<div class="notice">${esc(a.reason || 'No analysis is available for this match.')}${a.quality != null ? `<div class="small muted" style="margin-top:6px">Data coverage: ${Math.round(a.quality * 100)}% (needs more team statistics before the model will publish an estimate).</div>` : ''}</div><p class="muted small">We never fill gaps with made-up numbers. When team statistics, form or odds arrive, the estimate appears here automatically.</p>`;
  let h = '';
  const b = a.best;
  if (a.preMatch) h += `<div class="notice ok small" style="margin-bottom:12px">Pre-match estimate${a.bestResult && a.bestResult !== 'pending' ? ` · tracked pick result: <b>${esc(a.bestResult.toUpperCase())}</b>` : ''}.</div>`;
  if (b) {
    h += `<div class="card lv-${b.level}" style="border-color:color-mix(in srgb,var(--lv) 45%,transparent)"><div class="row between"><span class="tiny muted" style="font-weight:800;letter-spacing:.08em">${b.unpriced ? 'AI LEAN (NO ODDS YET)' : 'AI PICK'}</span>${badge(b)}</div>
      ${b.locked ? `<div class="row" style="margin-top:10px">${ring(b.confidence, b.level, 64)}<div class="grow"><div style="font-weight:800;font-size:1.1rem">${lockChip(needs(b))}</div><div class="muted small">${esc(b.levelText)} confidence pick. Upgrade to see the selection.</div></div></div><a class="btn primary block" style="margin-top:12px" href="#/profile">View plans</a>` :
      `<div class="row" style="margin-top:10px">${ring(b.confidence, b.level, 64)}<div class="grow"><div style="font-weight:850;font-size:1.2rem;line-height:1.15">${esc(b.text)}</div><div class="muted small">Risk level: ${esc(b.risk)}</div></div></div>
      <div class="stat3"><div><small>Probability</small><b>${pct(b.probability)}</b></div><div><small>${b.priced ? 'Best odds' : 'Fair odds'}</small><b>${odd(b.priced ? b.marketOdds : b.modelOdds)}</b></div><div><small>Confidence</small><b>${esc(b.levelText)}</b></div></div>
      ${b.value ? '<div class="tag value" style="display:inline-block;margin-bottom:8px">POTENTIAL VALUE</div>' : ''}
      ${b.explanation ? `<div class="expl"><p style="margin:0">${esc(b.explanation.summary)}</p><details><summary class="link" style="cursor:pointer;margin-top:8px">Why the model says this</summary><ul>${b.explanation.bullets.map((x) => `<li class="small">${esc(x)}</li>`).join('')}</ul></details></div>` : ''}
      ${d.match.status === 'scheduled' && state.user ? `<button class="btn sm block" style="margin-top:12px" data-savepick='${esc(JSON.stringify({ matchId: d.match.id, market: b.market, selection: b.selection, line: b.line }))}'>Save to my prediction history</button>` : ''}`}</div>`;
  } else h += '<div class="notice small">No selection with a real bookmaker price at or above the minimum odds yet. Probabilities below are still available.</div>';
  const p = a.probs;
  h += `<div class="card" style="margin-top:14px"><h3 style="margin-bottom:10px">Match result probability</h3><div class="probbar"><div class="h" style="flex:${p.home}">${Math.round(p.home)}%</div><div class="d" style="flex:${p.draw}">${Math.round(p.draw)}%</div><div class="a" style="flex:${p.away}">${Math.round(p.away)}%</div></div><div class="legend"><span>${esc(n.home)}</span><span>Draw</span><span>${esc(n.away)}</span></div>
    <div class="divider"></div><div class="cmp">${cmpRow('Expected goals', a.lambdas.home.toFixed(2), a.lambdas.away.toFixed(2))}</div>
    <div class="row small muted wrap" style="margin-top:12px;gap:14px"><span>Both teams score: <b style="color:var(--chalk)">${Math.round(p.btts)}%</b></span><span>Over 2.5: <b style="color:var(--chalk)">${Math.round(p.over25)}%</b></span></div>
    <div class="small muted" style="margin:12px 0 6px">Most likely scores</div><div class="row wrap">${a.scorelines.map((s) => `<span class="chip" style="min-height:30px">${esc(s.score)} <small>${s.probability}%</small></span>`).join('')}</div></div>`;
  const cats = state.config.categories, byCat = {};
  for (const x of a.picks) (byCat[x.category] ||= []).push(x);
  h += `<div class="sec"><h2 style="margin-bottom:6px">All markets</h2>` + cats.filter((c) => byCat[c.key]).map((c, i) => `<details class="card" style="margin-top:10px" ${i === 0 ? 'open' : ''}><summary style="cursor:pointer;font-weight:750">${esc(c.label)} <span class="muted small">(${byCat[c.key].length})</span></summary>${byCat[c.key].sort((x, y) => (y.confidence - x.confidence)).slice(0, 12).map(candRow).join('')}</details>`).join('') + '</div>';
  h += `<div class="card" style="margin-top:14px"><div class="row between small"><span class="muted">Data coverage</span><b>${Math.round(a.quality * 100)}%</b></div><div class="q" style="margin-top:6px"><i style="width:${a.quality * 100}%"></i></div><p class="muted tiny" style="margin:8px 0 0">${a.hasLineups ? 'Confirmed line-ups were available.' : 'Confirmed line-ups were not available.'} ${a.used?.xg ? 'xG data included.' : 'xG data not available for this match.'}</p></div>`;
  return h;
}
function tabOdds(d) {
  if (!d.odds.length) return empty('Odds not available yet', 'Bookmaker prices usually appear a few days before kick-off. Nothing is estimated or filled in.');
  return `<p class="muted small" style="margin-top:0">Best price across bookmakers. Odds change quickly; always check the bookmaker before betting.</p>` + d.odds.map((g) => `<div class="mkt card"><h3>${esc(g.name)}</h3><div class="sels" style="margin-top:8px">${g.items.map((i) => `<div class="sel"><small>${esc(selLabel(g.market, i.selection, i.line))}</small><b>${odd(i.best)}</b><small>${esc(i.bookmaker)}</small></div>`).join('')}</div></div>`).join('');
}
function tabStats(d) {
  let h = '';
  if (d.stats?.length) h += `<div class="card"><h3 style="margin-bottom:12px">Match statistics</h3><div class="cmp">${d.stats.map((s) => cmpRow(s.name, s.home, s.away)).join('')}</div></div>`;
  const hs = d.teamStats.home, as = d.teamStats.away;
  if (hs && as) {
    const g = (s, k, v) => s?.[k]?.[v] != null ? Number(s[k][v]).toFixed(2) : null;
    h += `<div class="card" style="margin-top:14px"><h3 style="margin-bottom:4px">Season averages</h3><div class="row between small muted"><span>${esc(d.match.home.name)}</span><span>${esc(d.match.away.name)}</span></div><div class="cmp" style="margin-top:8px">
      ${cmpRow('Goals scored (home / away)', g(hs, 'gf_avg', 'home'), g(as, 'gf_avg', 'away'))}${cmpRow('Goals conceded (home / away)', g(hs, 'ga_avg', 'home'), g(as, 'ga_avg', 'away'))}
      ${cmpRow('Goals scored per game', g(hs, 'gf_avg', 'total'), g(as, 'gf_avg', 'total'))}${cmpRow('Goals conceded per game', g(hs, 'ga_avg', 'total'), g(as, 'ga_avg', 'total'))}
      ${hs.xg_for_avg != null && as.xg_for_avg != null ? cmpRow('xG for', hs.xg_for_avg.toFixed(2), as.xg_for_avg.toFixed(2)) + cmpRow('xG against', hs.xg_against_avg.toFixed(2), as.xg_against_avg.toFixed(2)) : ''}</div>
      ${hs.xg_for_avg == null ? '<p class="muted tiny" style="margin:10px 0 0">xG is not available from the data provider for this competition.</p>' : ''}</div>`;
  }
  return h || empty('Statistics not available yet', 'Match and season statistics appear here when the data provider publishes them.');
}
function tabForm(d) {
  const n = d.match, rows = (list) => list.length ? `<div class="tablewrap"><table class="t"><tbody>${list.map((x) => `<tr><td class="muted">${new Date(x.date).toLocaleDateString([], { day: 'numeric', month: 'short' })}</td><td>${x.home ? 'H' : 'A'}</td><td class="ellip">${esc(x.opponent || '')}</td><td class="num right"><b>${x.gf}–${x.ga}</b></td></tr>`).join('')}</tbody></table></div>` : '';
  let h = `<div class="card"><div class="row between"><b>${esc(n.home.name)}</b>${formDots(d.form.home.form)}</div>${rows(d.form.home.matches)}</div><div class="card" style="margin-top:12px"><div class="row between"><b>${esc(n.away.name)}</b>${formDots(d.form.away.form)}</div>${rows(d.form.away.matches)}</div>`;
  if (d.standing) h += `<div class="card" style="margin-top:12px"><h3>League position</h3><div class="row between" style="margin-top:8px"><span>${esc(n.home.name)}: <b>${d.standing.homeRank}</b></span><span>${esc(n.away.name)}: <b>${d.standing.awayRank}</b></span><span class="muted small">of ${d.standing.size}</span></div></div>`;
  const s = d.h2h.summary;
  h += `<div class="card" style="margin-top:12px"><h3>Head-to-head</h3>${s ? `<div class="stat3"><div><small>${esc(n.home.name)} wins</small><b>${s.homeWins}</b></div><div><small>Draws</small><b>${s.draws}</b></div><div><small>${esc(n.away.name)} wins</small><b>${s.awayWins}</b></div></div><p class="muted small" style="margin:0 0 6px">Average goals in last ${s.n}: ${s.avgGoals}</p><div class="tablewrap"><table class="t"><tbody>${d.h2h.items.map((x) => `<tr><td class="muted">${new Date(x.date).toLocaleDateString([], { month: 'short', year: '2-digit' })}</td><td class="ellip">${esc(x.home)}</td><td class="num"><b>${x.hg}–${x.ag}</b></td><td class="ellip">${esc(x.away)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted small">No previous meetings found.</p>'}</div>`;
  return h;
}
function tabLineups(d) {
  let h = '';
  if (d.lineups?.length) h += d.lineups.map((t) => `<div class="card" style="margin-bottom:12px"><div class="row between"><b>${esc(t.team)}</b><span class="muted small">${esc(t.formation || '')}</span></div><div class="small" style="margin-top:8px;columns:2">${t.startXI.map((p) => `<div>${esc(p.number ?? '')} ${esc(p.name)}</div>`).join('')}</div></div>`).join('');
  else h += `<div class="notice small">Line-ups are not published yet. They are usually released about an hour before kick-off. The model does not assume a line-up.</div>`;
  h += `<div class="card" style="margin-top:12px"><h3>Injuries and absences</h3>${d.injuries.length ? d.injuries.map((i) => `<div class="row between small" style="padding:7px 0;border-top:1px solid var(--line2)"><span>${esc(i.player)}</span><span class="muted">${esc(i.reason || i.type || '')}</span></div>`).join('') : '<p class="muted small" style="margin:6px 0 0">None reported.</p>'}</div>`;
  return h;
}
async function matchView(el, live, m) {
  el.innerHTML = skeleton(1) + '<div class="sk line"></div><div class="sk line"></div>' + skeleton(1);
  const d = await api('/matches/' + m[1]);
  if (!live()) return;
  const x = d.match; let tab = 'ai';
  const tabs = [['ai', 'AI analysis'], ['odds', 'Odds'], ['stats', 'Stats'], ['form', 'Form & H2H'], ['lineups', 'Line-ups']];
  const body = { ai: tabAI, odds: tabOdds, stats: tabStats, form: tabForm, lineups: tabLineups };
  const draw = () => {
    const livem = x.status === 'live', fin = x.status === 'finished';
    const mid = (livem || fin) && x.score ? `<div class="score">${x.score.home}<i>:</i>${x.score.away}</div><div class="state">${livem ? `<span class="live"><b></b>${x.minute ? x.minute + "'" : 'LIVE'}</span>` : 'FULL TIME'}${x.score.htHome != null ? `<div class="muted tiny">HT ${x.score.htHome}–${x.score.htAway}</div>` : ''}</div>` : `<div class="ko">${fmtTime(x.kickoff)}</div><div class="state">${fmtDay(x.kickoff)}</div>`;
    el.innerHTML = `<div class="row between"><a class="link" href="javascript:history.back()">← Back</a><button class="fav ${x.favorite ? 'on' : ''}" data-fav="${x.id}" aria-label="Favourite" aria-pressed="${!!x.favorite}">${icon('star')}</button></div>
      <div class="hero"><div class="muted small" style="margin-bottom:12px">${esc(x.competition.name)}${x.competition.country ? ' · ' + esc(x.competition.country) : ''}</div><div class="mbody"><div class="team">${crest(x.home)}<span>${esc(x.home.name)}</span></div><div class="mid">${mid}</div><div class="team">${crest(x.away)}<span>${esc(x.away.name)}</span></div></div></div>
      ${d.statusNote ? `<div class="notice" style="margin-top:12px">${esc(d.statusNote)}</div>` : ''}
      <div class="tabs" role="tablist">${tabs.map(([k, l]) => `<button role="tab" class="${tab === k ? 'on' : ''}" data-tab="${k}">${l}</button>`).join('')}</div>
      <div id="tabbody">${body[tab](d)}</div>
      ${d.warnings?.length ? `<details class="muted tiny" style="margin-top:16px"><summary>Data notes (${d.warnings.length})</summary>${d.warnings.map((w) => `<p>${esc(w)}</p>`).join('')}</details>` : ''}`;
  };
  el.onclick = (e) => { const t = e.target.closest('[data-tab]'); if (t) { tab = t.dataset.tab; draw(); } };
  draw();
}

/* ---------------- picks / combos ---------------- */
async function picksView(el, live) {
  const qs = new URLSearchParams((location.hash.split('?')[1]) || '');
  const f = { type: qs.get('type') || 'all', category: '', date: localDate(), min: 0, page: 1 };
  const draw = () => {
    el.innerHTML = `<h1>AI Picks</h1><div class="stack" style="margin-top:12px"><div class="chips">${[['all', 'All picks'], ['high', 'High confidence'], ['value', 'Value bets']].map(([v, l]) => `<button class="chip ${f.type === v ? 'on' : ''}" data-type="${v}">${l}</button>`).join('')}<a class="chip" href="#/combos">Daily combinations →</a></div>
      <div class="chips" id="cats"><button class="chip ${!f.category ? 'on' : ''}" data-cat="">All markets</button>${state.config.categories.map((c) => `<button class="chip ${f.category === c.key ? 'on' : ''}" data-cat="${c.key}">${esc(c.label)}</button>`).join('')}</div>
      <div class="chips" id="days">${[0, 1, 2, 3].map((o) => `<button class="chip ${f.date === localDate(o) ? 'on' : ''}" data-date="${localDate(o)}">${dayChip(o)}</button>`).join('')}</div></div><div id="plist" style="margin-top:14px"></div>`;
    $$('[data-type]', el).forEach((b) => (b.onclick = () => { f.type = b.dataset.type; f.page = 1; draw(); }));
    $$('[data-cat]', el).forEach((b) => (b.onclick = () => { f.category = b.dataset.cat; f.page = 1; draw(); }));
    $$('[data-date]', el).forEach((b) => (b.onclick = () => { f.date = b.dataset.date; f.page = 1; draw(); }));
    load(true);
  };
  const load = async (reset) => {
    const box = $('#plist'); if (!box) return;
    if (reset) box.innerHTML = skeleton(4, 'card');
    try {
      const d = await api(`/picks?${new URLSearchParams({ date: f.date, tz: tzOffset(), type: f.type, category: f.category, page: f.page })}`);
      if (!live() || !$('#plist')) return;
      if (d.locked) { box.innerHTML = `<div class="card center">${lockChip('VIP and Premium')}<h3 style="margin-top:8px">${d.count} value bet${d.count === 1 ? '' : 's'} found</h3><p class="muted small">Value bets compare the bookmaker price with the model's fair odds. Upgrade to see them.</p><a class="btn primary" href="#/profile">View plans</a></div>`; return; }
      const html = d.items.map(pickRow).join('');
      if (reset) box.innerHTML = warnBox(d) + (d.picksLimit != null ? `<div class="notice small" style="margin-bottom:12px">Free plan shows ${d.picksLimit} pick${d.picksLimit === 1 ? '' : 's'} per list. <a class="link" href="#/profile">See plans</a></div>` : '') + (html ? `<div id="pl">${html}</div>${levelsLegend()}` : empty('No picks yet for this selection', 'Picks appear once team data and bookmaker prices are available for upcoming matches.'));
      else $('#pl').insertAdjacentHTML('beforeend', html);
      $('#more')?.remove();
      if (d.page < d.pages) { box.insertAdjacentHTML('beforeend', '<button class="btn block" id="more" style="margin-top:8px">Load more</button>'); $('#more').onclick = () => { f.page++; load(false); }; }
    } catch (e) { box.innerHTML = errBox(e); }
  };
  draw();
}
async function combosView(el, live) {
  el.innerHTML = '<h1>Daily combinations</h1>' + skeleton(2);
  const d = await api(`/combos?date=${localDate()}&tz=${tzOffset()}`);
  if (!live()) return;
  el.innerHTML = `<h1>Daily combinations</h1><p class="muted small">Built only from real bookmaker prices. Longer combinations carry much higher risk: every leg must come in.</p>${warnBox(d)}${d.items.map(comboCard).join('')}`;
}

/* ---------------- bet machine ---------------- */
async function machineView(el, live) {
  const f = state.features;
  if (!f.bet_machine) { el.innerHTML = `<h1>AI Bet Machine</h1><div class="card center" style="margin-top:14px">${lockChip('VIP and Premium')}<h3 style="margin-top:8px">Build an accumulator to a target</h3><p class="muted small">Choose target odds, number of matches, minimum confidence and markets. The machine searches real priced selections for the closest fit.</p><a class="btn primary" href="#/profile">View plans</a></div>`; return; }
  const comps = (await api('/competitions?popular=1')).items;
  if (!live()) return;
  const s = { target: 5, legs: Math.min(5, f.bet_machine_max_legs), min: 80, cats: new Set(), date: localDate(), comp: '' };
  el.innerHTML = `<h1>AI Bet Machine</h1><p class="muted small">Tell it what you want; it builds the closest combination from today's priced selections. Results are estimates, never guarantees.</p>
    <div class="stack-lg" style="margin-top:14px">
    <div><label class="f">Target combined odds</label><input id="mt" type="number" step="0.1" min="1.1" value="${s.target}" inputmode="decimal"><div class="chips" style="margin-top:8px">${[2, 3, 5, 10, 20].map((x) => `<button class="chip" data-t="${x}">${x.toFixed(2)}</button>`).join('')}</div></div>
    <div><label class="f">Number of matches: <b id="lv" style="color:var(--chalk)">${s.legs}</b></label><input id="ml" type="range" min="1" max="${f.bet_machine_max_legs}" value="${s.legs}"></div>
    <div><label class="f">Minimum confidence: <b id="cv" style="color:var(--chalk)">${s.min}</b></label><input id="mc" type="range" min="50" max="95" value="${s.min}"></div>
    <div><label class="f">Markets (none selected = all)</label><div class="chips">${state.config.categories.map((c) => `<button class="chip" data-c="${c.key}">${esc(c.label)}</button>`).join('')}</div></div>
    <div class="grid2"><div><label class="f">Competition</label><select id="mp"><option value="">Any</option>${comps.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></div><div><label class="f">Date</label><input id="md" type="date" value="${s.date}"></div></div>
    <button class="btn primary block" id="go">Generate accumulator</button><div id="mres"></div></div>`;
  $('#mt').oninput = (e) => (s.target = parseFloat(e.target.value));
  $$('[data-t]', el).forEach((b) => (b.onclick = () => { s.target = +b.dataset.t; $('#mt').value = s.target; }));
  $('#ml').oninput = (e) => { s.legs = +e.target.value; $('#lv').textContent = s.legs; };
  $('#mc').oninput = (e) => { s.min = +e.target.value; $('#cv').textContent = s.min; };
  $$('[data-c]', el).forEach((b) => (b.onclick = () => { s.cats.has(b.dataset.c) ? s.cats.delete(b.dataset.c) : s.cats.add(b.dataset.c); b.classList.toggle('on'); }));
  $('#mp').onchange = (e) => (s.comp = e.target.value); $('#md').onchange = (e) => (s.date = e.target.value);
  $('#go').onclick = async () => {
    const box = $('#mres'), btn = $('#go'); btn.disabled = true; box.innerHTML = skeleton(1);
    try {
      const d = await api('/bet-machine', { method: 'POST', body: { targetOdds: s.target, legs: s.legs, minConfidence: s.min, categories: [...s.cats], competitionId: s.comp || null, date: s.date, tz: tzOffset() } });
      box.innerHTML = warnBox(d) + (d.result ? comboCard({ ...d.result, label: 'Your accumulator' }) + (d.message ? `<div class="notice small">${esc(d.message)}</div>` : '') + `<p class="muted tiny">${d.available} selection${d.available === 1 ? '' : 's'} met your filters.</p>` : empty('No accumulator available', d.message || 'Nothing matched your filters.'));
    } catch (e) { box.innerHTML = `<div class="notice err">${esc(e.message)}</div>`; }
    btn.disabled = false;
  };
}

/* ---------------- favourites / history / notifications ---------------- */
async function favoritesView(el, live) {
  if (!state.user) return needLogin(el, 'Sign in to follow teams and save matches.');
  el.innerHTML = '<h1>Favorites</h1>' + skeleton(2);
  const d = await api('/favorites');
  if (!live()) return;
  el.innerHTML = `<h1>Favorites</h1>${sec('Saved matches', '', d.matches.length ? `<div class="cards">${d.matches.map(matchCard).join('')}</div>` : '<p class="muted small">Tap the star on any match to save it. You will get a notification shortly before kick-off.</p>')}
    ${sec('Followed teams', '', d.teams.length ? d.teams.map((t) => `<div class="card" style="margin-bottom:10px"><div class="row">${crest(t)}<b class="grow">${esc(t.name)}</b><button class="btn sm" data-unteam="${t.id}">Unfollow</button></div>${t.next ? `<div style="margin-top:10px">${matchCard(t.next)}</div>` : '<p class="muted small" style="margin:8px 0 0">No upcoming match listed.</p>'}</div>`).join('') : '<p class="muted small">Search for a team on the home page and tap it to follow.</p>')}`;
}
async function historyView(el, live) {
  if (!state.user) return needLogin(el, 'Sign in to see your saved predictions.');
  el.innerHTML = '<h1>My prediction history</h1>' + skeleton(2);
  const d = await api('/history');
  if (!live()) return;
  const cls = { won: 'high', lost: 'risky', void: 'medium', pending: 'good' };
  el.innerHTML = `<a class="link" href="#/profile">← Profile</a><h1 style="margin-top:8px">My prediction history</h1><p class="muted small">${d.summary.settled ? `${d.summary.won} of ${d.summary.settled} settled picks came in.` : 'Saved picks are settled automatically after full time.'} Past results do not predict future ones.</p>` +
    (d.items.length ? d.items.map((h) => `<a class="prow" href="#/match/${h.matchId}"><div class="grow"><div class="muted tiny ellip">${esc(h.matchLabel)} · ${fmtDay(h.kickoff)}${h.score ? ' · ' + h.score : ''}</div><div class="t">${esc(h.text)}</div><div class="muted tiny">${pct(h.probability)} · conf ${Math.round(h.confidence)}${h.odds ? ' · @' + odd(h.odds) : ''}</div></div><span class="badge lv-${cls[h.result]}">${h.result.toUpperCase()}</span></a>`).join('') : empty('Nothing saved yet', 'Open a match and tap "Save to my prediction history".'));
}
async function notificationsView(el, live) {
  if (!state.user) return needLogin(el, 'Sign in to see notifications.');
  const d = await api('/notifications');
  if (!live()) return;
  el.innerHTML = `<h1>Notifications</h1>` + (d.items.length ? d.items.map((n) => `<div class="card" style="margin-top:10px;${n.read ? '' : 'border-color:var(--grass)'}"><b>${esc(n.title)}</b><div class="small muted">${esc(n.body || '')}</div><div class="tiny muted" style="margin-top:4px">${fmtDateTime(n.created_at)}</div></div>`).join('') : empty('No notifications', 'Plan changes and kick-off reminders for your favourites appear here.'));
  if (d.unread) { await api('/notifications/read', { method: 'POST' }); state.unread = 0; chrome(); setActive(); }
}

/* ---------------- auth / profile ---------------- */
function mountGoogle(box) {
  const id = state.config.googleClientId; if (!id || !box) return;
  const s = document.createElement('script'); s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
  s.onload = () => { window.google.accounts.id.initialize({ client_id: id, callback: async (r) => { try { setUser(await api('/auth/google', { method: 'POST', body: { credential: r.credential } })); await refreshMe(); location.hash = '#/profile'; } catch (e) { toast(e.message); } } }); window.google.accounts.id.renderButton(box, { theme: 'filled_black', size: 'large', width: 300 }); };
  document.head.appendChild(s);
}
function authView(el) {
  let mode = 'login';
  const draw = () => {
    el.innerHTML = `<h1>${mode === 'login' ? 'Welcome back' : 'Create your account'}</h1><p class="muted small">Save favourites, track predictions and get kick-off alerts.</p>
      <form id="af" class="stack" style="margin-top:14px" novalidate>${mode === 'register' ? '<div><label class="f" for="an">Name</label><input id="an" autocomplete="name" maxlength="60"></div>' : ''}
      <div><label class="f" for="ae">Email</label><input id="ae" type="email" autocomplete="email" inputmode="email" required></div>
      <div><label class="f" for="ap">Password ${mode === 'register' ? '(8+ characters)' : ''}</label><input id="ap" type="password" autocomplete="${mode === 'login' ? 'current-password' : 'new-password'}" required></div>
      <div id="aerr" class="notice err" hidden></div><button class="btn primary block" type="submit">${mode === 'login' ? 'Sign in' : 'Create account'}</button></form>
      ${state.config.googleClientId ? '<div class="center muted small" style="margin:16px 0 8px">or</div><div id="gbtn" class="row" style="justify-content:center"></div>' : ''}
      <p class="center small muted" style="margin-top:18px">${mode === 'login' ? 'New here?' : 'Already registered?'} <button class="link" id="sw">${mode === 'login' ? 'Create an account' : 'Sign in'}</button></p>
      <p class="muted tiny center">By continuing you confirm you are 18 or over.</p>`;
    $('#sw').onclick = () => { mode = mode === 'login' ? 'register' : 'login'; draw(); };
    $('#af').onsubmit = async (e) => {
      e.preventDefault(); const err = $('#aerr'); err.hidden = true;
      try {
        const d = await api(`/auth/${mode}`, { method: 'POST', body: { email: $('#ae').value, password: $('#ap').value, name: $('#an')?.value } });
        setUser(d); await refreshMe(); toast('Signed in'); location.hash = '#/profile';
      } catch (x) { err.textContent = x.message; err.hidden = false; }
    };
    mountGoogle($('#gbtn'));
  };
  draw();
}
async function profileView(el) {
  if (!state.user) return authView(el);
  const u = state.user, tf = state.config.tiers, f = state.features;
  const feat = (t) => { const x = tf[t]; return `<ul><li>${t === 'free' ? `${state.config.freePicks} picks per list` : 'All AI picks'}</li><li>${x.high_confidence ? 'High confidence picks' : 'No high-confidence picks'}</li><li>${x.value_bets ? 'Value bets' : 'No value bets'}</li><li>${x.bet_machine ? `Bet Machine up to ${x.bet_machine_max_legs} legs` : 'No Bet Machine'}</li><li>Combinations: ${x.combos.length ? x.combos.map((c) => c.replace('_', ' ')).join(', ') : 'none'}</li></ul>`; };
  el.innerHTML = `<h1>Profile</h1><div class="card" style="margin-top:12px"><div class="row"><span class="crest" style="width:52px;height:52px;font-size:1.3rem">${esc((u.name || u.email)[0].toUpperCase())}</span><div class="grow"><b>${esc(u.name || '')}</b><div class="muted small ellip">${esc(u.email)}</div></div>${tierPill(u.tier)}</div>
    ${u.tier_expires_at && u.tier !== 'free' ? `<p class="muted small" style="margin:10px 0 0">Plan active until ${fmtDay(u.tier_expires_at)}.</p>` : ''}
    ${f.unlock_everything ? '<div class="notice small" style="margin-top:12px">Testing mode: all features are unlocked for everyone.</div>' : ''}</div>
    <div class="grid2" style="margin-top:12px"><a class="btn" href="#/history">My history</a><a class="btn" href="#/notifications">Notifications${state.unread ? ` (${state.unread})` : ''}</a></div>
    ${u.is_admin ? '<a class="btn primary block" style="margin-top:12px" href="#/admin">Open admin dashboard</a>' : ''}
    ${sec('Plans', '', `<div class="tiers">${['free', 'vip', 'premium'].map((t) => `<div class="tier ${u.tier === t ? 'cur' : ''}"><div class="row between"><b>${t.toUpperCase()}</b>${u.tier === t ? '<span class="pill">Current</span>' : ''}</div>${feat(t)}</div>`).join('')}</div><p class="muted small">To change your plan, contact the administrator.</p>`)}
    ${sec('Account', '', `<form id="pf" class="stack"><div><label class="f" for="pn">Display name</label><input id="pn" value="${esc(u.name || '')}" maxlength="60"></div><button class="btn block" type="submit">Save name</button></form>
      <form id="pw" class="stack" style="margin-top:14px"><div><label class="f" for="pc">Current password</label><input id="pc" type="password" autocomplete="current-password"></div><div><label class="f" for="pnn">New password</label><input id="pnn" type="password" autocomplete="new-password"></div><button class="btn block" type="submit">Change password</button></form>
      <button class="btn danger block" id="out" style="margin-top:14px">Sign out</button>`)}`;
  $('#pf').onsubmit = async (e) => { e.preventDefault(); try { const d = await api('/me', { method: 'PATCH', body: { name: $('#pn').value } }); state.user = d.user; toast('Saved'); } catch (x) { toast(x.message); } };
  $('#pw').onsubmit = async (e) => { e.preventDefault(); try { await api('/me/password', { method: 'POST', body: { current: $('#pc').value, next: $('#pnn').value } }); toast('Password changed'); e.target.reset(); } catch (x) { toast(x.message); } };
  $('#out').onclick = async () => { setToken(null); await refreshMe(); location.hash = '#/'; toast('Signed out'); };
}
async function adminView(el, live) {
  if (!state.user?.is_admin) { el.innerHTML = empty('Administrators only', 'You do not have access to this page.'); return; }
  el.innerHTML = skeleton(2);
  const mod = await import('./admin.js');
  if (live()) await mod.render(el, live);
}

/* ---------------- global events ---------------- */
document.addEventListener('click', async (e) => {
  const fav = e.target.closest('[data-fav]');
  if (fav) {
    e.preventDefault(); e.stopPropagation();
    if (!state.user) { toast('Sign in to save favourites'); location.hash = '#/login'; return; }
    const id = fav.dataset.fav, on = !fav.classList.contains('on');
    $$(`[data-fav="${id}"]`).forEach((b) => { b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
    try { on ? await api('/favorites', { method: 'POST', body: { kind: 'match', refId: +id } }) : await api(`/favorites/match/${id}`, { method: 'DELETE' }); toast(on ? 'Saved to favourites' : 'Removed'); }
    catch (x) { toast(x.message); $$(`[data-fav="${id}"]`).forEach((b) => b.classList.toggle('on', !on)); }
    return;
  }
  const t = e.target.closest('[data-team]');
  if (t) { e.preventDefault(); if (!state.user) { toast('Sign in to follow teams'); location.hash = '#/login'; return; } try { await api('/favorites', { method: 'POST', body: { kind: 'team', refId: +t.dataset.team } }); toast(`Following ${t.dataset.name}`); $('#sres').hidden = true; } catch (x) { toast(x.message); } return; }
  const un = e.target.closest('[data-unteam]');
  if (un) { await api(`/favorites/team/${un.dataset.unteam}`, { method: 'DELETE' }); route(); return; }
  const sp = e.target.closest('[data-savepick]');
  if (sp) { try { await api('/history', { method: 'POST', body: JSON.parse(sp.dataset.savepick) }); toast('Saved to your history'); sp.disabled = true; } catch (x) { toast(x.message); } return; }
  if (e.target.closest('[data-reload]')) route();
  if (!e.target.closest('#sbox')) { const r = $('#sres'); if (r) r.hidden = true; }
});

async function boot() {
  try { await refreshMe(); }
  catch (e) { $('#app').innerHTML = errBox(e); return; }
  if (state.config.maintenance && !state.user?.is_admin) { $('#app').innerHTML = empty('Down for maintenance', 'We will be back shortly.'); }
  window.addEventListener('hashchange', route);
  route();
}
boot();
