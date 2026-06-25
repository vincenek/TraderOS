/* POST /.netlify/functions/link-terminal   Header: Authorization: Bearer <Firebase ID token>
   Issues (or returns the existing) per-user ingest key used by the MetaTrader EA to
   stream trades in. The key maps back to the user via ingestKeys/{key} (server-only). */
const { getAdmin, json, requireUser } = require('./_admin');
const crypto = require('crypto');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });
  try {
    const uid = await requireUser(event);
    const admin = getAdmin();
    const db = admin.firestore();
    const userRef = db.doc(`users/${uid}`);
    const snap = await userRef.get();

    let key = snap.exists ? snap.data().ingestKey : null;
    if (!key) {
      key = 'tjx_' + crypto.randomBytes(24).toString('hex');
      await db.doc(`ingestKeys/${key}`).set({ uid, createdAt: admin.firestore.FieldValue.serverTimestamp() });
      await userRef.set({ ingestKey: key }, { merge: true });
    }

    const base = process.env.URL || ('https://' + (event.headers.host || 'trafxos.netlify.app'));
    return json(200, { key, endpoint: `${base}/.netlify/functions/ingest-trade` });
  } catch (err) {
    return json(err.statusCode || 500, { error: err.message || 'Server error' });
  }
};
