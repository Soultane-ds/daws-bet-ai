'use strict';
const { all, get, run, inList } = require('../db');
const { isoNow } = require('../util');

function notify({ userId = null, title, body = '', kind = 'info', ref = null }) {
  try {
    return Number(run('INSERT INTO notifications(user_id,title,body,kind,ref,created_at) VALUES(?,?,?,?,?,?)', userId, title, body, kind, ref, isoNow()).lastInsertRowid);
  } catch (e) { if (/UNIQUE/.test(e.message)) return null; throw e; }
}
function listFor(userId, limit = 50) {
  return all(`SELECT n.id, n.title, n.body, n.kind, n.created_at, (r.user_id IS NOT NULL) AS read
    FROM notifications n LEFT JOIN notification_reads r ON r.notification_id=n.id AND r.user_id=?
    WHERE n.user_id=? OR n.user_id IS NULL ORDER BY n.id DESC LIMIT ?`, userId, userId, limit).map((n) => ({ ...n, read: !!n.read }));
}
function unreadCount(userId) {
  return get(`SELECT COUNT(*) AS n FROM notifications n LEFT JOIN notification_reads r ON r.notification_id=n.id AND r.user_id=?
    WHERE (n.user_id=? OR n.user_id IS NULL) AND r.user_id IS NULL`, userId, userId).n;
}
function markAllRead(userId) {
  const ids = all('SELECT n.id FROM notifications n WHERE (n.user_id=? OR n.user_id IS NULL) AND n.id NOT IN (SELECT notification_id FROM notification_reads WHERE user_id=?)', userId, userId).map((x) => x.id);
  for (const id of ids) run('INSERT OR IGNORE INTO notification_reads(user_id,notification_id) VALUES(?,?)', userId, id);
}
/** Tell users when a favourite match is about to start. */
function notifyKickoffs() {
  const now = isoNow(), soon = new Date(Date.now() + 45 * 60000).toISOString();
  const rows = all(`SELECT f.user_id, m.id AS match_id, th.name AS h, ta.name AS a FROM favorites f JOIN matches m ON m.id=f.ref_id
    JOIN teams th ON th.id=m.home_team_id JOIN teams ta ON ta.id=m.away_team_id
    WHERE f.kind='match' AND m.status='scheduled' AND m.kickoff_at > ? AND m.kickoff_at < ?`, now, soon);
  for (const r of rows) notify({ userId: r.user_id, title: 'Kick-off soon', body: `${r.h} v ${r.a} starts within 45 minutes.`, kind: 'match', ref: `kick:${r.match_id}:${r.user_id}` });
}
module.exports = { notify, listFor, unreadCount, markAllRead, notifyKickoffs };
