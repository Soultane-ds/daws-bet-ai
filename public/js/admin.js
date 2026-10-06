import { state, $, $$, esc, api, toast, fmtDateTime, skeleton, empty, odd } from './ui.js';

const SECTIONS = [['overview', 'Overview'], ['matches', 'Matches'], ['users', 'Users'], ['competitions', 'Competitions'], ['categories', 'Categories'], ['settings', 'Settings'], ['banners', 'Banners'], ['notifications', 'Notifications'], ['history', 'History'], ['system', 'System']];
const dt = (iso) => (iso ? fmtDateTime(iso) : '–');
const field = (label, id, val, type = 'text', extra = '') => `<div><label class="f" for="${id}">${label}</label><input id="${id}" type="${type}" value="${esc(val ?? '')}" ${extra}></div>`;
const sw = (label, id, on, hint = '') => `<label class="switch"><span><b>${label}</b>${hint ? `<div class="muted small">${hint}</div>` : ''}</span><input type="checkbox" id="${id}" ${on ? 'checked' : ''}></label>`;
const pager = (d) => (d.pages > 1 ? `<div class="row between" style="margin-top:12px"><button class="btn sm" data-pg="${d.page - 1}" ${d.page <= 1 ? 'disabled' : ''}>← Prev</button><span class="muted small">Page ${d.page} of ${d.pages} · ${d.total} total</span><button class="btn sm" data-pg="${d.page + 1}" ${d.page >= d.pages ? 'disabled' : ''}>Next →</button></div>` : d.total != null ? `<p class="muted small">${d.total} total</p>` : '');
const ok = async (fn, msg = 'Saved') => { try { await fn(); toast(msg); return true; } catch (e) { toast(e.message); return false; } };

export async function render(el, live) {
  const sec = ((location.hash.split('/')[2] || 'overview').split('?')[0]);
  const nav = `<h1>Admin</h1><div class="admnav" style="margin-top:12px">${SECTIONS.map(([k, l]) => `<a href="#/admin/${k}" class="${sec === k ? 'on' : ''}">${l}</a>`).join('')}</div><div id="adm" class="adm"></div>`;
  el.innerHTML = nav;
  const box = $('#adm'); box.innerHTML = skeleton(2);
  try { await ({ overview, matches, users, competitions, categories, settings, banners, notifications, history, system }[sec] || overview)(box, live); }
  catch (e) { box.innerHTML = `<div class="notice err">${esc(e.message)}</div>`; }
}

async function overview(box) {
  const d = await api('/admin/overview'), p = d.performance, s = d.system;
  const unlock = state.config.features.unlock_everything;
  box.innerHTML = `<div class="kpi"><div><b>${d.users.total}</b><small>Registered users (${d.users.newThisWeek} this week)</small></div><div><b>${d.matches.today}</b><small>Matches today (${d.matches.live} live)</small></div><div><b>${d.predictions.analysedMatches}</b><small>Matches analysed</small></div><div><b>${s.apiUsedToday}/${s.apiDailyLimit}</b><small>Provider requests today</small></div></div>
    <div class="card"><b>Users by plan</b><div class="row wrap" style="margin-top:8px">${['free', 'vip', 'premium'].map((t) => `<span class="pill ${t}">${t.toUpperCase()} ${d.users.byTier[t] || 0}</span>`).join('')}<span class="pill">Disabled ${d.users.disabled}</span></div>
      ${sw('Unlock Everything (testing)', 'unl', unlock, 'Gives every visitor all VIP/Premium features. Turn off before launch.')}</div>
    <div class="card"><b>AI performance (settled picks)</b>${p.overall ? `<p class="small">Hit rate <b>${p.overall.hitRate}%</b> over ${p.overall.picks} picks · model predicted avg <b>${p.overall.avgPredicted}%</b>${p.overall.roi != null ? ` · flat-stake ROI <b>${p.overall.roi}%</b>` : ''}. ${p.pending} pending.</p>` : `<p class="muted small">No settled picks yet (${p.pending} pending). Results are tracked automatically after full time.</p>`}<p class="muted tiny">${esc(p.note)}</p></div>
    ${!s.providerConfigured ? '<div class="notice err"><b>Football data provider not configured.</b> Set API_FOOTBALL_KEY in the server .env file.</div>' : s.status && !s.status.ok ? `<div class="notice"><b>Last provider error:</b> ${esc(s.status.message)}</div>` : ''}`;
  $('#unl').onchange = (e) => ok(async () => { await api('/admin/settings', { method: 'PUT', body: { unlock_everything: e.target.checked } }); state.config.features.unlock_everything = e.target.checked; }, e.target.checked ? 'Everything unlocked' : 'Tiers enforced');
}

async function users(box, live, page = 1, q = '') {
  const d = await api(`/admin/users?page=${page}&q=${encodeURIComponent(q)}`);
  box.innerHTML = `<input id="uq" type="search" placeholder="Search by email or name" value="${esc(q)}" aria-label="Search users"><div class="card" style="padding:4px 10px">${d.items.map((u) => `<div style="padding:12px 0;border-top:1px solid var(--line2)" data-u="${u.id}"><div class="row between"><div class="grow"><b class="ellip">${esc(u.name || '')}</b>${u.is_admin ? ' <span class="pill premium">ADMIN</span>' : ''}${u.disabled ? ' <span class="pill" style="color:var(--red)">DISABLED</span>' : ''}<div class="muted tiny ellip">${esc(u.email)}</div><div class="muted tiny">Joined ${dt(u.created_at)} · last login ${dt(u.last_login_at)}</div></div><span class="pill ${u.tier}">${u.tier.toUpperCase()}</span></div>
      <div class="row wrap" style="margin-top:8px"><select data-f="tier" style="width:auto;min-height:36px">${['free', 'vip', 'premium'].map((t) => `<option ${u.tier === t ? 'selected' : ''}>${t}</option>`).join('')}</select><input data-f="days" type="number" min="1" placeholder="days (optional)" style="width:150px;min-height:36px"><button class="btn sm" data-do="plan">Apply plan</button><button class="btn sm ${u.disabled ? '' : 'danger'}" data-do="disable">${u.disabled ? 'Enable' : 'Disable'}</button><button class="btn sm" data-do="admin">${u.is_admin ? 'Remove admin' : 'Make admin'}</button></div>${u.tier_expires_at ? `<div class="muted tiny" style="margin-top:4px">Plan expires ${dt(u.tier_expires_at)}</div>` : ''}</div>`).join('') || '<p class="muted">No users found.</p>'}</div>${pager(d)}`;
  $('#uq').onchange = (e) => users(box, live, 1, e.target.value.trim());
  $$('[data-pg]', box).forEach((b) => (b.onclick = () => users(box, live, +b.dataset.pg, q)));
  box.onclick = async (e) => {
    const b = e.target.closest('[data-do]'); if (!b) return;
    const row = b.closest('[data-u]'), id = row.dataset.u, u = d.items.find((x) => x.id == id);
    const body = b.dataset.do === 'plan' ? { tier: $('[data-f=tier]', row).value, days: $('[data-f=days]', row).value || null } : b.dataset.do === 'disable' ? { disabled: !u.disabled } : { is_admin: !u.is_admin };
    if (await ok(() => api(`/admin/users/${id}`, { method: 'PATCH', body }), 'Updated')) users(box, live, page, q);
  };
}

async function matches(box, live, page = 1, q = '') {
  const d = await api(`/admin/matches?page=${page}&q=${encodeURIComponent(q)}`);
  box.innerHTML = `<form id="mf" class="card stack"><b>Add a match manually</b><div class="grid2">${field('Competition', 'mc', '', 'text', 'required maxlength="60"')}${field('Kick-off', 'mk', '', 'datetime-local', 'required')}</div><div class="grid2">${field('Home team', 'mh', '', 'text', 'required')}${field('Away team', 'ma', '', 'text', 'required')}</div>${sw('Feature as top match', 'mt', false)}<p class="muted tiny">Manual matches carry no provider statistics, so no AI estimate is produced for them.</p><button class="btn primary" type="submit">Add match</button></form>
    <input id="mq" type="search" placeholder="Search matches" value="${esc(q)}"><div class="card" style="padding:4px 10px">${d.items.map((m) => `<div style="padding:10px 0;border-top:1px solid var(--line2)" data-m="${m.id}"><div class="row between"><div class="grow"><b class="ellip">${esc(m.home)} v ${esc(m.away)}</b><div class="muted tiny">${esc(m.competition)} · ${dt(m.kickoff)} · ${esc(m.status)}${m.score ? ' · ' + m.score : ''} · ${m.source}${m.hidden ? ' · hidden' : ''}${m.isTop ? ' · top' : ''}</div></div></div>
      <div class="tbl-actions" style="margin-top:6px"><button class="btn sm" data-do="top">${m.isTop ? 'Unfeature' : 'Feature'}</button><button class="btn sm" data-do="analyse">Re-analyse</button>${m.hidden ? '<button class="btn sm" data-do="unhide">Unhide</button>' : ''}<button class="btn sm danger" data-do="remove">${m.source === 'manual' ? 'Delete' : 'Hide'}</button></div></div>`).join('') || '<p class="muted">No matches.</p>'}</div>${pager(d)}`;
  $('#mf').onsubmit = async (e) => { e.preventDefault(); if (await ok(() => api('/admin/matches', { method: 'POST', body: { competition: $('#mc').value, home: $('#mh').value, away: $('#ma').value, kickoff: new Date($('#mk').value).toISOString(), isTop: $('#mt').checked } }), 'Match added')) matches(box, live); };
  $('#mq').onchange = (e) => matches(box, live, 1, e.target.value.trim());
  $$('[data-pg]', box).forEach((b) => (b.onclick = () => matches(box, live, +b.dataset.pg, q)));
  $$('[data-do]', box).forEach((b) => (b.onclick = async () => {
    const id = b.closest('[data-m]').dataset.m, m = d.items.find((x) => x.id == id), a = b.dataset.do;
    const fn = a === 'top' ? () => api(`/admin/matches/${id}`, { method: 'PATCH', body: { isTop: !m.isTop } }) : a === 'unhide' ? () => api(`/admin/matches/${id}`, { method: 'PATCH', body: { hidden: false } }) : a === 'analyse' ? () => api('/admin/analyse', { method: 'POST', body: { matchId: id } }) : () => api(`/admin/matches/${id}`, { method: 'DELETE' });
    if (a === 'remove' && !confirm(m.source === 'manual' ? 'Delete this manual match?' : 'Hide this match from users?')) return;
    if (await ok(fn, 'Done')) matches(box, live, page, q);
  }));
}

async function competitions(box, live, page = 1, q = '') {
  const d = await api(`/admin/competitions?page=${page}&q=${encodeURIComponent(q)}`);
  box.innerHTML = `<input id="cq" type="search" placeholder="Search competitions" value="${esc(q)}"><p class="muted small" style="margin:0">Popular competitions are analysed automatically and shown on the home page. Disabled competitions are hidden everywhere.</p><div class="card" style="padding:4px 10px">${d.items.map((c) => `<div class="row between" style="padding:10px 0;border-top:1px solid var(--line2)" data-c="${c.id}"><div class="grow"><b class="ellip">${esc(c.name)}</b><div class="muted tiny">${esc(c.country || 'Manual')}</div></div><label class="cb"><input type="checkbox" data-k="popular" ${c.popular ? 'checked' : ''}>Popular</label><label class="cb"><input type="checkbox" data-k="enabled" ${c.enabled ? 'checked' : ''}>Enabled</label></div>`).join('') || '<p class="muted">No competitions yet. They appear after the first fixture sync.</p>'}</div>${pager(d)}`;
  $('#cq').onchange = (e) => competitions(box, live, 1, e.target.value.trim());
  $$('[data-pg]', box).forEach((b) => (b.onclick = () => competitions(box, live, +b.dataset.pg, q)));
  $$('[data-k]', box).forEach((c) => (c.onchange = () => ok(() => api(`/admin/competitions/${c.closest('[data-c]').dataset.c}`, { method: 'PATCH', body: { [c.dataset.k]: c.checked } }))));
}

async function categories(box) {
  const d = await api('/admin/categories');
  box.innerHTML = `<p class="muted small" style="margin:0">Prediction categories can be switched off entirely, or restricted to a minimum plan.</p><div class="card" style="padding:4px 10px">${d.items.map((c) => `<div class="row between" style="padding:12px 0;border-top:1px solid var(--line2)" data-k="${c.key}"><b class="grow">${esc(c.label)}</b><select data-f="min_tier" style="width:auto;min-height:36px">${['free', 'vip', 'premium'].map((t) => `<option ${c.min_tier === t ? 'selected' : ''}>${t}</option>`).join('')}</select><label class="cb"><input type="checkbox" data-f="enabled" ${c.enabled ? 'checked' : ''}>On</label></div>`).join('')}</div>`;
  $$('[data-f]', box).forEach((i) => (i.onchange = () => ok(() => api(`/admin/categories/${i.closest('[data-k]').dataset.k}`, { method: 'PATCH', body: { [i.dataset.f]: i.type === 'checkbox' ? i.checked : i.value } }))));
}

async function settings(box) {
  const s = await api('/admin/settings'), t = s.thresholds, tf = s.tier_features;
  box.innerHTML = `<form id="sf" class="stack">
    <div class="card stack"><b>Confidence thresholds</b><p class="muted small" style="margin:0">Each level starts at its value. Must descend: Very High &gt; High &gt; Good &gt; Medium. Below Medium = RISKY.</p><div class="grid4">${field('Very High', 'tvh', t.very_high, 'number', 'step="0.5"')}${field('High', 'th', t.high, 'number', 'step="0.5"')}${field('Good', 'tg', t.good, 'number', 'step="0.5"')}${field('Medium', 'tm', t.medium, 'number', 'step="0.5"')}</div></div>
    <div class="card stack"><b>Odds and value</b><div class="grid2">${field('Minimum odds', 'mo', s.min_odds, 'number', 'step="0.01"')}${field('Min. value edge (0.03 = 3%)', 'me', s.min_edge, 'number', 'step="0.01"')}</div>${field('Value bets: minimum confidence', 'vm', s.value_min_confidence, 'number')}</div>
    <div class="card stack"><b>Access</b>${sw('Unlock Everything (testing)', 'ue', s.unlock_everything, 'All visitors get every feature. Turn off before launch.')}${sw('Maintenance mode', 'mm', s.maintenance, 'Only admins can use the site.')}${field('Free plan: picks visible per list', 'fp', s.free_daily_picks, 'number')}
      <div class="small muted">Plan features</div>${['free', 'vip', 'premium'].map((p) => `<div class="card flat" style="padding:10px" data-tier="${p}"><b>${p.toUpperCase()}</b><div class="row wrap" style="margin-top:6px;gap:14px"><label class="cb"><input type="checkbox" data-t="high_confidence" ${tf[p].high_confidence ? 'checked' : ''}>High confidence</label><label class="cb"><input type="checkbox" data-t="value_bets" ${tf[p].value_bets ? 'checked' : ''}>Value bets</label><label class="cb"><input type="checkbox" data-t="bet_machine" ${tf[p].bet_machine ? 'checked' : ''}>Bet Machine</label></div><div class="row wrap" style="margin-top:6px;gap:14px"><label class="cb">Max legs <input data-t="legs" type="number" min="0" max="20" value="${tf[p].bet_machine_max_legs}" style="width:70px;min-height:34px"></label>${Object.keys(s.combos).map((c) => `<label class="cb"><input type="checkbox" data-c="${c}" ${tf[p].combos.includes(c) ? 'checked' : ''}>${c.replace('_', ' ')}</label>`).join('')}</div></div>`).join('')}</div>
    <div class="card stack"><b>Daily combinations</b>${Object.entries(s.combos).map(([k, c]) => `<div class="card flat" style="padding:10px" data-combo="${k}"><div class="grid2">${field('Label', `cl-${k}`, c.label)}<div><label class="f">Strategy</label><select id="cs-${k}">${['confidence', 'target', 'value'].map((x) => `<option ${c.strategy === x ? 'selected' : ''}>${x}</option>`).join('')}</select></div></div><div class="grid4" style="margin-top:8px">${field('Legs', `cn-${k}`, c.legs, 'number')}${field('Min conf.', `cm-${k}`, c.minConfidence, 'number')}${field('Target odds', `ct-${k}`, c.targetOdds ?? '', 'number', 'step="0.1"')}</div></div>`).join('')}</div>
    <div class="card stack"><b>Analysis</b><div class="grid2"><div><label class="f">Scope</label><select id="as"><option ${s.analysis_scope === 'popular' ? 'selected' : ''}>popular</option><option ${s.analysis_scope === 'all' ? 'selected' : ''}>all</option></select></div>${field('Batch size per cycle', 'ab', s.analysis_batch, 'number')}</div><div class="grid2">${field('Horizon (hours)', 'ah', s.analysis_horizon_hours, 'number')}${field('Refresh (minutes)', 'at', s.analysis_ttl_minutes, 'number')}</div>${field('Minimum data quality (0-1)', 'dq', s.min_data_quality, 'number', 'step="0.05"')}</div>
    <div class="card stack"><b>Branding and legal</b>${field('App name', 'an', s.app_name)}<div><label class="f" for="ds">Responsible gambling disclaimer</label><textarea id="ds" rows="5">${esc(s.disclaimer)}</textarea></div></div>
    <button class="btn primary block" type="submit">Save settings</button></form>`;
  $('#sf').onsubmit = async (e) => {
    e.preventDefault(); const n = (id) => Number($('#' + id).value);
    const tiers = {}; $$('[data-tier]', box).forEach((c) => { const g = (k) => $(`[data-t=${k}]`, c); tiers[c.dataset.tier] = { high_confidence: g('high_confidence').checked, value_bets: g('value_bets').checked, bet_machine: g('bet_machine').checked, bet_machine_max_legs: Number(g('legs').value), combos: $$('[data-c]', c).filter((x) => x.checked).map((x) => x.dataset.c) }; });
    const combos = {}; Object.keys(s.combos).forEach((k) => { combos[k] = { label: $(`#cl-${k}`).value, strategy: $(`#cs-${k}`).value, legs: n(`cn-${k}`), minConfidence: n(`cm-${k}`), targetOdds: n(`ct-${k}`) || undefined }; });
    const body = { thresholds: { very_high: n('tvh'), high: n('th'), good: n('tg'), medium: n('tm') }, min_odds: n('mo'), min_edge: n('me'), value_min_confidence: n('vm'), unlock_everything: $('#ue').checked, maintenance: $('#mm').checked, free_daily_picks: n('fp'), tier_features: tiers, combos, analysis_scope: $('#as').value, analysis_batch: n('ab'), analysis_horizon_hours: n('ah'), analysis_ttl_minutes: n('at'), min_data_quality: n('dq'), app_name: $('#an').value, disclaimer: $('#ds').value };
    if (await ok(() => api('/admin/settings', { method: 'PUT', body }), 'Settings saved')) { const c = await api('/config'); state.config = c; state.features = c.features; }
  };
}

async function banners(box) {
  const d = await api('/admin/banners');
  box.innerHTML = `<form id="bf" class="card stack"><b>New banner</b>${field('Title', 'bt', '', 'text', 'required maxlength="80"')}${field('Text', 'bb', '', 'text', 'maxlength="200"')}<button class="btn primary" type="submit">Add banner</button></form><div class="card" style="padding:4px 10px">${d.items.map((b) => `<div class="row between" style="padding:10px 0;border-top:1px solid var(--line2)" data-b="${b.id}"><div class="grow"><b>${esc(b.title)}</b><div class="muted small">${esc(b.body || '')}</div></div><label class="cb"><input type="checkbox" data-a="toggle" ${b.active ? 'checked' : ''}>Live</label><button class="btn sm danger" data-a="del">Delete</button></div>`).join('') || '<p class="muted">No banners.</p>'}</div>`;
  $('#bf').onsubmit = async (e) => { e.preventDefault(); if (await ok(() => api('/admin/banners', { method: 'POST', body: { title: $('#bt').value, body: $('#bb').value } }), 'Banner added')) banners(box); };
  $$('[data-a]', box).forEach((c) => (c[c.type === 'checkbox' ? 'onchange' : 'onclick'] = async () => { const id = c.closest('[data-b]').dataset.b; if (await ok(() => (c.dataset.a === 'del' ? api(`/admin/banners/${id}`, { method: 'DELETE' }) : api(`/admin/banners/${id}`, { method: 'PATCH', body: { active: c.checked } })), 'Updated') && c.dataset.a === 'del') banners(box); }));
}

async function notifications(box) {
  const d = await api('/admin/notifications');
  box.innerHTML = `<form id="nf" class="card stack"><b>Send a notification</b>${field('Title', 'nt', '', 'text', 'required maxlength="80"')}${field('Message', 'nb', '', 'text', 'maxlength="500"')}${field('Send to one user (email), or leave blank for everyone', 'ne', '', 'email')}<button class="btn primary" type="submit">Send</button></form>${d.items.map((n) => `<div class="card"><b>${esc(n.title)}</b> <span class="muted tiny">${n.user_id ? 'direct' : 'everyone'} · ${dt(n.created_at)}</span><div class="small muted">${esc(n.body || '')}</div></div>`).join('')}`;
  $('#nf').onsubmit = async (e) => { e.preventDefault(); if (await ok(() => api('/admin/notifications', { method: 'POST', body: { title: $('#nt').value, body: $('#nb').value, email: $('#ne').value || undefined } }), 'Sent')) notifications(box); };
}

async function history(box, live, page = 1, f = {}) {
  const [d, p] = await Promise.all([api(`/admin/history?page=${page}&scope=${f.scope || ''}&result=${f.result || ''}`), api('/admin/performance')]);
  const perf = (rows, h) => rows.length ? `<div class="tablewrap"><table class="t"><thead><tr><th>${h}</th><th>Picks</th><th>Hit</th><th>Predicted</th><th>ROI</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${esc(r.key)}</td><td class="num">${r.picks}</td><td class="num">${r.hitRate}%</td><td class="num">${r.avgPredicted}%</td><td class="num">${r.roi ?? '–'}${r.roi != null ? '%' : ''}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted small">No settled picks yet.</p>';
  box.innerHTML = `<div class="card"><b>Prediction performance</b><p class="muted tiny">${esc(p.note)}</p><h3 style="margin:10px 0 4px">By confidence level</h3>${perf(p.byLevel, 'Level')}<h3 style="margin:14px 0 4px">By market</h3>${perf(p.byMarket, 'Market')}</div>
    <div class="row wrap"><select id="hs" style="width:auto"><option value="">All sources</option><option value="system" ${f.scope === 'system' ? 'selected' : ''}>AI tracked</option><option value="users" ${f.scope === 'users' ? 'selected' : ''}>User saved</option></select><select id="hr" style="width:auto"><option value="">Any result</option>${['pending', 'won', 'lost', 'void'].map((r) => `<option ${f.result === r ? 'selected' : ''}>${r}</option>`).join('')}</select></div>
    <div class="card" style="padding:4px 10px"><div class="tablewrap"><table class="t"><thead><tr><th>Match</th><th>Pick</th><th>Conf.</th><th>Odds</th><th>Result</th></tr></thead><tbody>${d.items.map((h) => `<tr><td>${esc(h.match)}<div class="muted tiny">${esc(h.who)}${h.score ? ' · ' + h.score : ''}</div></td><td>${esc(h.pick)}</td><td class="num">${Math.round(h.confidence)}</td><td class="num">${h.odds ? odd(h.odds) : '–'}</td><td><b style="color:${{ won: 'var(--grass)', lost: 'var(--red)', void: 'var(--amber)', pending: 'var(--mute)' }[h.result]}">${h.result.toUpperCase()}</b></td></tr>`).join('') || '<tr><td colspan="5" class="muted">Nothing recorded yet.</td></tr>'}</tbody></table></div></div>${pager(d)}`;
  const re = () => history(box, live, 1, { scope: $('#hs').value, result: $('#hr').value });
  $('#hs').onchange = re; $('#hr').onchange = re;
  $$('[data-pg]', box).forEach((b) => (b.onclick = () => history(box, live, +b.dataset.pg, f)));
}

async function system(box) {
  const s = await api('/admin/system');
  box.innerHTML = `<div class="card stack"><b>System</b><div class="small">Provider: <b>${esc(s.provider)}</b> · ${s.providerConfigured ? '<span style="color:var(--grass)">key configured</span>' : '<span style="color:var(--red)">not configured</span>'}</div><div class="small">Requests today: <b>${s.apiUsedToday}</b> of <b>${s.apiDailyLimit}</b></div><div class="small">Last provider check: ${s.status ? (s.status.ok ? 'OK' : esc(s.status.message)) + ' · ' + dt(s.status.at) : 'none yet'}</div><div class="small">Environment: ${esc(s.env)} · Node ${esc(s.node)} · Google login ${s.googleLogin ? 'on' : 'off'}</div></div>
    <div class="card stack"><b>Actions</b><div class="row wrap"><input id="sd" type="date" style="width:auto"><button class="btn" id="sy">Re-sync fixtures</button><button class="btn" id="an">Analyse upcoming now</button></div><p class="muted tiny">Each action uses provider requests from today's budget.</p><div id="sr" class="small"></div></div>
    <div class="notice small">API keys live only in the server's environment file. They are never sent to browsers.</div>`;
  $('#sy').onclick = async () => { $('#sr').textContent = 'Syncing…'; const r = await api('/admin/sync', { method: 'POST', body: { date: $('#sd').value || undefined } }); $('#sr').textContent = r.error ? r.error : `Synced ${r.fixtures} fixtures for ${r.date}.`; };
  $('#an').onclick = async () => { $('#sr').textContent = 'Analysing…'; const r = await api('/admin/analyse', { method: 'POST', body: {} }); $('#sr').textContent = `Analysed ${r.analysed} match${r.analysed === 1 ? '' : 'es'}.`; };
}
