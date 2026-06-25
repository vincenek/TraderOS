/* POST /.netlify/functions/ingest-trade
   Called by the MetaTrader EA (not a browser) on each closed trade.
   Auth is via the per-user ingest key (no Firebase token — an EA can't do Firebase auth).
   Body: { key, ticket, symbol, type, volume, profit, entry, exit, sl, tp, openTime, platform } */
const { getAdmin, json } = require('./_admin');

const PAIRS = {
  EURUSD: 'EUR/USD', GBPUSD: 'GBP/USD', USDJPY: 'USD/JPY', USDCHF: 'USD/CHF',
  AUDUSD: 'AUD/USD', NZDUSD: 'NZD/USD', USDCAD: 'USD/CAD', EURGBP: 'EUR/GBP',
  EURJPY: 'EUR/JPY', GBPJPY: 'GBP/JPY', XAUUSD: 'XAU/USD', XAGUSD: 'XAG/USD',
  BTCUSD: 'BTC/USD', ETHUSD: 'ETH/USD', NAS100: 'NAS100', US30: 'US30',
  USTEC: 'NAS100', US500: 'SPX500',
};
const normInstrument = (raw) => {
  const s = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return PAIRS[s] || (raw ? String(raw).toUpperCase() : 'UNKNOWN');
};
const guessSession = (dt) => {
  try { const h = new Date(dt).getUTCHours(); return h < 7 ? 'Asia' : h < 12 ? 'London' : h < 16 ? 'Overlap' : 'NY'; }
  catch (_) { return ''; }
};
const num = (v) => (v === undefined || v === null || v === '' ? null : Number(v));

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });
  try {
    const body = JSON.parse(event.body || '{}');
    const key = body.key || event.headers['x-trafxos-key'];
    if (!key) return json(401, { error: 'Missing key' });

    const admin = getAdmin();
    const db = admin.firestore();
    const keySnap = await db.doc(`ingestKeys/${key}`).get();
    if (!keySnap.exists) return json(403, { error: 'Invalid key' });
    const uid = keySnap.data().uid;

    const ticket = String(body.ticket || '').replace(/[^A-Za-z0-9_-]/g, '');
    if (!ticket) return json(400, { error: 'Missing ticket' });
    const type = String(body.type || '').toLowerCase();
    if (!type.includes('buy') && !type.includes('sell')) return json(200, { skipped: true });

    const col = db.collection(`users/${uid}/trades`);
    const docId = `mtlive_${ticket}`;
    if ((await col.doc(docId).get()).exists) return json(200, { duplicate: true });

    const pnl = num(body.profit) || 0;
    const entry = num(body.entry), exit = num(body.exit), sl = num(body.sl), tp = num(body.tp);
    let rr = null;
    if (entry && sl && (tp || exit)) {
      const risk = Math.abs(entry - sl), rew = Math.abs((tp || exit) - entry);
      if (risk > 0) rr = parseFloat((rew / risk).toFixed(2));
    }
    const datetime = body.openTime
      ? String(body.openTime).replace(/\./g, '-').replace(/\s/, 'T').slice(0, 16)
      : new Date().toISOString().slice(0, 16);

    const trade = {
      id: docId,
      ticket,
      instrument: normInstrument(body.symbol),
      direction: type.includes('buy') ? 'LONG' : 'SHORT',
      outcome: pnl > 0 ? 'WIN' : pnl < 0 ? 'LOSS' : 'BE',
      session: guessSession(datetime),
      emotion: null, setupQuality: null, mistakes: [],
      rules: { plan: false, sl: !!sl, rr: false, session: false, size: false },
      entry, exit, sl, tp, rr, pnl,
      lotSize: num(body.volume),
      notes: `Live from ${(body.platform || 'MT').toUpperCase()} · Ticket #${ticket}`,
      screenshot: '',
      datetime,
      createdAt: new Date().toISOString(),
      source: 'mt-live',
    };
    await col.doc(docId).set(trade);
    return json(200, { ok: true });
  } catch (err) {
    return json(err.statusCode || 500, { error: err.message || 'Server error' });
  }
};
