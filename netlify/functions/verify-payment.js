/* POST /.netlify/functions/verify-payment
   Body: { transactionId, plan }   Header: Authorization: Bearer <Firebase ID token>

   Verifies a Flutterwave transaction server-side with the SECRET key, checks the
   amount/currency, prevents one payment unlocking multiple accounts, then grants
   Pro by writing users/{uid}.pro = true (a write only the Admin SDK can do). */
const { getAdmin, json, requireUser } = require('./_admin');

const PRICES = { monthly: 19, annual: 149 }; // keep in sync with firebase-config.js / upgrade modal

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  try {
    const uid = await requireUser(event);
    const { transactionId, plan } = JSON.parse(event.body || '{}');
    if (!transactionId) return json(400, { error: 'Missing transactionId' });

    const secret = process.env.FLW_SECRET_KEY;
    if (!secret) return json(500, { error: 'Payment verification not configured (FLW_SECRET_KEY missing)' });

    // 1) Verify the transaction directly with Flutterwave
    const flwRes = await fetch(
      `https://api.flutterwave.com/v3/transactions/${encodeURIComponent(transactionId)}/verify`,
      { headers: { Authorization: `Bearer ${secret}` } }
    );
    const flw = await flwRes.json().catch(() => ({}));
    const tx = flw && flw.data;
    if (flw.status !== 'success' || !tx || tx.status !== 'successful') {
      return json(402, { pro: false, error: 'Payment could not be verified' });
    }

    // 2) Validate amount + currency so a $1 payment can't unlock a $149 plan
    const planKey = plan === 'annual' ? 'annual' : 'monthly';
    const expected = PRICES[planKey];
    const currency = process.env.FLW_CURRENCY || 'USD';
    if (Number(tx.amount) < expected || tx.currency !== currency) {
      return json(402, { pro: false, error: 'Payment amount or currency did not match' });
    }

    const admin = getAdmin();
    const db = admin.firestore();

    // 3) Block reuse: a given transaction can only ever grant Pro to one account
    const payRef = db.doc(`payments/${transactionId}`);
    const paySnap = await payRef.get();
    if (paySnap.exists && paySnap.data().uid !== uid) {
      return json(409, { pro: false, error: 'This transaction has already been redeemed' });
    }

    // 4) Grant Pro
    await payRef.set({ uid, plan: planKey, amount: Number(tx.amount), at: admin.firestore.FieldValue.serverTimestamp() });
    await db.doc(`users/${uid}`).set({
      pro: true,
      plan: planKey,
      proSince: admin.firestore.FieldValue.serverTimestamp(),
      source: 'flutterwave',
      txId: String(transactionId),
      txRef: tx.tx_ref || '',
    }, { merge: true });

    return json(200, { pro: true, plan: planKey });
  } catch (err) {
    return json(err.statusCode || 500, { error: err.message || 'Server error' });
  }
};
