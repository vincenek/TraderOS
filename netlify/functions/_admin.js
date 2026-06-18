/* Shared Firebase Admin initialiser for Netlify Functions.
   Requires the FIREBASE_SERVICE_ACCOUNT env var (the full service-account JSON,
   pasted as a single line) set in Netlify → Site settings → Environment variables. */
const admin = require('firebase-admin');

function getAdmin() {
  if (!admin.apps.length) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT env var is not set');
    const svc = JSON.parse(raw);
    // Private keys often get their newlines escaped when stored as an env var.
    if (svc.private_key) svc.private_key = svc.private_key.replace(/\\n/g, '\n');
    admin.initializeApp({ credential: admin.cert(svc) });
  }
  return admin;
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

/* Verify the caller's Firebase ID token (sent as `Authorization: Bearer <token>`)
   and return their uid. Throws if missing/invalid. */
async function requireUser(event) {
  const admin = getAdmin();
  const header = event.headers.authorization || event.headers.Authorization || '';
  const idToken = header.replace(/^Bearer\s+/i, '').trim();
  if (!idToken) { const e = new Error('Sign in required'); e.statusCode = 401; throw e; }
  try {
    const decoded = await admin.auth().verifyIdToken(idToken);
    return decoded.uid;
  } catch (_) {
    const e = new Error('Invalid or expired session — sign in again'); e.statusCode = 401; throw e;
  }
}

module.exports = { getAdmin, json, requireUser };
