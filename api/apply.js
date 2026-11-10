// /api/apply — receives $SL presale (launchpad) applications posted by /launchpad
// and forwards each one to the team. Zero dependencies; runs as a Vercel Node.js
// function (Node 18+ has global fetch).
//
// Configure at least one sink in the Vercel project's environment variables:
//   TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID  -> one message per application in a team chat
//   SHEETS_WEBHOOK_URL                      -> POST of the JSON record to a Google Apps Script
//                                              web app that appends a row to a Sheet
// Until one is configured the endpoint answers 503 and the page falls back to e-mail.

'use strict';

// Jurisdictions the whitepaper (Legal Notice, 7.3, 11) and the exchange form (row 22)
// exclude from token sales: Korea, the United States, mainland China and the
// comprehensively sanctioned OFAC programmes.
const RESTRICTED = new Set(['KR', 'US', 'CN', 'CU', 'IR', 'KP', 'SY']);
const AMOUNTS = new Set(['100-500', '500-2000', '2000-5000', '5000+']);
const SOURCES = new Set(['ambassador', 'telegram', 'x', 'youtube', 'launchpad', 'friend', 'other']);
const MAX_BODY = 8 * 1024;

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

// Returns { ok: true, record } or { ok: false, status, error, fields }.
function validate(body, meta) {
  const errors = {};
  const r = {
    name: str(body.name, 80),
    email: str(body.email, 120).toLowerCase(),
    telegram: str(body.telegram, 64).replace(/^@+/, ''),
    country: str(body.country, 2).toUpperCase(),
    wallet: str(body.wallet, 42),
    amount: str(body.amount, 16),
    source: str(body.source, 16),
    ref: str(body.ref, 32).replace(/[^A-Za-z0-9_-]/g, ''),
    ambassadorId: str(body.ambassadorId, 64),
    note: str(body.note, 500),
    lang: str(body.lang, 5) || 'en',
  };

  if (r.name.length < 2) errors.name = 'required';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(r.email)) errors.email = 'invalid';
  if (!/^[A-Z]{2}$/.test(r.country)) errors.country = 'required';
  else if (RESTRICTED.has(r.country)) errors.country = 'restricted';
  if (!/^0x[0-9a-fA-F]{40}$/.test(r.wallet)) errors.wallet = 'invalid';
  if (!AMOUNTS.has(r.amount)) errors.amount = 'required';
  if (r.source && !SOURCES.has(r.source)) errors.source = 'invalid';
  if (r.telegram && !/^[A-Za-z0-9_]{4,32}$/.test(r.telegram)) errors.telegram = 'invalid';
  if (body.eligible !== true) errors.eligible = 'required';
  if (body.terms !== true) errors.terms = 'required';

  if (Object.keys(errors).length) {
    return { ok: false, status: 422, error: 'validation', fields: errors };
  }

  const id = 'SL-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2, 5).toUpperCase();
  return {
    ok: true,
    record: {
      id,
      receivedAt: new Date().toISOString(),
      ...r,
      ipCountry: meta.ipCountry || '',
      countryMismatch: Boolean(meta.ipCountry && meta.ipCountry !== r.country),
      userAgent: str(meta.userAgent, 200),
    },
  };
}

const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

function telegramText(rec) {
  const lines = [
    '<b>New $SL presale application</b> · <code>' + esc(rec.id) + '</code>',
    'Name: ' + esc(rec.name),
    'Email: ' + esc(rec.email),
    rec.telegram ? 'Telegram: @' + esc(rec.telegram) : null,
    'Country: ' + esc(rec.country) + (rec.ipCountry ? ' (IP ' + esc(rec.ipCountry) + (rec.countryMismatch ? ' - mismatch' : '') + ')' : ''),
    'Wallet: <code>' + esc(rec.wallet) + '</code>',
    'Amount: $' + esc(rec.amount) + ' USDT',
    rec.source ? 'Heard via: ' + esc(rec.source) : null,
    rec.ref ? 'Ambassador code: <b>' + esc(rec.ref) + '</b>' : null,
    rec.ambassadorId ? 'Ambassador app account: ' + esc(rec.ambassadorId) : null,
    rec.note ? 'Note: ' + esc(rec.note) : null,
    'Lang: ' + esc(rec.lang) + ' · ' + esc(rec.receivedAt),
  ];
  return lines.filter(Boolean).join('\n');
}

async function sendTelegram(rec) {
  const token = process.env.TELEGRAM_BOT_TOKEN, chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) return null;
  const res = await fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chat, text: telegramText(rec), parse_mode: 'HTML', disable_web_page_preview: true }),
  });
  if (!res.ok) throw new Error('telegram ' + res.status);
  return 'telegram';
}

async function sendSheet(rec) {
  const url = process.env.SHEETS_WEBHOOK_URL;
  if (!url) return null;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(rec),
    redirect: 'follow', // Apps Script web apps answer with a 302 to the result
  });
  if (!res.ok) throw new Error('sheet ' + res.status);
  return 'sheet';
}

function readJson(req) {
  if (req.body !== undefined) {
    if (typeof req.body === 'string') {
      try { return Promise.resolve(JSON.parse(req.body)); } catch (e) { return Promise.resolve(null); }
    }
    return Promise.resolve(req.body);
  }
  return new Promise(resolve => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > MAX_BODY) { resolve(null); req.destroy(); } });
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch (e) { resolve(null); } });
    req.on('error', () => resolve(null));
  });
}

function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(payload));
}

async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('allow', 'POST'); return send(res, 405, { ok: false, error: 'method' }); }

  // Same-origin only: the form lives on this deployment (production or preview).
  const origin = req.headers.origin;
  if (origin) {
    let host = '';
    try { host = new URL(origin).host; } catch (e) { host = ''; }
    if (host !== req.headers.host) return send(res, 403, { ok: false, error: 'origin' });
  }

  const configured = Boolean((process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) || process.env.SHEETS_WEBHOOK_URL);
  if (!configured) return send(res, 503, { ok: false, error: 'not_configured' });

  const body = await readJson(req);
  if (!body || typeof body !== 'object') return send(res, 400, { ok: false, error: 'body' });

  // Honeypot: bots fill every field. Pretend success and drop it.
  if (str(body.website, 10)) return send(res, 200, { ok: true, id: 'SL-OK' });

  const v = validate(body, {
    ipCountry: str(req.headers['x-vercel-ip-country'], 2).toUpperCase(),
    userAgent: req.headers['user-agent'],
  });
  if (!v.ok) return send(res, v.status, { ok: false, error: v.error, fields: v.fields });

  const results = await Promise.allSettled([sendTelegram(v.record), sendSheet(v.record)]);
  const delivered = results.filter(r => r.status === 'fulfilled' && r.value).map(r => r.value);
  if (!delivered.length) {
    const reason = results.map(r => (r.status === 'rejected' ? r.reason && r.reason.message : '')).filter(Boolean).join('; ');
    console.error('apply: no sink accepted the record', v.record.id, reason);
    return send(res, 502, { ok: false, error: 'delivery' });
  }
  return send(res, 200, { ok: true, id: v.record.id });
}

module.exports = handler;
module.exports.validate = validate;
module.exports.telegramText = telegramText;
module.exports.RESTRICTED = RESTRICTED;
