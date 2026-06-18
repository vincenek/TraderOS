// ══════════════════════════════════════════════════════════
//  TrafxOS — Firebase & Payments Configuration
//  Fill in your values, save, then redeploy.
// ══════════════════════════════════════════════════════════
//
//  HOW TO GET YOUR FIREBASE CONFIG:
//  1. Go to https://console.firebase.google.com/project/trader-os
//  2. Click the ⚙️ gear → Project Settings
//  3. Scroll to "Your apps" → click Web app (</>)
//  4. Copy the firebaseConfig object values below
//
// authDomain: use Netlify proxy on production (ISP blocks *.firebaseapp.com),
// but fall back to the real Firebase domain on localhost where the proxy doesn't run.
const _isLocalhost = ['localhost', '127.0.0.1'].includes(window.location.hostname);

window.FIREBASE_CONFIG = {
  apiKey:            'AIzaSyByv7zwSod9JCnYqUxC3Mb7VrPKihvjOHA',
  authDomain:        _isLocalhost ? 'trader-os.firebaseapp.com' : 'trafxos.netlify.app',
  projectId:         'trader-os',
  storageBucket:     'trader-os.firebasestorage.app',
  messagingSenderId: '879978387606',
  appId:             '1:879978387606:web:a37e5aa8075032b6294ab7',
  measurementId:     'G-BL4PJWJJCV',
};

// ══════════════════════════════════════════════════════════
//  FLUTTERWAVE PAYMENTS  (Nigeria-friendly)
//
//  ⚠️  IMPORTANT: The key MUST start with FLWPUBK_TEST- or FLWPUBK-
//  The UUID below is NOT valid — payment will NOT open until you replace it.
//
//  Steps to get your real key:
//    1. Go to https://dashboard.flutterwave.com
//    2. Settings → API Keys
//    3. Copy "Public Key" (starts with FLWPUBK_TEST- or FLWPUBK-)
//    4. Paste it below, save, and redeploy to Netlify
//
//  Only the PUBLIC key goes here — it is safe to expose.
//  Your Secret Key and Encryption Key are SERVER-SIDE only.
//  Never paste them in any frontend file.
// ══════════════════════════════════════════════════════════
window.FLW_PUBLIC_KEY   = 'FLWPUBK-5e59bbecccdf01432d01be0c1354209a-X';
window.FLW_MONTHLY_USD  = 19;
window.FLW_ANNUAL_USD   = 149;
window.FLW_CURRENCY     = 'USD';  // USD so international users can pay by card in dollars

// ══════════════════════════════════════════════════════════
//  PRO ACCESS CODES — now validated SERVER-SIDE only.
//  Codes are NO LONGER stored in this file. They used to be readable by anyone
//  who viewed the page source (a free-Pro hole). They now live in the Netlify
//  environment variable PRO_CODES (comma-separated) and are checked by the
//  redeem-code serverless function against the signed-in user.
//  Set/rotate them in Netlify → Site settings → Environment variables.
// ══════════════════════════════════════════════════════════
