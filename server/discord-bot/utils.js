'use strict';
const SUPPORT_TYPES = new Set(['installation', 'bug', 'confidentialite', 'beta', 'autre']);
const STAFF_ROLE = '🛡️ Modération';
const ALERT_ROLE = '🔔 Alertes versions';
const SUPPORT_CATEGORY = '🎫 SUPPORT PRIVÉ';
const ARCHIVE_CATEGORY = '🗃️ TICKETS ARCHIVÉS';

function safeText(input, max = 900) {
  return String(input || '').replace(/@/g, '@\u200b').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max);
}
function ticketTopic(ownerId, type, closed = false) {
  if (!/^\d{15,22}$/.test(String(ownerId)) || !SUPPORT_TYPES.has(type)) throw new Error('Ticket invalide');
  return 'devgit-ticket:' + ownerId + ':' + type + (closed ? ':closed' : ':open');
}
function parseTicket(topic) {
  const match = /^devgit-ticket:(\d{15,22}):(installation|bug|confidentialite|beta|autre):(open|closed)$/.exec(topic || '');
  return match ? {ownerId: match[1], type: match[2], closed: match[3] === 'closed'} : null;
}
module.exports = {SUPPORT_TYPES, STAFF_ROLE, ALERT_ROLE, SUPPORT_CATEGORY, ARCHIVE_CATEGORY, safeText, ticketTopic, parseTicket};
