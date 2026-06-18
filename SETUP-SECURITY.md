# TrafxOS — Required setup to make payments work & secure

The app now treats **the server as the source of truth for Pro**. Until the steps
below are done, *nobody can upgrade to Pro* (the verify/redeem functions need
secrets) and the Firestore lockdown isn't active. Do all 5.

## 1. Netlify environment variables
Netlify → your site → **Site configuration → Environment variables** → add:

| Key | Value |
|-----|-------|
| `FLW_SECRET_KEY` | Your Flutterwave **secret** key (Flutterwave Dashboard → Settings → API Keys, starts with `FLWSECK-`). **Never** put this in any frontend file. |
| `FIREBASE_SERVICE_ACCOUNT` | The **entire** service-account JSON, pasted as one value. Get it from Firebase Console → Project settings → **Service accounts** → *Generate new private key*. |
| `PRO_CODES` | Comma-separated access codes, e.g. `TRAFXOS-KENE,TRAFXOS-BETA-2026,TRAFXOS-VIP-2026,TRAFXOS-EARLY-2026` |
| `FLW_CURRENCY` | `USD` (optional; defaults to USD) |

After adding them, trigger a redeploy so the functions pick them up.

## 2. Real Flutterwave PUBLIC key
In `firebase-config.js`, set `window.FLW_PUBLIC_KEY` to your real **public** key
(starts with `FLWPUBK-` or `FLWPUBK_TEST-`). The public key is safe to ship; the
secret key is not. Keep the amounts in `verify-payment.js` (`PRICES`) in sync with
`FLW_MONTHLY_USD` / `FLW_ANNUAL_USD`.

## 3. Deploy the Firestore security rules  ← this is the anti-hack step
The file `firestore.rules` makes the Pro flag **read-only to clients and writable
only by the server**. It must be published or the lockdown does nothing.

Easiest (given the TLS/proxy issues with CLIs on this network): Firebase Console →
**Firestore Database → Rules** → paste the contents of `firestore.rules` → Publish.

(Or, if Firebase CLI works for you: `firebase deploy --only firestore:rules`.)

## 4. Make sure Firestore is enabled
Firebase Console → **Firestore Database** → Create database (production mode) if you
haven't already. Trades, the `users/{uid}.pro` flag, and the `payments` ledger live here.

## 5. Firebase authorized domains
Firebase Console → Authentication → Settings → **Authorized domains** → ensure
`trafxos.netlify.app` and `localhost` are listed (needed for sign-in, incl. the new
password-reset email and Google sign-in).

---

## How the security model works now
- Payment success is **verified on our server** against Flutterwave's API with the
  secret key — the browser saying "successful" is no longer trusted.
- The Pro flag is written **only by the Admin SDK** (Netlify functions). Firestore
  rules forbid clients from writing it, so a user can't grant themselves Pro.
- A given transaction can unlock **one** account (payments ledger prevents reuse).
- Access codes are **no longer shipped to the browser** — they live in `PRO_CODES`
  on the server and are validated per signed-in user.
- Pro is **tied to an account**, so checkout/redeem require sign-in.

### Honest limitation
Because Pro features are computed in the browser, a developer-level user could still
patch the running JavaScript locally to *show* Pro UI on their own device. What this
design fully prevents is the stuff that actually costs you money: faking payments,
harvesting codes from page source, and writing a Pro flag to the database. For a
journal app that's the right trade-off; truly tamper-proof would require moving the
paid computations server-side.
