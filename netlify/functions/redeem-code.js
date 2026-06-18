/* POST /.netlify/functions/redeem-code
   Body: { code }   Header: Authorization: Bearer <Firebase ID token>

   Validates a Pro access code against the server-side PRO_CODES env var (codes are
   NEVER shipped to the browser anymore) and grants Pro to the signed-in user. */
const { getAdmin, json, requireUser } = require('./_admin');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  try {
    const uid = await requireUser(event);
    const { code } = JSON.parse(event.body || '{}');
    const norm = (code || '').toUpperCase().trim();
    if (!norm) return json(400, { error: 'Missing code' });

    // PRO_CODES env var: comma-separated, e.g. "TRAFXOS-KENE,TRAFXOS-BETA-2026"
    const valid = (process.env.PRO_CODES || '')
      .split(',').map(c => c.trim().toUpperCase()).filter(Boolean);
    if (!valid.includes(norm)) {
      return json(403, { pro: false, error: 'Invalid code' });
    }

    const admin = getAdmin();
    await admin.firestore().doc(`users/${uid}`).set({
      pro: true,
      plan: 'code',
      proSince: admin.firestore.FieldValue.serverTimestamp(),
      source: 'code',
      code: norm,
    }, { merge: true });

    return json(200, { pro: true });
  } catch (err) {
    return json(err.statusCode || 500, { error: err.message || 'Server error' });
  }
};
