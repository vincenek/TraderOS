/* ═══════════════════════════════════════════════════════════
   TrafxOS — Full Application Logic
   Architecture: Vanilla JS, localStorage, Chart.js
   No external dependencies beyond what's in index.html
═══════════════════════════════════════════════════════════ */

'use strict';

/* ────────────────────────────────────────────────────────────
   MODULE-LEVEL STATE
──────────────────────────────────────────────────────────── */
let deferredInstallPrompt = null; // holds the beforeinstallprompt event

/* ────────────────────────────────────────────────────────────
   STATE & STORAGE
──────────────────────────────────────────────────────────── */
const DB = {
  get trades()    { return JSON.parse(localStorage.getItem('trafxos_trades') || '[]'); },
  set trades(v)   { localStorage.setItem('trafxos_trades', JSON.stringify(v)); },
  get settings()  { return JSON.parse(localStorage.getItem('trafxos_settings') || '{}'); },
  set settings(v) { localStorage.setItem('trafxos_settings', JSON.stringify(v)); },
  get challenges(){ return JSON.parse(localStorage.getItem('trafxos_challenges') || '[]'); },
  set challenges(v){ localStorage.setItem('trafxos_challenges', JSON.stringify(v)); },
  get checkins()  { return JSON.parse(localStorage.getItem('trafxos_checkins') || '[]'); },
  set checkins(v) { localStorage.setItem('trafxos_checkins', JSON.stringify(v)); },
  get onboarded() { return localStorage.getItem('trafxos_onboarded') === '1'; },
  set onboarded(v){ localStorage.setItem('trafxos_onboarded', v ? '1' : '0'); },
};

/* ────────────────────────────────────────────────────────────
   FORM STATE
──────────────────────────────────────────────────────────── */
const formState = {
  instrument: 'EUR/USD',
  direction: 'LONG',
  outcome: 'WIN',
  session: 'London',
  emotion: null,
  setupQuality: null,
  mistakes: new Set(),
  editingTradeId: null,
};

/* ────────────────────────────────────────────────────────────
   CHARTS
──────────────────────────────────────────────────────────── */
const charts = {};

Chart.defaults.color = '#64748b';
Chart.defaults.borderColor = '#1f2d45';
Chart.defaults.font.family = "'Inter', system-ui, sans-serif";

/* ────────────────────────────────────────────────────────────
   PRO TIER SYSTEM
──────────────────────────────────────────────────────────── */
const PRO = {
  FREE_LIMIT: 30,

  get active() {
    return localStorage.getItem('trafxos_pro') === '1';
  },

  activate(code) {
    if (!code) return false;
    const norm = code.toUpperCase().trim();
    const validCodes = new Set((window.PRO_CODES || []).map(c => c.toUpperCase()));
    if (validCodes.has(norm)) {
      localStorage.setItem('trafxos_pro', '1');
      localStorage.setItem('trafxos_pro_code', norm);
      return true;
    }
    return false;
  },

  canLog()     { return this.active || DB.trades.length < this.FREE_LIMIT; },
  canAnalyze() { return this.active; },
  canLesson()  { return this.active; },
  canExport()  { return this.active || DB.trades.length <= 10; },
};

function showUpgradeModal(featureName) {
  const row = document.getElementById('upgradeFeatureRow');
  const nameEl = document.getElementById('upgradeFeatureName');
  if (row && nameEl) {
    nameEl.textContent = featureName || 'This feature';
    row.classList.remove('hidden');
  }
  // Auto-fill email/name if user is signed in
  const u = FIREBASE.user;
  if (u) {
    const emailEl = document.getElementById('checkoutEmail');
    const nameInput = document.getElementById('checkoutName');
    if (emailEl && !emailEl.value && u.email) emailEl.value = u.email;
    if (nameInput && !nameInput.value && u.displayName) nameInput.value = u.displayName;
  }
  // Show payment setup notice if Flutterwave key is not a real FLWPUBK key
  const pubKey = (window.FLW_PUBLIC_KEY || '').trim();
  const keyReady = pubKey.toUpperCase().startsWith('FLWPUBK');
  document.getElementById('flwSetupNotice')?.classList.toggle('hidden', keyReady);
  // Disable the checkout button when key not configured (Pro key still works)
  const checkoutBtn = document.getElementById('upgradeCheckoutBtn');
  if (checkoutBtn) checkoutBtn.disabled = !keyReady;
  showModal('upgradeModal');
}

function updateProUI() {
  const proCrownBtn = document.getElementById('proCrownBtn');
  if (proCrownBtn) proCrownBtn.classList.toggle('hidden', !PRO.active);
  const authProPill = document.getElementById('authProPill');
  if (authProPill) {
    authProPill.textContent = PRO.active ? 'PRO' : 'FREE';
    authProPill.classList.toggle('pro-active', PRO.active);
  }
}

/* Comprehensive Pro activation — call after payment or key entry */
function activateProFull() {
  localStorage.setItem('trafxos_pro', '1');
  updateProUI();
  renderFreeLimitBar();
  renderDashboard();
  // Remove lock icons from analytics tabs
  document.querySelectorAll('.tab-lock-icon').forEach(el => el.remove());
  // Refresh current views
  if (activeView === 'analytics')   renderAnalytics();
  if (activeView === 'psychology')  initPsychologyLab();
  if (activeView === 'journal')     renderJournal();
}

function renderFreeLimitBar() {
  const bar = document.getElementById('freeLimitBar');
  if (!bar) return;
  if (PRO.active) { bar.classList.add('hidden'); return; }
  bar.classList.remove('hidden');
  const used = DB.trades.length;
  document.getElementById('flbUsed').textContent = used;
  const pct = Math.min(100, (used / PRO.FREE_LIMIT) * 100);
  const barEl = document.getElementById('flbBar');
  barEl.style.width = `${pct}%`;
  barEl.style.background = pct >= 90 ? 'var(--red)' : pct >= 70 ? 'var(--yellow)' : 'var(--accent)';
}

/* ────────────────────────────────────────────────────────────
   FIREBASE INTEGRATION (optional — works without config)
──────────────────────────────────────────────────────────── */
const FIREBASE = {
  auth: null,
  db: null,
  user: null,

  init() {
    const cfg = window.FIREBASE_CONFIG;
    if (!cfg || cfg.apiKey === 'PASTE_API_KEY' || !window.firebase) return;
    try {
      if (!firebase.apps.length) firebase.initializeApp(cfg);
      this.auth = firebase.auth();
      this.db   = firebase.firestore();
      // Init Analytics if measurementId present
      if (cfg.measurementId && firebase.analytics) firebase.analytics();
      this.auth.onAuthStateChanged(user => {
        this.user = user;
        this.updateAuthUI(user);
        if (user) this.syncTrades();
      });
      // Handle the result when Google redirects back (mobile auth flow)
      this.auth.getRedirectResult().then(result => {
        if (result && result.user) {
          hideModal('authModal');
          toast('Signed in with Google! Syncing your trades…', 'success');
        }
      }).catch(err => {
        const code = err.code || '';
        if (!code || code === 'auth/no-such-provider') return; // nothing happened
        if (code === 'auth/unauthorized-domain') {
          const errEl = document.getElementById('googleAuthError');
          if (errEl) {
            errEl.innerHTML = `
              <strong>⚠️ One quick setup step needed:</strong><br>
              Add <code>trafxos.netlify.app</code> to Firebase → Authentication → Settings → Authorized domains, then try again.
              <div class="auth-error-alt">⭐ <strong>Email sign-in works right now</strong> — use the fields below while you set this up.</div>
            `;
            errEl.classList.remove('hidden');
          }
        } else if (code !== 'auth/popup-closed-by-user' && code !== 'auth/cancelled-popup-request') {
          toast('Google sign-in failed: ' + (err.message || code), 'error', 5000);
        }
      });
    } catch (err) {
      console.warn('[TrafxOS] Firebase init skipped:', err.message);
    }
  },

  async signInWithGoogle() {
    // Clear any previous inline error
    const errEl = document.getElementById('googleAuthError');
    if (errEl) errEl.classList.add('hidden');

    if (!this.auth) {
      toast('Firebase not configured. Fill in firebase-config.js to enable sign-in.', 'warn', 5000);
      return;
    }
    try {
      const provider = new firebase.auth.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });

      // Mobile browsers block popups — redirect to Google instead so we don't get a blank page
      const isMobile = /android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent);
      if (isMobile) {
        await this.auth.signInWithRedirect(provider);
        return; // page redirects — getRedirectResult() in init() handles the response
      }

      // Desktop: popup works fine
      await this.auth.signInWithPopup(provider);
      hideModal('authModal');
      toast('Signed in! Syncing your trades…', 'success');
    } catch (err) {
      const code = err.code || '';
      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return;
      if (code === 'auth/unauthorized-domain') {
        if (errEl) {
          errEl.innerHTML = `
            <strong>⚠️ One quick setup step needed:</strong><br>
            Google sign-in is blocked because <code>trafxos.netlify.app</code> isn't yet in your Firebase allowed list.<br>
            <ol>
              <li>Go to <strong>Firebase Console</strong> → your project (trader-os)</li>
              <li>Click <strong>Authentication</strong> → <strong>Settings</strong> tab</li>
              <li>Scroll to <strong>Authorized domains</strong> → <strong>Add domain</strong></li>
              <li>Type <code>trafxos.netlify.app</code> and save</li>
              <li>Come back and tap "Continue with Google" again</li>
            </ol>
            <div class="auth-error-alt">⭐ <strong>Email sign-in works right now</strong> — use the fields below while you set this up.</div>
          `;
          errEl.classList.remove('hidden');
        } else {
          toast(
            'Google sign-in blocked: add trafxos.netlify.app to Firebase → Authentication → Settings → Authorized domains.',
            'error', 10000
          );
        }
      } else if (code === 'auth/popup-blocked') {
        toast('Pop-up was blocked. Allow pop-ups for this site in your browser settings, then try again.', 'warn', 6000);
      } else {
        toast('Google sign-in failed: ' + (err.message || code), 'error', 5000);
      }
    }
  },

  async signInWithEmail(email, pw) {
    if (!this.auth) { toast('Firebase not configured.', 'warn'); return; }
    try {
      await this.auth.signInWithEmailAndPassword(email, pw);
      hideModal('authModal');
      toast('Signed in!', 'success');
    } catch (err) { toast(err.message, 'error', 5000); }
  },

  async signUp(email, pw) {
    if (!this.auth) { toast('Firebase not configured.', 'warn'); return; }
    try {
      await this.auth.createUserWithEmailAndPassword(email, pw);
      hideModal('authModal');
      toast('Account created! Welcome to TrafxOS.', 'success');
    } catch (err) { toast(err.message, 'error', 5000); }
  },

  async signOut() {
    if (!this.auth) return;
    await this.auth.signOut();
    toast('Signed out.', 'info');
    hideModal('authModal');
  },

  async syncTrades() {
    if (!this.user || !this.db) return;
    const syncText = document.getElementById('syncStatusText');
    const syncIcon = document.getElementById('syncIcon');
    if (syncIcon) { syncIcon.className = 'fa-solid fa-rotate'; syncIcon.style.animation = 'spin 1s linear infinite'; }
    if (syncText) syncText.textContent = 'Syncing…';
    try {
      const trades = DB.trades;
      const batch = this.db.batch();
      for (const t of trades) {
        const ref = this.db.collection(`users/${this.user.uid}/trades`).doc(t.id);
        batch.set(ref, t, { merge: true });
      }
      await batch.commit();
      if (syncIcon) { syncIcon.className = 'fa-solid fa-cloud-check'; syncIcon.style.animation = 'none'; }
      if (syncText) syncText.textContent = `${trades.length} trades synced`;
    } catch (err) {
      if (syncText) syncText.textContent = 'Sync error — check connection.';
    }
  },

  updateAuthUI(user) {
    const authBtn = document.getElementById('authBtn');
    const signedOutEl = document.getElementById('authSignedOut');
    const signedInEl  = document.getElementById('authSignedIn');
    if (!authBtn) return;
    if (user) {
      authBtn.innerHTML = '<i class="fa-solid fa-user-check" style="color:var(--green)"></i>';
      signedOutEl?.classList.add('hidden');
      signedInEl?.classList.remove('hidden');
      const el = id => document.getElementById(id);
      if (el('authUserName'))  el('authUserName').textContent  = user.displayName || 'Trader';
      if (el('authUserEmail')) el('authUserEmail').textContent = user.email || '';
      if (el('authAvatarEl'))  el('authAvatarEl').textContent  = (user.displayName || user.email || '?')[0].toUpperCase();
    } else {
      authBtn.innerHTML = '<i class="fa-solid fa-user"></i>';
      signedOutEl?.classList.remove('hidden');
      signedInEl?.classList.add('hidden');
    }
  },
};

/* ────────────────────────────────────────────────────────────
   UTILITIES
──────────────────────────────────────────────────────────── */
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

const CURRENCY_SYMBOLS = { USD: '$', GBP: '£', EUR: '€', NGN: '₦', JPY: '¥', CAD: 'C$', AUD: 'A$', CHF: 'Fr' };

function fmt(n, currency = true) {
  if (n === null || n === undefined || isNaN(n)) return '—';
  const abs = Math.abs(n);
  const str = abs >= 1000 ? abs.toLocaleString('en-US', { maximumFractionDigits: 0 }) : abs.toFixed(2);
  const sign = n >= 0 ? '+' : '-';
  if (!currency) return `${sign}${str}`;
  const sym = CURRENCY_SYMBOLS[(DB.settings.currency || 'USD').toUpperCase()] || '$';
  return `${sign}${sym}${str}`;
}

function fmtPct(n) {
  if (n === null || n === undefined || isNaN(n)) return '—';
  return `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;
}

function fmtDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtDateTime(iso) {
  const d = new Date(iso);
  return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function clamp(val, min, max) { return Math.min(Math.max(val, min), max); }

function toast(msg, type = 'info', duration = 3000) {
  const c = document.getElementById('toastContainer');
  const el = document.createElement('div');
  el.className = `toast ${type === 'success' ? 'toast-success' : type === 'error' ? 'toast-error' : type === 'warn' ? 'toast-warn' : ''}`;
  const icon = type === 'success' ? '✓' : type === 'error' ? '✕' : type === 'warn' ? '⚠' : 'ℹ';
  el.innerHTML = `<span>${icon}</span><span>${sanitize(msg)}</span>`;
  c.appendChild(el);
  setTimeout(() => {
    el.classList.add('toast-fade');
    setTimeout(() => el.remove(), 350);
  }, duration);
}

function sanitize(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

function showModal(id) { document.getElementById(id).classList.remove('hidden'); }
function hideModal(id) { document.getElementById(id).classList.add('hidden'); }

function setEl(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function colorByValue(val) {
  if (!val || isNaN(val)) return '';
  return val > 0 ? 'var(--green)' : val < 0 ? 'var(--red)' : 'var(--text-2)';
}

/* ────────────────────────────────────────────────────────────
   ANALYTICS CALCULATIONS
──────────────────────────────────────────────────────────── */
function calcStats(trades) {
  if (!trades.length) return null;
  const closed = trades.filter(t => t.pnl !== null && t.pnl !== undefined);
  const wins  = closed.filter(t => t.outcome === 'WIN');
  const losses= closed.filter(t => t.outcome === 'LOSS');
  const totalPnl = closed.reduce((s, t) => s + (parseFloat(t.pnl) || 0), 0);
  const winRate = closed.length ? (wins.length / closed.length) * 100 : 0;
  const avgWin  = wins.length  ? wins.reduce((s, t) => s + parseFloat(t.pnl), 0) / wins.length : 0;
  const avgLoss = losses.length ? Math.abs(losses.reduce((s, t) => s + parseFloat(t.pnl), 0) / losses.length) : 0;
  const rrArr   = closed.filter(t => t.rr && t.rr > 0).map(t => t.rr);
  const avgRR   = rrArr.length ? rrArr.reduce((a, b) => a + b, 0) / rrArr.length : null;
  const pf      = avgLoss > 0 ? (avgWin * wins.length) / (avgLoss * losses.length) : null;
  const expectancy = closed.length ? (winRate / 100) * avgWin - (1 - winRate / 100) * avgLoss : null;

  // Max drawdown
  let peak = 0, maxDD = 0, running = 0;
  closed.sort((a, b) => new Date(a.datetime) - new Date(b.datetime));
  for (const t of closed) {
    running += parseFloat(t.pnl) || 0;
    if (running > peak) peak = running;
    const dd = peak - running;
    if (dd > maxDD) maxDD = dd;
  }

  // Day PnL
  const dayMap = {};
  for (const t of closed) {
    const d = (t.datetime || '').slice(0, 10);
    dayMap[d] = (dayMap[d] || 0) + (parseFloat(t.pnl) || 0);
  }
  const dayVals = Object.values(dayMap);
  const bestDay  = dayVals.length ? Math.max(...dayVals) : null;
  const worstDay = dayVals.length ? Math.min(...dayVals) : null;

  return { totalPnl, winRate, avgWin, avgLoss, avgRR, pf, expectancy, maxDD, bestDay, worstDay, wins, losses, closed, dayMap };
}

function calcDisciplineScore(trades) {
  if (!trades.length) return null;
  const recent = trades.slice(-30);
  let score = 0, total = 0;
  for (const t of recent) {
    if (t.rules) {
      const keys = Object.keys(t.rules);
      const followed = keys.filter(k => t.rules[k]).length;
      score += followed / keys.length;
      total++;
    }
    if (t.setupQuality) {
      score += t.setupQuality / 5;
      total++;
    }
  }
  return total > 0 ? Math.round((score / total) * 100) : null;
}

function calcEmotionIQ(trades) {
  if (trades.length < 3) return null;
  const negEmotions = ['revenge', 'frustrated', 'anxious', 'fomo', 'tired', 'bored'];
  const recent = trades.slice(-10);
  let score = 0;
  for (const t of recent) {
    if (t.emotion && negEmotions.includes(t.emotion)) {
      score += t.outcome === 'LOSS' ? 0 : (t.outcome === 'WIN' ? 1.5 : 0.5);
    } else if (t.emotion) {
      score += t.outcome === 'WIN' ? 1 : (t.outcome === 'LOSS' ? 0.3 : 0.7);
    }
  }
  return Math.min(100, Math.round((score / recent.length) * 20));
}

function calcStreaks(trades) {
  let currentWin = 0, currentLoss = 0, maxWin = 0, maxLoss = 0;
  const sorted = [...trades].sort((a, b) => new Date(a.datetime) - new Date(b.datetime));
  for (const t of sorted) {
    if (t.outcome === 'WIN')  { currentWin++; currentLoss = 0; maxWin = Math.max(maxWin, currentWin); }
    else if (t.outcome === 'LOSS') { currentLoss++; currentWin = 0; maxLoss = Math.max(maxLoss, currentLoss); }
    else { currentWin = 0; currentLoss = 0; }
  }
  return { currentWin, currentLoss, maxWin, maxLoss };
}

function tradesForPeriod(trades, days) {
  if (days === 'all') return trades;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  return trades.filter(t => t.datetime && new Date(t.datetime) >= cutoff);
}

function generateInsights(trades) {
  const insights = [];
  if (trades.length < 3) return insights;
  const stats = calcStats(trades);
  if (!stats) return insights;

  // Revenge trading detection
  const sorted = [...trades].sort((a, b) => new Date(a.datetime) - new Date(b.datetime));
  let lossStreak = 0;
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i].outcome === 'LOSS') {
      lossStreak++;
      if (lossStreak >= 2 && i + 1 < sorted.length) {
        const next = sorted[i + 1];
        if (next && next.emotion === 'revenge') {
          insights.push({ type: 'danger', icon: '🔥', title: 'Revenge Trading Pattern', body: 'You tend to enter trades while feeling vengeful after losses. These trades show lower win rates. Consider a mandatory cool-down rule after 2 consecutive losses.' });
          break;
        }
      }
    } else { lossStreak = 0; }
  }

  // FOMO bias
  const fomoTrades = trades.filter(t => t.emotion === 'fomo');
  if (fomoTrades.length >= 2) {
    const fomoWR = fomoTrades.filter(t => t.outcome === 'WIN').length / fomoTrades.length;
    if (fomoWR < 0.4) {
      insights.push({ type: 'warning', icon: '😱', title: 'FOMO is Costing You', body: `Your FOMO trades win only ${Math.round(fomoWR * 100)}% of the time vs your overall ${Math.round(stats.winRate)}%. You lose more when chasing the market.` });
    }
  }

  // Best emotion
  const emotionPnl = {};
  for (const t of trades) {
    if (t.emotion && t.pnl != null) {
      if (!emotionPnl[t.emotion]) emotionPnl[t.emotion] = [];
      emotionPnl[t.emotion].push(parseFloat(t.pnl) || 0);
    }
  }
  let bestEmo = null, bestEmoAvg = -Infinity;
  for (const [e, pnls] of Object.entries(emotionPnl)) {
    const avg = pnls.reduce((a, b) => a + b, 0) / pnls.length;
    if (pnls.length >= 2 && avg > bestEmoAvg) { bestEmoAvg = avg; bestEmo = e; }
  }
  if (bestEmo) {
    insights.push({ type: 'success', icon: '🏆', title: `Trade More When You're ${bestEmo.charAt(0).toUpperCase() + bestEmo.slice(1)}`, body: `Your best average P&L (${fmt(bestEmoAvg)}/trade) comes when you feel ${bestEmo}. Protect this state — don't trade when you're not in it.` });
  }

  // Win rate by session
  const sessionPnl = {};
  for (const t of trades) {
    if (t.session) {
      if (!sessionPnl[t.session]) sessionPnl[t.session] = { wins: 0, total: 0 };
      sessionPnl[t.session].total++;
      if (t.outcome === 'WIN') sessionPnl[t.session].wins++;
    }
  }
  let worstSession = null, worstWR = 1;
  for (const [s, d] of Object.entries(sessionPnl)) {
    const wr = d.total >= 3 ? d.wins / d.total : 1;
    if (wr < worstWR) { worstWR = wr; worstSession = s; }
  }
  if (worstSession && worstWR < 0.35) {
    insights.push({ type: 'warning', icon: '⏰', title: `Avoid the ${worstSession} Session`, body: `You only win ${Math.round(worstWR * 100)}% of trades during the ${worstSession} session. Consider removing it from your schedule or reducing size.` });
  }

  // Positive expectancy
  if (stats.expectancy > 0 && trades.length >= 10) {
    insights.push({ type: 'success', icon: '✅', title: 'Positive Expectancy System', body: `Your system has a positive expectancy of ${fmt(stats.expectancy)}/trade. Keep following your rules — the edge compounds over time.` });
  }

  // Max drawdown warning
  const settings = DB.settings;
  if (settings.startingBalance && stats.maxDD > 0) {
    const ddPct = (stats.maxDD / parseFloat(settings.startingBalance)) * 100;
    if (ddPct > 10) {
      insights.push({ type: 'danger', icon: '📉', title: 'Drawdown Warning', body: `Your max drawdown is ${ddPct.toFixed(1)}% of your starting balance. Consider reviewing position sizing and daily loss limits.` });
    }
  }

  // Min R:R warning from settings
  if (settings.minRR && stats.avgRR && stats.avgRR < parseFloat(settings.minRR)) {
    insights.push({ type: 'warning', icon: '📐', title: 'Below Your R:R Target', body: `Your average R:R (${stats.avgRR.toFixed(2)}) is below your minimum target of ${parseFloat(settings.minRR).toFixed(1)}. Only take setups that meet your criteria.` });
  }

  // Max daily trades warning
  if (settings.maxDailyTrades) {
    const todayStr = new Date().toISOString().slice(0, 10);
    const todayCount = trades.filter(t => (t.datetime || '').startsWith(todayStr)).length;
    if (todayCount >= parseInt(settings.maxDailyTrades)) {
      insights.push({ type: 'danger', icon: '🛑', title: 'Daily Trade Limit Reached', body: `You have taken ${todayCount} trades today (limit: ${settings.maxDailyTrades}). Stop trading and review your session.` });
    }
  }

  return insights.slice(0, 6);
}

/* ────────────────────────────────────────────────────────────
   SPLASH / ONBOARDING
──────────────────────────────────────────────────────────── */
let currentStep = 1;
const TOTAL_STEPS = 4;

function initSplash() {
  if (DB.onboarded) { launchApp(); return; }

  document.getElementById('splashSkip').addEventListener('click', launchApp);
  document.getElementById('splashCta').addEventListener('click', launchApp);

  document.getElementById('splashDots').addEventListener('click', e => {
    const dot = e.target.closest('.dot');
    if (!dot) return;
    goToStep(parseInt(dot.dataset.dot));
  });

  // Swipe support
  let startX = 0;
  const splash = document.getElementById('splash');
  splash.addEventListener('touchstart', e => { startX = e.touches[0].clientX; }, { passive: true });
  splash.addEventListener('touchend', e => {
    const dx = e.changedTouches[0].clientX - startX;
    if (Math.abs(dx) > 50) { dx < 0 ? nextStep() : prevStep(); }
  }, { passive: true });

  // Auto-advance
  const autoTimer = setInterval(() => {
    if (currentStep < TOTAL_STEPS) nextStep();
    else clearInterval(autoTimer);
  }, 4000);
}

function nextStep() { if (currentStep < TOTAL_STEPS) goToStep(currentStep + 1); }
function prevStep() { if (currentStep > 1) goToStep(currentStep - 1); }

function goToStep(n) {
  document.querySelectorAll('.splash-step').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.dot').forEach(el => el.classList.remove('active'));
  currentStep = n;
  document.querySelector(`.splash-step[data-step="${n}"]`).classList.add('active');
  document.querySelector(`.dot[data-dot="${n}"]`).classList.add('active');
}

function launchApp() {
  DB.onboarded = true;
  document.getElementById('splash').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  initApp();
}

/* ────────────────────────────────────────────────────────────
   APP INIT
──────────────────────────────────────────────────────────── */
function initApp() {
  loadSettings();
  FIREBASE.init();
  updateProUI();
  initNavigation();
  initTradeForm();
  initJournal();
  initAnalytics();
  initChallengeTracker();
  initPsychologyLab();
  initSettingsPage();
  initTopBarActions();
  initNotifPanel();
  initPWAInstallPrompt();
  initDashInstallCard();
  initAuthModal();
  initUpgradeModal();
  initFeedback();
  initSmartAlerts();
  initCommunity();
  initScreenshotUpload();
  renderDashboard();
  updateGreeting();
  checkDailyAlerts();
  requestNotifPermission();
}

/* ────────────────────────────────────────────────────────────
   NAVIGATION
──────────────────────────────────────────────────────────── */
let activeView = 'dashboard';

function initNavigation() {
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const view = btn.dataset.view;
      navigateTo(view);
    });
  });

  document.getElementById('seeAllTradesBtn').addEventListener('click', () => navigateTo('journal'));
  document.getElementById('quickLogBtn').addEventListener('click', () => navigateTo('log'));
  document.getElementById('settingsBtn').addEventListener('click', () => navigateTo('settings'));
}

function navigateTo(view) {
  // Hide all views
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));

  // Show target view
  const viewEl = document.getElementById(`view-${view}`);
  if (viewEl) viewEl.classList.add('active');

  // Activate nav button
  const navBtn = document.querySelector(`.nav-btn[data-view="${view}"]`);
  if (navBtn) navBtn.classList.add('active');

  activeView = view;

  // Re-render views when visited
  if (view === 'dashboard') renderDashboard();
  if (view === 'journal')   renderJournal();
  if (view === 'analytics') renderAnalytics();
  if (view === 'challenge') renderChallenges();
  if (view === 'log')       resetTradeForm();

  // Scroll to top
  document.getElementById('mainContent').scrollTo(0, 0);
}

/* ────────────────────────────────────────────────────────────
   DASHBOARD RENDER
──────────────────────────────────────────────────────────── */
function updateGreeting() {
  const h = new Date().getHours();
  const part = h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening';
  const name = DB.settings.name || 'Trader';
  setEl('greetingText', `Good ${part}, ${sanitize(name)}`);

  const today = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  setEl('greetingSub', today);
}

function renderDashboard() {
  const trades = DB.trades;
  const settings = DB.settings;

  // Today's trades
  const todayStr = new Date().toISOString().slice(0, 10);
  const todayTrades = trades.filter(t => (t.datetime || '').startsWith(todayStr));
  const todayPnl = todayTrades.reduce((s, t) => s + (parseFloat(t.pnl) || 0), 0);

  const pnlEl = document.getElementById('kpiPnlValue');
  pnlEl.textContent = fmt(todayPnl);
  pnlEl.style.color = colorByValue(todayPnl);
  setEl('kpiPnlDelta', `${todayTrades.length} trade${todayTrades.length !== 1 ? 's' : ''} today`);

  // 30-day win rate
  const recent30 = tradesForPeriod(trades, 30);
  const stats30 = calcStats(recent30);
  setEl('kpiWinrateValue', stats30 ? `${stats30.winRate.toFixed(0)}%` : '—');

  // Avg R:R
  const allStats = calcStats(trades);
  setEl('kpiRrValue', allStats && allStats.avgRR ? `${allStats.avgRR.toFixed(1)}R` : '—');

  // EmotionIQ
  const eiq = calcEmotionIQ(trades);
  setEl('kpiEmotionValue', eiq !== null ? `${eiq}` : '—');
  setEl('kpiEmotionDelta', 'this week');

  // Discipline score
  const ds = calcDisciplineScore(trades);
  setEl('topDisciplineScore', ds !== null ? `${ds}` : '—');

  // Streak
  const streaks = calcStreaks(trades);
  const wins30  = trades.filter(t => t.outcome === 'WIN').length;
  setEl('streakCount', streaks.currentWin > 0 ? streaks.currentWin : wins30);

  // Insights
  renderInsights(trades);

  // Free tier bar
  renderFreeLimitBar();

  // Equity chart
  renderEquityChart(trades, 30);

  // Emotion chart
  renderEmotionChart(trades);

  // Session heatmap
  renderSessionHeatmap(trades);

  // Recent trades (last 5)
  renderRecentTrades(trades.slice(-5).reverse());

  // Smart alerts
  renderSmartAlerts();

  // Community challenges
  renderCommunityDash();

  // Mission banner
  checkMissionBanner(todayTrades);
}

function checkMissionBanner(todayTrades) {
  const losses = todayTrades.filter(t => t.outcome === 'LOSS').length;
  const settings = DB.settings;
  const banner = document.getElementById('missionBanner');
  const missionText = document.getElementById('missionText');

  if (losses >= 2 && (!settings.maxDailyTrades || todayTrades.length < parseInt(settings.maxDailyTrades))) {
    missionText.textContent = `You've had ${losses} losses today. Take a 30-min break before your next trade.`;
    banner.classList.remove('hidden');
  } else {
    banner.classList.add('hidden');
  }
}

function renderInsights(trades) {
  const feed = document.getElementById('insightsFeed');
  const insights = generateInsights(trades);

  if (!insights.length) {
    feed.innerHTML = `<div class="insight-card insight-warning">
      <div class="insight-icon">💡</div>
      <div class="insight-body"><strong>Start logging trades</strong> to unlock personalized behavioral insights powered by EmotionIQ.</div>
    </div>`;
    return;
  }

  // Free tier: show only 1 insight, then a Pro upsell
  const visible = PRO.active ? insights : insights.slice(0, 1);
  let html = visible.map(i => `
    <div class="insight-card insight-${i.type}">
      <div class="insight-icon">${i.icon}</div>
      <div class="insight-body"><strong>${sanitize(i.title)}</strong><br>${sanitize(i.body)}</div>
    </div>
  `).join('');

  if (!PRO.active && insights.length > 1) {
    html += `<div class="insight-card insight-warning" style="cursor:pointer" onclick="showUpgradeModal('All behavioral insights')">
      <div class="insight-icon">🔒</div>
      <div class="insight-body"><strong>${insights.length - 1} more insight${insights.length > 2 ? 's' : ''} hidden</strong><br>Upgrade to Pro to unlock all EmotionIQ behavioral insights.</div>
    </div>`;
  }

  feed.innerHTML = html;
}

function renderEquityChart(trades, days) {
  const filtered = tradesForPeriod(trades, days);
  const sorted = [...filtered].sort((a, b) => new Date(a.datetime) - new Date(b.datetime));

  const labels = [], data = [];
  let running = 0;
  for (const t of sorted) {
    running += parseFloat(t.pnl) || 0;
    labels.push(fmtDate(t.datetime));
    data.push(parseFloat(running.toFixed(2)));
  }

  const ctx = document.getElementById('equityChart').getContext('2d');
  if (charts.equity) charts.equity.destroy();

  const gradient = ctx.createLinearGradient(0, 0, 0, 200);
  gradient.addColorStop(0, 'rgba(59, 130, 246, 0.3)');
  gradient.addColorStop(1, 'rgba(59, 130, 246, 0.0)');

  charts.equity = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        data,
        borderColor: '#3b82f6',
        backgroundColor: gradient,
        borderWidth: 2,
        fill: true,
        tension: 0.4,
        pointRadius: data.length > 30 ? 0 : 3,
        pointHoverRadius: 5,
        pointBackgroundColor: '#3b82f6',
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: { label: ctx => ` ${fmt(ctx.raw)}` }
        }
      },
      scales: {
        x: { ticks: { maxTicksLimit: 6, font: { size: 10 } } },
        y: { ticks: { callback: v => fmt(v), font: { size: 10 } } }
      }
    }
  });

  // Period tabs
  document.getElementById('equityPeriodTabs').querySelectorAll('.period-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.period-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      renderEquityChart(DB.trades, tab.dataset.period === 'all' ? 'all' : parseInt(tab.dataset.period));
    });
  });
}

function renderEmotionChart(trades) {
  const emotionData = {};
  for (const t of trades) {
    if (!t.emotion || t.pnl === null) continue;
    if (!emotionData[t.emotion]) emotionData[t.emotion] = { pnl: 0, count: 0 };
    emotionData[t.emotion].pnl += parseFloat(t.pnl) || 0;
    emotionData[t.emotion].count++;
  }

  const labels = Object.keys(emotionData);
  const avgPnls = labels.map(e => parseFloat((emotionData[e].pnl / emotionData[e].count).toFixed(2)));
  const colors  = avgPnls.map(v => v >= 0 ? 'rgba(16, 185, 129, 0.7)' : 'rgba(239, 68, 68, 0.7)');

  const ctx = document.getElementById('emotionChart').getContext('2d');
  if (charts.emotion) charts.emotion.destroy();

  charts.emotion = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Avg P&L',
        data: avgPnls,
        backgroundColor: colors,
        borderRadius: 6,
        borderSkipped: false,
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: true,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => ` ${fmt(ctx.raw)}` } }
      },
      scales: {
        x: { ticks: { font: { size: 10 } } },
        y: { ticks: { callback: v => fmt(v), font: { size: 10 } } }
      }
    }
  });
}

function renderSessionHeatmap(trades) {
  const sessions = ['London', 'NY', 'Asia', 'Overlap'];
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
  const grid = document.getElementById('sessionHeatmap');
  grid.innerHTML = '';

  // Build a session × day matrix
  const matrix = {};
  for (const s of sessions) {
    matrix[s] = {};
    for (const d of days) matrix[s][d] = { pnl: 0, count: 0 };
  }

  for (const t of trades) {
    if (!t.session || !t.datetime) continue;
    const dow = new Date(t.datetime).toLocaleDateString('en-US', { weekday: 'short' });
    if (!days.includes(dow) || !matrix[t.session]) continue;
    matrix[t.session][dow].pnl += parseFloat(t.pnl) || 0;
    matrix[t.session][dow].count++;
  }

  // Header row
  grid.style.gridTemplateColumns = `repeat(${days.length + 1}, 1fr)`;
  const blank = document.createElement('div');
  blank.className = 'heatmap-cell';
  grid.appendChild(blank);
  for (const d of days) {
    const el = document.createElement('div');
    el.className = 'heatmap-cell';
    el.textContent = d;
    el.style.fontSize = '0.65rem';
    el.style.color = 'var(--text-3)';
    grid.appendChild(el);
  }

  for (const s of sessions) {
    const label = document.createElement('div');
    label.className = 'heatmap-cell';
    label.textContent = s;
    label.style.fontSize = '0.6rem';
    label.style.fontWeight = '700';
    grid.appendChild(label);

    for (const d of days) {
      const cell = document.createElement('div');
      cell.className = 'heatmap-cell';
      const { pnl, count } = matrix[s][d];
      if (count > 0) {
        const avg = pnl / count;
        if (avg > 200) cell.classList.add('heat-3');
        else if (avg > 50) cell.classList.add('heat-2');
        else if (avg > 0) cell.classList.add('heat-1');
        else if (avg < -200) cell.classList.add('heat-neg3');
        else if (avg < -50) cell.classList.add('heat-neg2');
        else cell.classList.add('heat-neg1');
        cell.setAttribute('title', `${s} ${d}: ${fmt(avg)}/trade (${count} trades)`);
        cell.textContent = count;
        cell.style.fontSize = '0.55rem';
      }
      grid.appendChild(cell);
    }
  }
}

function renderRecentTrades(trades) {
  const list = document.getElementById('recentTradesList');
  if (!trades.length) {
    list.innerHTML = `<div class="empty-state"><i class="fa-solid fa-book-open"></i><p>No trades yet. Log your first one above.</p></div>`;
    return;
  }
  list.innerHTML = trades.map(t => tradeRowHTML(t)).join('');
  list.querySelectorAll('.trade-row').forEach(row => {
    row.addEventListener('click', () => openTradeDetail(row.dataset.id));
  });
}

function tradeRowHTML(t) {
  const pnl = parseFloat(t.pnl);
  const pnlColor = isNaN(pnl) ? '' : (pnl > 0 ? 'var(--green)' : pnl < 0 ? 'var(--red)' : 'var(--text-2)');
  const emoLabel = t.emotion ? ` · ${t.emotion}` : '';
  return `
    <div class="trade-row" data-id="${t.id}">
      <div class="trade-row-outcome ${t.outcome === 'WIN' ? 'outcome-win' : t.outcome === 'LOSS' ? 'outcome-loss' : 'outcome-be'}">
        ${t.outcome === 'WIN' ? 'W' : t.outcome === 'LOSS' ? 'L' : 'BE'}
      </div>
      <div class="trade-row-body">
        <div class="trade-row-pair">${sanitize(t.instrument || '—')} <span style="color:var(--text-3);font-size:0.75rem;font-weight:500">${t.direction || ''}</span></div>
        <div class="trade-row-meta">${t.datetime ? fmtDateTime(t.datetime) : '—'}${emoLabel}</div>
      </div>
      <div class="trade-row-pnl" style="color:${pnlColor}">${isNaN(pnl) ? '—' : fmt(pnl)}</div>
    </div>
  `;
}

/* ────────────────────────────────────────────────────────────
   TRADE FORM
──────────────────────────────────────────────────────────── */
function initTradeForm() {
  // Set default datetime
  resetTradeForm();

  // Instrument chips
  document.getElementById('instrumentGrid').addEventListener('click', e => {
    const chip = e.target.closest('.instr-chip');
    if (!chip) return;
    document.querySelectorAll('.instr-chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    const val = chip.dataset.val;
    if (val === 'custom') {
      document.getElementById('customInstrument').classList.remove('hidden');
      formState.instrument = '';
    } else {
      document.getElementById('customInstrument').classList.add('hidden');
      formState.instrument = val;
    }
    recalcRR();
  });

  document.getElementById('customInstrument').addEventListener('input', e => {
    formState.instrument = e.target.value.trim();
  });

  // Direction
  document.getElementById('directionToggle').addEventListener('click', e => {
    const btn = e.target.closest('.dir-btn');
    if (!btn) return;
    document.querySelectorAll('.dir-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    formState.direction = btn.dataset.dir;
  });

  // Outcome
  document.getElementById('outcomeToggle').addEventListener('click', e => {
    const btn = e.target.closest('.outcome-btn');
    if (!btn) return;
    document.querySelectorAll('.outcome-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    formState.outcome = btn.dataset.outcome;
  });

  // Session chips
  document.getElementById('sessionChips').addEventListener('click', e => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    document.querySelectorAll('#sessionChips .chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    formState.session = chip.dataset.val;
  });

  // Emotion
  document.getElementById('emotionGrid').addEventListener('click', e => {
    const btn = e.target.closest('.emo-btn');
    if (!btn) return;
    document.querySelectorAll('.emo-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    formState.emotion = btn.dataset.val;
  });

  // Setup quality
  document.getElementById('setupQualityRating').addEventListener('click', e => {
    const btn = e.target.closest('.rate-btn');
    if (!btn) return;
    document.querySelectorAll('.rate-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    formState.setupQuality = parseInt(btn.dataset.val);
  });

  // Mistake tags (multi-select)
  document.getElementById('mistakeTags').addEventListener('click', e => {
    const chip = e.target.closest('.chip-mistake');
    if (!chip) return;
    chip.classList.toggle('active');
    const val = chip.dataset.val;
    if (formState.mistakes.has(val)) formState.mistakes.delete(val);
    else formState.mistakes.add(val);
  });

  // R:R calculation
  ['entryPrice', 'exitPrice', 'stopLoss', 'takeProfit'].forEach(id => {
    document.getElementById(id).addEventListener('input', recalcRR);
  });

  // Form submit
  document.getElementById('tradeForm').addEventListener('submit', e => {
    e.preventDefault();
    saveTrade();
  });
}

function resetTradeForm() {
  document.getElementById('tradeForm').reset();
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  document.getElementById('tradeDateTime').value = local;

  // Appearance reset
  document.querySelectorAll('.instr-chip').forEach(c => c.classList.remove('active'));
  document.querySelector('.instr-chip[data-val="EUR/USD"]').classList.add('active');
  document.querySelectorAll('.dir-btn').forEach(b => b.classList.remove('active'));
  document.querySelector('.dir-btn[data-dir="LONG"]').classList.add('active');
  document.querySelectorAll('.outcome-btn').forEach(b => b.classList.remove('active'));
  document.querySelector('.outcome-btn[data-outcome="WIN"]').classList.add('active');
  document.querySelectorAll('#sessionChips .chip').forEach(c => c.classList.remove('active'));
  document.querySelector('#sessionChips .chip[data-val="London"]').classList.add('active');
  document.querySelectorAll('.emo-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.rate-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.chip-mistake').forEach(c => c.classList.remove('active'));
  document.getElementById('customInstrument').classList.add('hidden');
  document.getElementById('rrDisplay').classList.add('hidden');
  document.getElementById('formError').classList.add('hidden');

  // State reset
  formState.instrument = 'EUR/USD';
  formState.direction = 'LONG';
  formState.outcome = 'WIN';
  formState.session = 'London';
  formState.emotion = null;
  formState.setupQuality = null;
  formState.mistakes = new Set();
  formState.editingTradeId = null;
  formState.screenshotData = null;

  // Reset screenshot upload
  const preview = document.getElementById('screenshotPreview');
  const dropzone = document.getElementById('screenshotDropzone');
  if (preview) preview.classList.add('hidden');
  if (dropzone) dropzone.classList.remove('hidden');
}

function recalcRR() {
  const entry = parseFloat(document.getElementById('entryPrice').value);
  const sl    = parseFloat(document.getElementById('stopLoss').value);
  const tp    = parseFloat(document.getElementById('takeProfit').value);
  const exit  = parseFloat(document.getElementById('exitPrice').value);

  const rrDisplay = document.getElementById('rrDisplay');
  const rrValue   = document.getElementById('rrValue');

  if (entry && sl && (tp || exit)) {
    const risk   = Math.abs(entry - sl);
    const reward = Math.abs((tp || exit) - entry);
    if (risk > 0) {
      const rr = (reward / risk).toFixed(2);
      rrValue.textContent = `1:${rr}`;
      rrDisplay.classList.remove('hidden');
    }
  } else {
    rrDisplay.classList.add('hidden');
  }
}

function saveTrade() {
  // Gate free tier
  if (!formState.editingTradeId && !PRO.canLog()) {
    showUpgradeModal('Unlimited trade logging');
    toast(`Free limit reached (${PRO.FREE_LIMIT} trades). Upgrade to Pro to log unlimited trades.`, 'warn', 5000);
    return;
  }

  // Warn if max daily trades exceeded
  const settings = DB.settings;
  if (!formState.editingTradeId && settings.maxDailyTrades) {
    const todayStr = new Date().toISOString().slice(0, 10);
    const todayCount = DB.trades.filter(t => (t.datetime || '').startsWith(todayStr)).length;
    if (todayCount >= parseInt(settings.maxDailyTrades)) {
      toast(`⚠️ You've reached your daily trade limit (${settings.maxDailyTrades}). Trade saved anyway — but consider stopping.`, 'warn', 5000);
    }
  }

  const instrument = formState.instrument || document.getElementById('customInstrument').value.trim();
  if (!instrument) {
    showFormError('Please select or type an instrument.');
    return;
  }
  if (!formState.emotion) {
    showFormError('Please select how you felt before this trade — it\'s the most important data point.');
    return;
  }

  const entry = parseFloat(document.getElementById('entryPrice').value) || null;
  const exit  = parseFloat(document.getElementById('exitPrice').value) || null;
  const sl    = parseFloat(document.getElementById('stopLoss').value) || null;
  const tp    = parseFloat(document.getElementById('takeProfit').value) || null;

  let rr = null;
  if (entry && sl && (tp || exit)) {
    const risk = Math.abs(entry - sl);
    const reward = Math.abs((tp || exit) - entry);
    if (risk > 0) rr = parseFloat((reward / risk).toFixed(2));
  }

  const pnlRaw = document.getElementById('pnlInput').value;
  const pnl = pnlRaw !== '' ? parseFloat(pnlRaw) : null;

  const rules = {
    plan:    document.getElementById('rule_plan').checked,
    sl:      document.getElementById('rule_sl').checked,
    rr:      document.getElementById('rule_rr').checked,
    session: document.getElementById('rule_session').checked,
    size:    document.getElementById('rule_size').checked,
  };

  const trade = {
    id: formState.editingTradeId || uid(),
    instrument,
    direction: formState.direction,
    outcome: formState.outcome,
    session: formState.session,
    emotion: formState.emotion,
    setupQuality: formState.setupQuality,
    mistakes: [...formState.mistakes],
    rules,
    entry, exit, sl, tp, rr, pnl,
    notes: document.getElementById('tradeNotes').value.trim(),
    screenshot: formState.screenshotData || '',
    datetime: document.getElementById('tradeDateTime').value || new Date().toISOString().slice(0, 16),
    createdAt: new Date().toISOString(),
  };

  // No URL validation needed — screenshot is now base64 data

  const trades = DB.trades;
  if (formState.editingTradeId) {
    const idx = trades.findIndex(t => t.id === formState.editingTradeId);
    if (idx !== -1) trades[idx] = trade;
  } else {
    trades.push(trade);
  }
  DB.trades = trades;

  // Notifications
  checkLossStreakAfterSave(trade);

  // Emit event (triggers PWA install modal on first trade)
  window.dispatchEvent(new Event('trafxos:tradeLogged'));

  // Sync to Firebase if signed in
  if (FIREBASE.user) FIREBASE.syncTrades();

  toast('Trade saved! 🎯', 'success');
  navigateTo('dashboard');
}

function showFormError(msg) {
  const el = document.getElementById('formError');
  el.textContent = msg;
  el.classList.remove('hidden');
  el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function checkLossStreakAfterSave(newTrade) {
  if (newTrade.outcome !== 'LOSS') return;
  const settings = DB.settings;
  if (!settings.notifLossStreak) return;

  const trades = DB.trades;
  const sorted = [...trades].sort((a, b) => new Date(b.datetime) - new Date(a.datetime));
  let streak = 0;
  for (const t of sorted) {
    if (t.outcome === 'LOSS') streak++;
    else break;
  }
  if (streak >= 3) {
    const msg = `⚠️ ${streak} losses in a row. Consider stopping for today.`;
    toast(msg, 'warn', 5000);
    addNotification(msg, 'warn');
  }
}

/* ────────────────────────────────────────────────────────────
   TRADE DETAIL MODAL
──────────────────────────────────────────────────────────── */
function openTradeDetail(id) {
  const trade = DB.trades.find(t => t.id === id);
  if (!trade) return;

  const pnl = parseFloat(trade.pnl);
  const pnlColor = isNaN(pnl) ? 'var(--text)' : (pnl > 0 ? 'var(--green)' : pnl < 0 ? 'var(--red)' : 'var(--text)');

  const rulesFollowed = trade.rules ? Object.values(trade.rules).filter(Boolean).length : 0;
  const rulesTotal    = trade.rules ? Object.keys(trade.rules).length : 0;

  const content = [
    ['Instrument', trade.instrument],
    ['Direction', trade.direction],
    ['Outcome', trade.outcome],
    ['P&L', isNaN(pnl) ? '—' : `<span style="color:${pnlColor};font-weight:800">${fmt(pnl)}</span>`],
    ['R:R', trade.rr ? `1:${trade.rr}` : '—'],
    ['Entry', trade.entry || '—'],
    ['Exit', trade.exit || '—'],
    ['Stop Loss', trade.sl || '—'],
    ['Take Profit', trade.tp || '—'],
    ['Session', trade.session || '—'],
    ['Emotion', trade.emotion || '—'],
    ['Setup Quality', trade.setupQuality ? `${trade.setupQuality}/5` : '—'],
    ['Rules Followed', trade.rules ? `${rulesFollowed}/${rulesTotal}` : '—'],
    ['Mistakes', trade.mistakes && trade.mistakes.length ? trade.mistakes.join(', ') : 'None logged'],
    ['Date', trade.datetime ? fmtDateTime(trade.datetime) : '—'],
    ['Notes', trade.notes || '—'],
  ].map(([l, v]) => `
    <div class="td-row">
      <span class="td-label">${sanitize(l)}</span>
      <span class="td-value">${v}</span>
    </div>
  `).join('');

  document.getElementById('tradeDetailTitle').textContent = `${trade.instrument} ${trade.direction}`;
  document.getElementById('tradeDetailContent').innerHTML = content;

  // Screenshot
  if (trade.screenshot) {
    const isBase64 = trade.screenshot.startsWith('data:');
    const isUrl = trade.screenshot.startsWith('http');
    if (isBase64) {
      document.getElementById('tradeDetailContent').innerHTML += `
        <div style="margin-top:12px">
          <div style="color:var(--text-2);font-size:0.8rem;margin-bottom:6px"><i class="fa-solid fa-image"></i> Chart Screenshot</div>
          <img src="${trade.screenshot}" alt="Trade chart screenshot" style="width:100%;border-radius:10px;max-height:300px;object-fit:contain;background:var(--bg)" />
        </div>`;
    } else if (isUrl) {
      document.getElementById('tradeDetailContent').innerHTML += `
        <div style="margin-top:12px">
          <a href="${encodeURI(trade.screenshot)}" target="_blank" rel="noopener noreferrer" style="color:var(--accent);font-size:0.85rem">
            <i class="fa-solid fa-image"></i> View Chart Screenshot
          </a>
        </div>`;
    }
  }

  // Delete button
  document.getElementById('deleteTradeBtn').onclick = () => {
    if (!confirm('Delete this trade? This cannot be undone.')) return;
    const trades = DB.trades.filter(t => t.id !== id);
    DB.trades = trades;
    hideModal('tradeDetailModal');
    toast('Trade deleted', 'info');
    if (activeView === 'dashboard') renderDashboard();
    if (activeView === 'journal') renderJournal();
  };

  showModal('tradeDetailModal');
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('tradeDetailClose').addEventListener('click', () => hideModal('tradeDetailModal'));
  document.getElementById('tradeDetailModal').addEventListener('click', e => {
    if (e.target === e.currentTarget) hideModal('tradeDetailModal');
  });
});

/* ────────────────────────────────────────────────────────────
   JOURNAL
──────────────────────────────────────────────────────────── */
function initJournal() {
  document.getElementById('filterBtn').addEventListener('click', () => {
    document.getElementById('filtersPanel').classList.toggle('hidden');
  });

  document.getElementById('clearFilters').addEventListener('click', () => {
    document.getElementById('filterOutcome').value = '';
    document.getElementById('filterEmotion').value = '';
    document.getElementById('filterFrom').value = '';
    document.getElementById('filterTo').value = '';
    renderJournal();
  });

  document.getElementById('journalSearch').addEventListener('input', () => renderJournal());
  document.getElementById('filterOutcome').addEventListener('change', () => renderJournal());
  document.getElementById('filterEmotion').addEventListener('change', () => renderJournal());
  document.getElementById('filterFrom').addEventListener('change', () => renderJournal());
  document.getElementById('filterTo').addEventListener('change', () => renderJournal());

  document.getElementById('exportBtn').addEventListener('click', exportCSV);
}

function renderJournal() {
  let trades = DB.trades;
  const search  = (document.getElementById('journalSearch').value || '').toLowerCase();
  const outcome = document.getElementById('filterOutcome').value;
  const emotion = document.getElementById('filterEmotion').value;
  const from    = document.getElementById('filterFrom').value;
  const to      = document.getElementById('filterTo').value;

  if (search)  trades = trades.filter(t => (t.instrument || '').toLowerCase().includes(search) || (t.notes || '').toLowerCase().includes(search) || (t.emotion || '').toLowerCase().includes(search));
  if (outcome) trades = trades.filter(t => t.outcome === outcome);
  if (emotion) trades = trades.filter(t => t.emotion === emotion);
  if (from)    trades = trades.filter(t => t.datetime >= from);
  if (to)      trades = trades.filter(t => t.datetime <= to + 'T23:59');

  trades = [...trades].sort((a, b) => new Date(b.datetime) - new Date(a.datetime));

  const wins   = trades.filter(t => t.outcome === 'WIN').length;
  const losses = trades.filter(t => t.outcome === 'LOSS').length;
  const pnl    = trades.reduce((s, t) => s + (parseFloat(t.pnl) || 0), 0);

  setEl('jsbTotal', trades.length);
  setEl('jsbWins', wins);
  setEl('jsbLosses', losses);
  const pnlEl = document.getElementById('jsbPnl');
  pnlEl.textContent = fmt(pnl);
  pnlEl.style.color = colorByValue(pnl);

  const list = document.getElementById('journalTradeList');
  if (!trades.length) {
    list.innerHTML = `<div class="empty-state"><i class="fa-solid fa-book-open"></i><p>No trades found.</p></div>`;
    return;
  }
  list.innerHTML = trades.map(t => tradeRowHTML(t)).join('');
  list.querySelectorAll('.trade-row').forEach(row => {
    row.addEventListener('click', () => openTradeDetail(row.dataset.id));
  });
}

function exportCSV() {
  const trades = DB.trades;
  if (!trades.length) { toast('No trades to export.', 'warn'); return; }
  if (!PRO.canExport()) {
    showUpgradeModal('Full CSV export (all trades)');
    return;
  }

  const headers = ['Date','Instrument','Direction','Outcome','P&L','R:R','Entry','Exit','SL','TP','Lots','Session','Emotion','Setup Quality','Rules Score','Mistakes','Notes'];
  const rows = trades.map(t => {
    const rulesFollowed = t.rules ? Object.values(t.rules).filter(Boolean).length : 0;
    const rulesTotal    = t.rules ? Object.keys(t.rules).length : 5;
    return [
      t.datetime || '',
      t.instrument || '',
      t.direction || '',
      t.outcome || '',
      t.pnl != null ? t.pnl : '',
      t.rr != null ? t.rr : '',
      t.entry || '',
      t.exit || '',
      t.sl || '',
      t.tp || '',
      t.lotSize || '',
      t.session || '',
      t.emotion || '',
      t.setupQuality || '',
      `${rulesFollowed}/${rulesTotal}`,
      t.mistakes ? t.mistakes.join('; ') : '',
      (t.notes || '').replace(/"/g, '""'),
    ].map(v => `"${v}"`).join(',');
  });

  const csv = [headers.join(','), ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `trafxos-journal-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  toast('Export ready!', 'success');
}

/* ────────────────────────────────────────────────────────────
   ANALYTICS
──────────────────────────────────────────────────────────── */
function initAnalytics() {
  document.getElementById('analyticsTabs').addEventListener('click', e => {
    const tab = e.target.closest('.atab');
    if (!tab) return;
    const isGated = (tab.dataset.atab === 'behavior' || tab.dataset.atab === 'patterns') && !PRO.canAnalyze();
    if (isGated) {
      const labels = { behavior: 'Behavior Analytics', patterns: 'Patterns Analytics' };
      showUpgradeModal(labels[tab.dataset.atab] || 'Advanced Analytics');
      return;
    }
    document.querySelectorAll('.atab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.atab-content').forEach(c => c.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(`atab-${tab.dataset.atab}`).classList.add('active');
  });

  // Add lock indicator to gated tabs
  if (!PRO.active) {
    document.querySelectorAll('.atab[data-atab="behavior"], .atab[data-atab="patterns"]').forEach(tab => {
      if (!tab.querySelector('.tab-lock-icon')) {
        const icon = document.createElement('i');
        icon.className = 'fa-solid fa-lock tab-lock-icon';
        icon.style.cssText = 'font-size:0.65rem;margin-left:5px;color:var(--yellow);';
        tab.appendChild(icon);
      }
    });
  }
}

function renderAnalytics() {
  const trades = DB.trades;
  const stats  = calcStats(trades);

  // Performance stats
  if (stats) {
    setEl('statTotalTrades', stats.closed.length);
    const wrEl = document.getElementById('statWinRate');
    wrEl.textContent = `${stats.winRate.toFixed(1)}%`;
    wrEl.style.color = stats.winRate >= 50 ? 'var(--green)' : 'var(--red)';
    setEl('statAvgRR', stats.avgRR ? `${stats.avgRR.toFixed(2)}R` : '—');
    setEl('statPF', stats.pf ? stats.pf.toFixed(2) : '—');
    const bestEl = document.getElementById('statBestDay');
    bestEl.textContent = stats.bestDay !== null ? fmt(stats.bestDay) : '—';
    const worstEl = document.getElementById('statWorstDay');
    worstEl.textContent = stats.worstDay !== null ? fmt(stats.worstDay) : '—';
    setEl('statMaxDD', fmt(-stats.maxDD));
    const expEl = document.getElementById('statExpectancy');
    expEl.textContent = stats.expectancy !== null ? fmt(stats.expectancy) : '—';
    expEl.style.color = stats.expectancy > 0 ? 'var(--green)' : 'var(--red)';
  }

  renderAnalyticsEquityChart(trades);
  renderInstrumentChart(trades);
  renderDOWChart(trades);

  // Behavior
  renderDisciplineScoreRing(trades);
  renderEmotionMatrix(trades);
  renderRuleAdherence(trades);
  renderMistakesChart(trades);

  // Patterns
  renderSessionChart(trades);
  renderStreakAnalysis(trades);
  renderSetupRanking(trades);
}

function renderAnalyticsEquityChart(trades) {
  const sorted = [...trades].sort((a, b) => new Date(a.datetime) - new Date(b.datetime));
  const labels = [], data = [];
  let running = 0;
  for (const t of sorted) {
    running += parseFloat(t.pnl) || 0;
    labels.push(fmtDate(t.datetime));
    data.push(parseFloat(running.toFixed(2)));
  }

  const ctx = document.getElementById('analyticsEquityChart').getContext('2d');
  if (charts.analyticsEquity) charts.analyticsEquity.destroy();

  const gradient = ctx.createLinearGradient(0, 0, 0, 200);
  gradient.addColorStop(0, 'rgba(59, 130, 246, 0.3)');
  gradient.addColorStop(1, 'rgba(59, 130, 246, 0)');

  charts.analyticsEquity = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets: [{ data, borderColor: '#3b82f6', backgroundColor: gradient, borderWidth: 2, fill: true, tension: 0.4, pointRadius: 0 }] },
    options: {
      responsive: true, maintainAspectRatio: true,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => fmt(ctx.raw) } } },
      scales: { x: { ticks: { maxTicksLimit: 6, font: { size: 10 } } }, y: { ticks: { callback: v => fmt(v), font: { size: 10 } } } }
    }
  });
}

function renderInstrumentChart(trades) {
  const instMap = {};
  for (const t of trades) {
    const k = t.instrument || 'Unknown';
    if (!instMap[k]) instMap[k] = { pnl: 0, count: 0 };
    instMap[k].pnl += parseFloat(t.pnl) || 0;
    instMap[k].count++;
  }
  const sorted = Object.entries(instMap).sort((a, b) => b[1].count - a[1].count).slice(0, 7);
  const ctx = document.getElementById('instrumentChart').getContext('2d');
  if (charts.instrument) charts.instrument.destroy();
  charts.instrument = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: sorted.map(s => s[0]),
      datasets: [{
        label: 'Total P&L',
        data: sorted.map(s => parseFloat(s[1].pnl.toFixed(2))),
        backgroundColor: sorted.map(s => s[1].pnl >= 0 ? 'rgba(16,185,129,0.7)' : 'rgba(239,68,68,0.7)'),
        borderRadius: 6,
        borderSkipped: false
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: true,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => fmt(ctx.raw) } } },
      scales: { x: { ticks: { font: { size: 10 } } }, y: { ticks: { callback: v => fmt(v), font: { size: 10 } } } }
    }
  });
}

function renderDOWChart(trades) {
  const dows = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  const dowMap = {};
  for (const d of dows) dowMap[d] = { pnl: 0 };
  for (const t of trades) {
    if (!t.datetime) continue;
    const d = new Date(t.datetime).toLocaleDateString('en-US', { weekday: 'short' });
    if (dowMap[d]) dowMap[d].pnl += parseFloat(t.pnl) || 0;
  }
  const vals = dows.map(d => dowMap[d].pnl);
  const ctx = document.getElementById('dowChart').getContext('2d');
  if (charts.dow) charts.dow.destroy();
  charts.dow = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: dows,
      datasets: [{ data: vals, backgroundColor: vals.map(v => v >= 0 ? 'rgba(16,185,129,0.7)' : 'rgba(239,68,68,0.7)'), borderRadius: 6, borderSkipped: false }]
    },
    options: {
      responsive: true, maintainAspectRatio: true,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => fmt(ctx.raw) } } },
      scales: { x: { ticks: { font: { size: 10 } } }, y: { ticks: { callback: v => fmt(v), font: { size: 10 } } } }
    }
  });
}

function renderDisciplineScoreRing(trades) {
  const score = calcDisciplineScore(trades);
  const ring = document.getElementById('disciplineRing');
  const circumference = 327;

  if (score === null) {
    setEl('bscScore', '—');
    setEl('bscDesc', 'Log trades to build your Discipline Score.');
    ring.style.strokeDashoffset = circumference;
    return;
  }

  const offset = circumference - (score / 100) * circumference;
  ring.style.strokeDashoffset = offset;
  ring.style.stroke = score >= 80 ? 'var(--green)' : score >= 60 ? 'var(--yellow)' : 'var(--red)';
  setEl('bscScore', `${score}`);
  document.getElementById('bscDesc').textContent =
    score >= 80 ? 'Elite discipline. You trade your rules consistently.' :
    score >= 60 ? 'Good foundation. A few habits to tighten up.' :
    'Focus zone: rule adherence needs improvement.';
  setEl('topDisciplineScore', `${score}`);
}

function renderEmotionMatrix(trades) {
  const emotionMap = {};
  for (const t of trades) {
    if (!t.emotion) continue;
    if (!emotionMap[t.emotion]) emotionMap[t.emotion] = { pnl: 0, count: 0, wins: 0 };
    emotionMap[t.emotion].pnl += parseFloat(t.pnl) || 0;
    emotionMap[t.emotion].count++;
    if (t.outcome === 'WIN') emotionMap[t.emotion].wins++;
  }

  const container = document.getElementById('emotionMatrix');
  const entries   = Object.entries(emotionMap).sort((a, b) => b[1].count - a[1].count);

  if (!entries.length) { container.innerHTML = '<p style="color:var(--text-3);font-size:0.85rem;padding:12px">Log trades with emotions to see the matrix.</p>'; return; }

  const maxAbsPnl = Math.max(...entries.map(e => Math.abs(e[1].pnl / e[1].count)));

  container.innerHTML = entries.map(([emo, d]) => {
    const avg = d.pnl / d.count;
    const pct = maxAbsPnl > 0 ? Math.abs(avg) / maxAbsPnl * 100 : 0;
    const wr  = d.count > 0 ? Math.round((d.wins / d.count) * 100) : 0;
    const barClass = avg >= 0 ? 'positive' : 'negative';
    return `
      <div class="em-row">
        <div class="em-label">${sanitize(emo)} <span style="color:var(--text-3);font-size:0.7rem">(${d.count})</span></div>
        <div class="em-bar-wrap"><div class="em-bar ${barClass}" style="width:${pct}%"></div></div>
        <div class="em-pnl" style="color:${avg >= 0 ? 'var(--green)' : 'var(--red)'}">${fmt(avg)}</div>
      </div>
    `;
  }).join('');
}

function renderRuleAdherence(trades) {
  const ruleKeys = { plan: 'Followed trading plan', sl: 'SL set before entry', rr: 'Met R:R requirement', session: 'Correct session', size: 'Position size ok' };
  const counts   = {};
  let tradeCount = 0;

  for (const t of trades) {
    if (!t.rules) continue;
    tradeCount++;
    for (const [k] of Object.entries(ruleKeys)) {
      counts[k] = (counts[k] || 0) + (t.rules[k] ? 1 : 0);
    }
  }

  const container = document.getElementById('ruleAdherenceBars');
  if (!tradeCount) { container.innerHTML = '<p style="color:var(--text-3);font-size:0.85rem;padding:12px">No rule data yet.</p>'; return; }

  container.innerHTML = Object.entries(ruleKeys).map(([k, label]) => {
    const pct = tradeCount > 0 ? Math.round((counts[k] || 0) / tradeCount * 100) : 0;
    return `
      <div class="ra-row">
        <div class="ra-label">${sanitize(label)}</div>
        <div class="ra-bar-wrap"><div class="ra-bar" style="width:${pct}%;background:${pct >= 80 ? 'var(--green)' : pct >= 50 ? 'var(--yellow)' : 'var(--red)'}"></div></div>
        <div class="ra-pct" style="color:${pct >= 80 ? 'var(--green)' : pct >= 50 ? 'var(--yellow)' : 'var(--red)'}">${pct}%</div>
      </div>
    `;
  }).join('');
}

function renderMistakesChart(trades) {
  const mistakeMap = {};
  for (const t of trades) {
    if (!t.mistakes || !t.mistakes.length) continue;
    for (const m of t.mistakes) {
      mistakeMap[m] = (mistakeMap[m] || 0) + 1;
    }
  }
  const sorted = Object.entries(mistakeMap).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const labels = {
    early_entry: 'Early entry', moved_sl: 'Moved SL', early_exit: 'Exited early',
    late_exit: 'Held too long', oversize: 'Oversized', revenge: 'Revenge trade',
    no_plan: 'No plan', news: 'Traded into news'
  };

  const ctx = document.getElementById('mistakesChart').getContext('2d');
  if (charts.mistakes) charts.mistakes.destroy();

  if (!sorted.length) return;

  charts.mistakes = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: sorted.map(s => labels[s[0]] || s[0]),
      datasets: [{ data: sorted.map(s => s[1]), backgroundColor: 'rgba(239,68,68,0.65)', borderRadius: 6, borderSkipped: false }]
    },
    options: {
      indexAxis: 'y',
      responsive: true, maintainAspectRatio: true,
      plugins: { legend: { display: false } },
      scales: { x: { ticks: { font: { size: 10 } } }, y: { ticks: { font: { size: 10 } } } }
    }
  });
}

function renderSessionChart(trades) {
  const sessions = ['London', 'NY', 'Asia', 'Overlap'];
  const sessionData = {};
  for (const s of sessions) sessionData[s] = { pnl: 0, count: 0 };

  for (const t of trades) {
    if (t.session && sessionData[t.session]) {
      sessionData[t.session].pnl += parseFloat(t.pnl) || 0;
      sessionData[t.session].count++;
    }
  }

  const vals = sessions.map(s => sessionData[s].count > 0 ? parseFloat((sessionData[s].pnl / sessionData[s].count).toFixed(2)) : 0);
  const ctx = document.getElementById('sessionChart').getContext('2d');
  if (charts.session) charts.session.destroy();

  charts.session = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: sessions,
      datasets: [{ label: 'Avg P&L', data: vals, backgroundColor: vals.map(v => v >= 0 ? 'rgba(16,185,129,0.7)' : 'rgba(239,68,68,0.7)'), borderRadius: 6, borderSkipped: false }]
    },
    options: {
      responsive: true, maintainAspectRatio: true,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => fmt(ctx.raw) } } },
      scales: { x: { ticks: { font: { size: 10 } } }, y: { ticks: { callback: v => fmt(v), font: { size: 10 } } } }
    }
  });
}

function renderStreakAnalysis(trades) {
  const streaks = calcStreaks(trades);
  const container = document.getElementById('streakAnalysis');
  container.innerHTML = [
    ['Current Win Streak', `${streaks.currentWin} trades`],
    ['Current Loss Streak', `${streaks.currentLoss} trades`],
    ['Max Win Streak (all time)', `${streaks.maxWin} trades`],
    ['Max Loss Streak (all time)', `${streaks.maxLoss} trades`],
  ].map(([l, v]) => `
    <div class="streak-row">
      <span class="streak-lbl">${sanitize(l)}</span>
      <span class="streak-val">${sanitize(v)}</span>
    </div>
  `).join('');
}

function renderSetupRanking(trades) {
  const setupMap = {};
  for (const t of trades) {
    const q = t.setupQuality;
    if (!q) continue;
    const key = `${q}★ Setup`;
    if (!setupMap[key]) setupMap[key] = { pnl: 0, count: 0, wins: 0 };
    setupMap[key].pnl += parseFloat(t.pnl) || 0;
    setupMap[key].count++;
    if (t.outcome === 'WIN') setupMap[key].wins++;
  }

  const sorted = Object.entries(setupMap).sort((a, b) => (b[1].pnl / b[1].count) - (a[1].pnl / a[1].count));
  const container = document.getElementById('setupRanking');

  if (!sorted.length) { container.innerHTML = '<p style="color:var(--text-3);font-size:0.85rem;padding:12px">Log trades with setup quality to see rankings.</p>'; return; }

  container.innerHTML = sorted.map(([name, d], i) => {
    const avg = d.pnl / d.count;
    const wr  = Math.round(d.wins / d.count * 100);
    return `
      <div class="setup-rank-row">
        <div class="setup-rank-num">${i + 1}</div>
        <div class="setup-rank-name">${sanitize(name)}</div>
        <div class="setup-rank-stats" style="color:${avg >= 0 ? 'var(--green)' : 'var(--red)'}">
          ${fmt(avg)}/trade<br><span style="color:var(--text-3)">${wr}% WR · ${d.count} trades</span>
        </div>
      </div>
    `;
  }).join('');
}

/* ────────────────────────────────────────────────────────────
   CHALLENGE TRACKER
──────────────────────────────────────────────────────────── */
function initChallengeTracker() {
  document.getElementById('addChallengeBtn').addEventListener('click', () => {
    if (!PRO.active) {
      showUpgradeModal('Prop Firm Challenge Tracker');
      return;
    }
    document.getElementById('challengeForm').reset();
    document.getElementById('cfStartDate').value = new Date().toISOString().slice(0, 10);
    showModal('challengeModal');
  });
  document.getElementById('challengeModalClose').addEventListener('click', () => hideModal('challengeModal'));
  document.getElementById('challengeModal').addEventListener('click', e => {
    if (e.target === e.currentTarget) hideModal('challengeModal');
  });

  document.getElementById('challengeForm').addEventListener('submit', e => {
    e.preventDefault();
    saveChallenge();
  });
}

function saveChallenge() {
  const challenge = {
    id: uid(),
    firm: document.getElementById('cfFirm').value.trim(),
    size: parseFloat(document.getElementById('cfSize').value) || 0,
    phase: document.getElementById('cfPhase').value,
    dailyLoss: parseFloat(document.getElementById('cfDailyLoss').value) || 5,
    maxDD: parseFloat(document.getElementById('cfMaxDD').value) || 10,
    target: parseFloat(document.getElementById('cfTarget').value) || 10,
    minDays: parseInt(document.getElementById('cfMinDays').value) || 4,
    startDate: document.getElementById('cfStartDate').value,
    balance: parseFloat(document.getElementById('cfBalance').value) || parseFloat(document.getElementById('cfSize').value) || 0,
    createdAt: new Date().toISOString(),
  };

  if (!challenge.firm || !challenge.size) { toast('Enter firm name and account size.', 'warn'); return; }

  const challenges = DB.challenges;
  challenges.push(challenge);
  DB.challenges = challenges;
  hideModal('challengeModal');
  renderChallenges();
  toast('Challenge added!', 'success');
}

function renderChallenges() {
  const challenges = DB.challenges;
  const list = document.getElementById('challengeList');

  if (!challenges.length) {
    list.innerHTML = `<div class="empty-state"><i class="fa-solid fa-trophy"></i><p>No challenges tracked yet. Add your prop firm challenge to monitor your limits in real-time.</p></div>`;
    return;
  }

  list.innerHTML = challenges.map(c => challengeCardHTML(c)).join('');

  list.querySelectorAll('.challenge-delete').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!confirm('Delete this challenge?')) return;
      DB.challenges = DB.challenges.filter(c => c.id !== btn.dataset.id);
      renderChallenges();
      toast('Challenge deleted', 'info');
    });
  });
}

function challengeCardHTML(c) {
  const pnl      = c.balance - c.size;
  const pnlPct   = (pnl / c.size) * 100;
  const ddUsed   = Math.max(0, -pnl);
  const ddUsedPct= (ddUsed / c.size) * 100;
  const profitPct= Math.max(0, pnlPct);

  const maxDailyLossAmt = c.size * c.dailyLoss / 100;
  const maxDDAmt        = c.size * c.maxDD / 100;
  const targetAmt       = c.size * c.target / 100;

  const profitProgress = Math.min(100, (profitPct / c.target) * 100);
  const ddProgress     = Math.min(100, (ddUsedPct / c.maxDD) * 100);

  const ddClass = ddProgress > 80 ? 'danger' : ddProgress > 50 ? 'warn' : 'safe';

  const phaseMap = { challenge: 'Phase 1', verification: 'Phase 2', funded: 'Funded' };
  const phaseCss = c.phase === 'funded' ? 'funded' : '';

  const daysTradeable = Math.max(0, c.minDays);
  const daysElapsed   = Math.floor((new Date() - new Date(c.startDate)) / (1000 * 60 * 60 * 24));

  return `
    <div class="challenge-card">
      <div class="challenge-header">
        <div class="challenge-firm">${sanitize(c.firm)}</div>
        <div class="challenge-phase ${phaseCss}">${phaseMap[c.phase] || c.phase}</div>
      </div>

      <div class="challenge-metrics">
        <div class="cm-item">
          <div class="cm-label">Account Size</div>
          <div class="cm-value">$${c.size.toLocaleString()}</div>
        </div>
        <div class="cm-item">
          <div class="cm-label">Current P&L</div>
          <div class="cm-value ${pnl >= 0 ? 'safe' : 'danger'}">${fmt(pnl)}</div>
        </div>
        <div class="cm-item">
          <div class="cm-label">Daily Loss Limit</div>
          <div class="cm-value">$${maxDailyLossAmt.toLocaleString()}</div>
        </div>
        <div class="cm-item">
          <div class="cm-label">Max Drawdown</div>
          <div class="cm-value ${ddClass}">$${maxDDAmt.toLocaleString()}</div>
        </div>
        <div class="cm-item">
          <div class="cm-label">Profit Target</div>
          <div class="cm-value">$${targetAmt.toLocaleString()}</div>
        </div>
        <div class="cm-item">
          <div class="cm-label">Days Elapsed</div>
          <div class="cm-value">${daysElapsed} / ${daysTradeable}min</div>
        </div>
      </div>

      <div class="challenge-progress-item">
        <div class="cp-header">
          <span>Profit Progress</span>
          <span>${profitPct.toFixed(1)}% / ${c.target}%</span>
        </div>
        <div class="cp-bar-wrap"><div class="cp-bar profit" style="width:${profitProgress}%"></div></div>
      </div>

      <div class="challenge-progress-item">
        <div class="cp-header">
          <span>Drawdown Used</span>
          <span style="color:${ddClass === 'danger' ? 'var(--red)' : 'var(--text-2)'}">${ddUsedPct.toFixed(1)}% / ${c.maxDD}%</span>
        </div>
        <div class="cp-bar-wrap"><div class="cp-bar drawdown" style="width:${ddProgress}%"></div></div>
      </div>

      <div class="challenge-actions">
        <button class="btn-secondary btn-sm challenge-update" data-id="${c.id}">Update Balance</button>
        <button class="challenge-delete btn-sm" data-id="${c.id}">Delete</button>
      </div>
    </div>
  `;
}

/* ────────────────────────────────────────────────────────────
   PSYCHOLOGY LAB
──────────────────────────────────────────────────────────── */
const LESSONS = {
  revenge: {
    title: 'The Revenge Trading Loop',
    content: `
      <p>Revenge trading is one of the most destructive patterns in retail trading. It occurs when a trader, after suffering a loss, enters a new trade driven by the desire to "win back" the lost money — not by logic or analysis.</p>
      <h3>Why Your Brain Does This</h3>
      <p>The loss activates your amygdala — the brain's threat-response center. Your prefrontal cortex (rational thinking) goes offline. You're no longer trading; you're <strong>reacting</strong>. This is identical to the tilt state in poker.</p>
      <div class="callout">"The market doesn't know you lost money. It doesn't owe you anything. Revenge trading is a war against yourself."</div>
      <h3>The Pattern</h3>
      <ul>
        <li>Loss triggers emotional pain → brain labels the market as a threat</li>
        <li>Urgency to "fix" the loss → impulsive entry without setup</li>
        <li>Often oversized position to recover faster</li>
        <li>Second loss creates deeper tilt → spiral begins</li>
      </ul>
      <h3>The Protocol</h3>
      <ul>
        <li><strong>Mandatory 30-minute break</strong> after any loss. No exceptions.</li>
        <li><strong>Maximum 2 losses per day rule.</strong> After the 2nd loss, close the platform.</li>
        <li><strong>Pre-session rule:</strong> Write your rule before you trade. Read it before every entry.</li>
        <li><strong>Pattern recognition:</strong> TrafxOS will alert you when it detects revenge-emotion entries.</li>
      </ul>
    `
  },
  sizing: {
    title: 'Position Sizing Psychology',
    content: `
      <p>Position sizing is the most underrated psychological lever in trading. Most traders understand it mathematically — but almost none understand what it does to their brain.</p>
      <h3>The Neuroscience</h3>
      <p>When your position size is too large, the potential loss value <strong>activates threat circuitry</strong> before the trade even develops. Your ability to hold trades through normal volatility collapses. You close early, move stops, or freeze entirely.</p>
      <div class="callout">"Trading 2x your normal size creates 4x the psychological pressure. The math is linear; the brain is not."</div>
      <h3>Risk Per Trade Framework</h3>
      <ul>
        <li>Risk only what you can lose <strong>emotionally comfortably</strong> — not just mathematically</li>
        <li>1% rule: never risk more than 1% of account on a single trade</li>
        <li>During drawdowns: reduce to 0.5% until you've had 5 wins</li>
        <li>Test: if you're checking the chart every 60 seconds, your size is too big</li>
      </ul>
      <h3>The "Sleep Test"</h3>
      <p>Before entering: could you hold this position overnight without anxiety? If no — reduce your size until you can answer yes. That is your correct position size.</p>
    `
  },
  patience: {
    title: 'The Wait Game: Patience as Edge',
    content: `
      <p>Studies of profitable retail traders show one consistent trait above all others: <strong>they trade less than losing traders</strong>. Fewer trades. Better trades. Higher win rate.</p>
      <h3>The Overtrading Tax</h3>
      <p>Every trade you take that isn't an A+ setup is a withdrawal from your edge. You're paying spread, paying opportunity cost, and introducing noise that corrupts your data and discipline.</p>
      <div class="callout">"Your job is not to trade. Your job is to be ready when the market gives you a gift. Most days, it doesn't."</div>
      <h3>Building Patience</h3>
      <ul>
        <li>Set a <strong>maximum daily trade count</strong> (3 is a common professional limit)</li>
        <li>Use a <strong>trade filter checklist</strong> — only enter when all boxes are ticked</li>
        <li>Log "setups I passed on" — you'll see your patience creates better results over time</li>
        <li>Reframe: time spent watching without trading is not wasted — it's disciplined</li>
      </ul>
      <h3>The Sniper Mindset</h3>
      <p>Elite snipers fire 1.3 rounds per target on average. They don't spray. Your trading edge works the same way. Choose your shots with precision, then execute without hesitation.</p>
    `
  },
  cognitive: {
    title: 'Cold State vs. Hot State Decisions',
    content: `
      <p>Behavioral economists distinguish between <strong>cold state</strong> (calm, rational) and <strong>hot state</strong> (emotionally aroused) decision-making. Your trading rules were written in a cold state. Most losses happen in hot states.</p>
      <h3>The Empathy Gap</h3>
      <p>When you're calm, you genuinely cannot predict how you'll behave when you're frustrated, losing money, or watching the market move without you. This is called the <strong>empathy gap</strong> — and it's why good plans fail.</p>
      <div class="callout">"Writing rules when calm is not enough. You must engineer your environment so hot-state you cannot break them."</div>
      <h3>Practical Implementation</h3>
      <ul>
        <li><strong>Pre-commitment devices:</strong> Set price alerts before you trade, not during</li>
        <li><strong>Platform lockouts:</strong> Set daily loss limits in your broker platform</li>
        <li><strong>Check-in ritual:</strong> Complete TrafxOS daily check-in before first trade</li>
        <li><strong>Physical cues:</strong> Stand up, step away from screen for 5 minutes before entries</li>
        <li><strong>Partner accountability:</strong> Share your rule-card with someone</li>
      </ul>
    `
  },
  lossaversion: {
    title: 'Loss Aversion & the Breakeven Trap',
    content: `
      <p>Kahneman and Tversky proved that losses feel approximately <strong>2.5x more painful</strong> than equivalent gains feel pleasurable. This is called loss aversion, and it is one of the most powerful forces destroying trader P&L.</p>
      <h3>How It Shows Up</h3>
      <ul>
        <li>Moving stop to breakeven too early, choking winning trades</li>
        <li>Closing winners prematurely to "lock in profit" (fear of giving back)</li>
        <li>Holding losers too long hoping they'll recover (avoidance of realizing loss)</li>
        <li>Refusing to take valid losses, causing them to grow larger</li>
      </ul>
      <div class="callout">"The market does not care about your entry price. Breakeven is just another price level."</div>
      <h3>The Reframe</h3>
      <p>Think in R-multiples, not dollars. A trade doesn't "cost" you $200 — it costs you 1R. When you think in R, the emotional charge of dollar amounts decreases significantly. Focus on whether your system's edge is playing out, not on where price is relative to your entry.</p>
      <h3>Practice</h3>
      <ul>
        <li>Set your TP before entering — commit to it in cold state</li>
        <li>Disable P&L display on your platform during live trades</li>
        <li>Only move stoplosses in the direction of the trade, never to breakeven prematurely</li>
      </ul>
    `
  },
  processgoals: {
    title: 'Process Goals vs. Outcome Goals',
    content: `
      <p>Most traders set outcome goals: "I want to make $5,000 this month." Professionals set process goals: "I will follow my checklist on every entry, log every trade, and take a break after 2 losses." The difference is transformational.</p>
      <h3>Why Outcome Goals Hurt</h3>
      <ul>
        <li>They create pressure that triggers emotional trading</li>
        <li>They make you feel like a failure on bad days even when you traded well</li>
        <li>They encourage revenge trading to "hit the number"</li>
        <li>They're not within your control — the market decides outcomes</li>
      </ul>
      <div class="callout">"You cannot control whether a trade wins. You can always control whether you followed your process."</div>
      <h3>Setting Process Goals</h3>
      <ul>
        <li>Log every trade with emotion state: 30-day goal</li>
        <li>Complete check-in before trading: every session</li>
        <li>Only enter when setup quality is 4+/5: this week</li>
        <li>Achieve 80%+ rule adherence this month</li>
        <li>Do not trade after 2 losses in a day: zero exceptions</li>
      </ul>
      <p>When process is the goal, a losing day where you executed perfectly is a <strong>success</strong>. This mindset is what separates professionals from gamblers.</p>
    `
  },
};

function initPsychologyLab() {
  // Sliders
  ['ciSleep', 'ciStress', 'ciFocus', 'ciStability'].forEach(id => {
    const slider = document.getElementById(id);
    const valEl  = document.getElementById(`${id}Val`);
    slider.addEventListener('input', () => {
      valEl.textContent = slider.value;
      updateTradeReadiness();
    });
  });

  // Save check-in
  document.getElementById('saveCheckinBtn').addEventListener('click', saveCheckin);

  // Lessons - add lock indicator for free users
  document.querySelectorAll('.lesson-read-btn').forEach(btn => {
    btn.addEventListener('click', () => openLesson(btn.dataset.lesson));
    if (!PRO.active) {
      btn.textContent = '🔒 Pro';
      btn.title = 'Upgrade to Pro to read lessons';
    }
  });
  document.getElementById('lessonModalClose').addEventListener('click', () => hideModal('lessonModal'));
  document.getElementById('lessonModal').addEventListener('click', e => {
    if (e.target === e.currentTarget) hideModal('lessonModal');
  });

  updateTradeReadiness();
}

function updateTradeReadiness() {
  const sleep    = parseInt(document.getElementById('ciSleep').value);
  const stress   = parseInt(document.getElementById('ciStress').value);
  const focus    = parseInt(document.getElementById('ciFocus').value);
  const stability= parseInt(document.getElementById('ciStability').value);

  // Higher stress = worse, so invert it
  const score = Math.round(((sleep + (10 - stress) + focus + stability) / 40) * 100);
  const el    = document.getElementById('trScore');
  el.textContent = `${score}%`;
  el.style.color = score >= 70 ? 'var(--green)' : score >= 50 ? 'var(--yellow)' : 'var(--red)';
  document.getElementById('trMsg').textContent =
    score >= 80 ? '🟢 You are ready to trade. Execute your plan.' :
    score >= 65 ? '🟡 Trade with caution. Reduce size by 50%.' :
    score >= 50 ? '🟠 Consider paper trading only today.' :
    '🔴 Not recommended to trade today. Rest and reset.';
}

function saveCheckin() {
  const checkin = {
    date: new Date().toISOString().slice(0, 10),
    sleep:     parseInt(document.getElementById('ciSleep').value),
    stress:    parseInt(document.getElementById('ciStress').value),
    focus:     parseInt(document.getElementById('ciFocus').value),
    stability: parseInt(document.getElementById('ciStability').value),
    savedAt: new Date().toISOString(),
  };
  const checkins = DB.checkins.filter(c => c.date !== checkin.date);
  checkins.push(checkin);
  DB.checkins = checkins;
  toast('Check-in saved! Have a disciplined session. 🎯', 'success');
}

function openLesson(key) {
  if (!PRO.canLesson()) {
    showUpgradeModal('Psychology Lessons');
    return;
  }
  const lesson = LESSONS[key];
  if (!lesson) return;
  document.getElementById('lessonModalTitle').textContent = lesson.title;
  document.getElementById('lessonContent').innerHTML = lesson.content;
  showModal('lessonModal');
}

/* ────────────────────────────────────────────────────────────
   SETTINGS
──────────────────────────────────────────────────────────── */
function loadSettings() {
  const s = DB.settings;
  if (s.name)         document.getElementById('settingName').value = s.name || '';
  if (s.currency)     document.getElementById('settingCurrency').value = s.currency || 'USD';
  if (s.startingBalance) document.getElementById('settingBalance').value = s.startingBalance || '';
  if (s.riskPerTrade) document.getElementById('settingRisk').value = s.riskPerTrade || '';
  if (s.maxDailyLoss) document.getElementById('settingDailyLoss').value = s.maxDailyLoss || '';
  if (s.maxDailyTrades) document.getElementById('settingMaxTrades').value = s.maxDailyTrades || '';
  if (s.minRR)        document.getElementById('settingMinRR').value = s.minRR || '';

  const notifJournal   = document.getElementById('notifJournal');
  const notifLossStreak= document.getElementById('notifLossStreak');
  const notifDailyLimit= document.getElementById('notifDailyLimit');
  if (s.notifJournal !== undefined) notifJournal.checked = s.notifJournal;
  if (s.notifLossStreak !== undefined) notifLossStreak.checked = s.notifLossStreak;
  if (s.notifDailyLimit !== undefined) notifDailyLimit.checked = s.notifDailyLimit;
}

function initSettingsPage() {
  document.getElementById('saveSettingsBtn').addEventListener('click', () => {
    const s = {
      name:            document.getElementById('settingName').value.trim(),
      currency:        document.getElementById('settingCurrency').value,
      startingBalance: parseFloat(document.getElementById('settingBalance').value) || null,
      riskPerTrade:    parseFloat(document.getElementById('settingRisk').value) || null,
      maxDailyLoss:    parseFloat(document.getElementById('settingDailyLoss').value) || null,
      maxDailyTrades:  parseInt(document.getElementById('settingMaxTrades').value) || null,
      minRR:           parseFloat(document.getElementById('settingMinRR').value) || null,
      notifJournal:    document.getElementById('notifJournal').checked,
      notifLossStreak: document.getElementById('notifLossStreak').checked,
      notifDailyLimit: document.getElementById('notifDailyLimit').checked,
    };
    DB.settings = s;
    toast('Settings saved!', 'success');
    updateGreeting();
    // Propagate settings everywhere
    renderDashboard();
    if (activeView === 'analytics') renderAnalytics();
    if (activeView === 'journal') renderJournal();
  });

  document.getElementById('exportAllBtn').addEventListener('click', exportCSV);

  document.getElementById('importBtn').addEventListener('click', () => {
    document.getElementById('importFileInput').click();
  });

  document.getElementById('importFileInput').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        importCSV(ev.target.result);
      } catch {
        toast('Import failed. Please check the CSV format.', 'error');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  });

  document.getElementById('clearDataBtn').addEventListener('click', () => {
    if (!confirm('Delete ALL trade data? This cannot be undone.')) return;
    DB.trades = [];
    DB.challenges = [];
    DB.checkins = [];
    toast('All data cleared.', 'info');
    renderDashboard();
  });

  initMT4Import();
}

function importCSV(text) {
  // Security: limit import size to 2MB
  if (text.length > 2 * 1024 * 1024) { toast('File too large. Max 2MB.', 'error'); return; }
  const lines = text.trim().split('\n');
  if (lines.length < 2) { toast('CSV appears empty.', 'warn'); return; }

  const headers = lines[0].split(',').map(h => h.replace(/"/g, '').trim().toLowerCase());
  let imported = 0;

  const trades = DB.trades;

  for (let i = 1; i < lines.length; i++) {
    const vals = lines[i].match(/(".*?"|[^,]+)(?=,|$)/g) || [];
    const row  = {};
    headers.forEach((h, idx) => {
      row[h] = (vals[idx] || '').replace(/^"|"$/g, '').trim();
    });

    const trade = {
      id: uid(),
      instrument: row['instrument'] || row['pair'] || '',
      direction:  row['direction'] || 'LONG',
      outcome:    row['outcome'] || 'WIN',
      pnl:        row['p&l'] !== '' ? parseFloat(row['p&l']) : null,
      emotion:    row['emotion'] || null,
      session:    row['session'] || '',
      notes:      row['notes'] || '',
      datetime:   row['date'] || new Date().toISOString().slice(0, 16),
      createdAt:  new Date().toISOString(),
    };

    if (!trade.instrument) continue;
    trades.push(trade);
    imported++;
  }

  DB.trades = trades;
  toast(`Imported ${imported} trades!`, 'success');
  renderDashboard();
}

/* ────────────────────────────────────────────────────────────
   TOP BAR ACTIONS
──────────────────────────────────────────────────────────── */
function initTopBarActions() {
  document.getElementById('missionDismiss').addEventListener('click', () => {
    document.getElementById('missionBanner').classList.add('hidden');
  });

  // Free limit bar upgrade CTA
  document.getElementById('flbUpgradeBtn')?.addEventListener('click', () => showUpgradeModal('Unlimited trade logging'));
}

/* ────────────────────────────────────────────────────────────
   DAILY ALERTS
──────────────────────────────────────────────────────────── */
function checkDailyAlerts() {
  const trades   = DB.trades;
  const settings = DB.settings;
  const todayStr = new Date().toISOString().slice(0, 10);
  const today    = trades.filter(t => (t.datetime || '').startsWith(todayStr));
  const todayPnl = today.reduce((s, t) => s + (parseFloat(t.pnl) || 0), 0);

  if (settings.maxDailyLoss && settings.startingBalance) {
    const limit = -parseFloat(settings.startingBalance) * parseFloat(settings.maxDailyLoss) / 100;
    if (todayPnl <= limit * 0.8 && today.length > 0) {
      if (settings.notifDailyLimit) {
        const msg = `⚠️ Approaching daily loss limit: ${fmt(todayPnl)}`;
        toast(msg, 'warn', 5000);
        addNotification(msg, 'warn');
      }
    }
  }

  // Max daily trades warning
  if (settings.maxDailyTrades && today.length >= parseInt(settings.maxDailyTrades)) {
    const msg = `🛑 Daily trade limit reached (${today.length}/${settings.maxDailyTrades}). Stop trading!`;
    addNotification(msg, 'danger');
  }
}

/* ────────────────────────────────────────────────────────────
   PWA INSTALL PROMPT
──────────────────────────────────────────────────────────── */
function initPWAInstallPrompt() {
  const modal  = document.getElementById('pwaInstallModal');
  const fab    = document.getElementById('pwaInstallFab');
  const banner = document.getElementById('installBanner');
  if (!modal) return;

  const isIOS        = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
  if (isStandalone) return; // already running as installed app

  const hasDismissed = !!localStorage.getItem('trafxos_pwa_dismissed');
  const visitCount   = parseInt(localStorage.getItem('trafxos_visit_count') || '0') + 1;
  localStorage.setItem('trafxos_visit_count', String(visitCount));
  const isFirstVisit = visitCount === 1;

  const openInstallModal = () => {
    if (isIOS) {
      document.getElementById('pwaModalInstallBtn')?.classList.add('hidden');
      document.getElementById('pwaIosHint')?.classList.remove('hidden');
    }
    modal.classList.remove('hidden');
  };

  const showBanner = () => {
    if (!hasDismissed && banner) banner.classList.remove('hidden');
  };

  // iOS: no beforeinstallprompt — show banner & modal manually
  if (isIOS && !hasDismissed) {
    setTimeout(showBanner, isFirstVisit ? 3000 : 8000);
    if (isFirstVisit) setTimeout(openInstallModal, 20000);
  }

  // Android / Chrome / Desktop — triggered by the browser
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredInstallPrompt = e;
    if (hasDismissed) return;

    // First-time users: show banner fast, then open the full modal
    if (isFirstVisit) {
      setTimeout(showBanner, 1500);
      setTimeout(openInstallModal, 5000); // full install modal after 5s
    } else {
      // Returning users: just show the subtle FAB
      setTimeout(() => fab?.classList.remove('hidden'), 4000);
    }
  });

  // Banner “Install” button
  document.getElementById('installBannerBtn')?.addEventListener('click', async () => {
    if (deferredInstallPrompt) {
      banner?.classList.add('hidden');
      deferredInstallPrompt.prompt();
      const { outcome } = await deferredInstallPrompt.userChoice;
      deferredInstallPrompt = null;
      fab?.classList.add('hidden');
      if (outcome === 'accepted') {
        toast('TrafxOS installed! 🎉 Find it on your home screen.', 'success', 4000);
      } else {
        // User declined the native prompt — show the full modal with more info
        openInstallModal();
      }
    } else {
      banner?.classList.add('hidden');
      openInstallModal();
    }
  });

  // Banner dismiss
  document.getElementById('installBannerDismiss')?.addEventListener('click', () => {
    banner?.classList.add('hidden');
    // Don’t permanently dismiss — just hide for this session (keep FAB visible)
    fab?.classList.remove('hidden');
  });

  // FAB opens the full install modal
  fab?.addEventListener('click', () => {
    banner?.classList.add('hidden');
    openInstallModal();
  });

  // Modal install button
  document.getElementById('pwaModalInstallBtn')?.addEventListener('click', async () => {
    if (deferredInstallPrompt) {
      deferredInstallPrompt.prompt();
      const { outcome } = await deferredInstallPrompt.userChoice;
      deferredInstallPrompt = null;
      modal.classList.add('hidden');
      fab?.classList.add('hidden');
      banner?.classList.add('hidden');
      if (outcome === 'accepted') toast('TrafxOS installed! 🎉 Find it on your home screen.', 'success', 4000);
    } else if (!isIOS) {
      modal.classList.add('hidden');
      toast('Open your browser menu → “Add to Home Screen” to install.', 'info', 5000);
    }
  });

  const dismissAll = () => {
    modal.classList.add('hidden');
    fab?.classList.add('hidden');
    banner?.classList.add('hidden');
    localStorage.setItem('trafxos_pwa_dismissed', '1');
  };
  document.getElementById('pwaModalLater')?.addEventListener('click', dismissAll);
  document.getElementById('pwaModalClose')?.addEventListener('click', dismissAll);
  document.querySelector('.pwa-full-backdrop')?.addEventListener('click', dismissAll);
}

/* ────────────────────────────────────────────────────────────
   AUTH MODAL
──────────────────────────────────────────────────────────── */
function initAuthModal() {
  const authBtn = document.getElementById('authBtn');
  authBtn?.addEventListener('click', () => showModal('authModal'));
  document.getElementById('authModalClose')?.addEventListener('click', () => hideModal('authModal'));
  document.getElementById('authModal')?.addEventListener('click', e => {
    if (e.target === e.currentTarget) hideModal('authModal');
  });

  document.getElementById('googleSignInBtn')?.addEventListener('click', () => FIREBASE.signInWithGoogle());

  document.getElementById('emailSignInBtn')?.addEventListener('click', () => {
    const email = document.getElementById('authEmail')?.value.trim();
    const pw    = document.getElementById('authPassword')?.value;
    if (!email || !pw) { toast('Enter your email and password.', 'warn'); return; }
    FIREBASE.signInWithEmail(email, pw);
  });

  document.getElementById('emailSignUpBtn')?.addEventListener('click', () => {
    const email = document.getElementById('authEmail')?.value.trim();
    const pw    = document.getElementById('authPassword')?.value;
    if (!email || !pw) { toast('Enter your email and a password to create an account.', 'warn'); return; }
    if (pw.length < 6)  { toast('Password must be at least 6 characters.', 'warn'); return; }
    FIREBASE.signUp(email, pw);
  });

  document.getElementById('signOutBtn')?.addEventListener('click', () => FIREBASE.signOut());

  document.getElementById('upgradeFromAuthBtn')?.addEventListener('click', () => {
    hideModal('authModal');
    showUpgradeModal('Cloud sync & Pro features');
  });
}

/* ────────────────────────────────────────────────────────────
   UPGRADE MODAL
──────────────────────────────────────────────────────────── */
function initUpgradeModal() {
  let billingPeriod = 'monthly';

  const setPeriod = (period) => {
    billingPeriod = period;
    const isAnnual = period === 'annual';
    document.getElementById('billMonthly').classList.toggle('active', !isAnnual);
    document.getElementById('billAnnual').classList.toggle('active', isAnnual);
    const label = document.getElementById('checkoutBtnLabel');
    if (label) {
      label.textContent = isAnnual
        ? 'Get Pro — $149/year ($12/mo)'
        : 'Get Pro — $19/month';
    }
  };

  document.getElementById('upgradeModalClose')?.addEventListener('click', () => {
    hideModal('upgradeModal');
    document.getElementById('upgradeFeatureRow')?.classList.add('hidden');
  });
  document.getElementById('upgradeModal')?.addEventListener('click', e => {
    if (e.target === e.currentTarget) hideModal('upgradeModal');
  });

  document.getElementById('billMonthly')?.addEventListener('click', () => setPeriod('monthly'));
  document.getElementById('billAnnual')?.addEventListener('click',  () => setPeriod('annual'));

  // Checkout via Flutterwave
  document.getElementById('upgradeCheckoutBtn')?.addEventListener('click', () => {
    // Auto-fill from signed-in user
    const u = FIREBASE.user;
    const emailEl = document.getElementById('checkoutEmail');
    const nameEl  = document.getElementById('checkoutName');
    if (u && emailEl && !emailEl.value) emailEl.value = u.email || '';
    if (u && nameEl  && !nameEl.value)  nameEl.value  = u.displayName || '';

    const email = (emailEl?.value || '').trim();
    const name  = (nameEl?.value  || '').trim() || 'Trader';

    // Email is required by Flutterwave
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      emailEl?.focus();
      toast('Please enter a valid email address to continue.', 'warn');
      return;
    }

    const isAnnual = billingPeriod === 'annual';
    const amount   = isAnnual ? (window.FLW_ANNUAL_USD  || 149) : (window.FLW_MONTHLY_USD || 19);
    const currency = window.FLW_CURRENCY || 'USD';
    const pubKey   = (window.FLW_PUBLIC_KEY || '').trim();

    // Validate it’s a real Flutterwave public key (must start with FLWPUBK)
    if (!pubKey.toUpperCase().startsWith('FLWPUBK')) {
      toast('Payment is being set up. Use your Pro key below, or email hello@trafxos.com for early access.', 'info', 7000);
      return;
    }

    if (typeof FlutterwaveCheckout !== 'function') {
      toast('Payment SDK not loaded. Check your connection and reload the page.', 'warn', 5000);
      return;
    }

    const txRef = 'TRAFXOS-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7).toUpperCase();

    try {
      FlutterwaveCheckout({
        public_key:      pubKey,
        tx_ref:          txRef,
        amount,
        currency,
        payment_options: 'card,banktransfer,ussd',
        meta: {
          plan:    isAnnual ? 'annual' : 'monthly',
          product: 'TrafxOS Pro',
        },
        customer: { email, name },
        customizations: {
          title:       'TrafxOS Pro',
          description: isAnnual ? 'Annual Pro subscription' : 'Monthly Pro subscription',
          logo:        'https://trafxos.netlify.app/icons/icon-192.png',
        },
        callback(data) {
          if (data.status === 'successful' || data.status === 'completed') {
            localStorage.setItem('trafxos_flw_tx', String(data.transaction_id || txRef));
            activateProFull();
            hideModal('upgradeModal');
            toast('\uD83C\uDF89 Pro unlocked! Welcome to TrafxOS Pro. Check your email for the receipt.', 'success', 7000);
          }
        },
        onclose() {},
      });
    } catch (err) {
      toast('Payment could not open: ' + err.message, 'error', 5000);
    }
  });

  // Pro key activation
  document.getElementById('proKeyApplyBtn')?.addEventListener('click', () => {
    const code = (document.getElementById('proKeyInput')?.value || '').trim();
    if (!code) { toast('Enter your Pro key first.', 'warn'); return; }
    if (PRO.activate(code)) {
      activateProFull();
      hideModal('upgradeModal');
      document.getElementById('upgradeFeatureRow')?.classList.add('hidden');
      toast('\uD83C\uDF89 Pro key accepted! Full access unlocked.', 'success', 5000);
    } else {
      toast('Invalid Pro key. Double-check for typos or contact hello@trafxos.com.', 'error');
    }
  });
  document.getElementById('proKeyInput')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('proKeyApplyBtn')?.click();
  });
}

/* ────────────────────────────────────────────────────────────
   NOTIFICATION PANEL & PUSH NOTIFICATIONS
──────────────────────────────────────────────────────────── */
const NotifStore = {
  KEY: 'trafxos_notifications',
  get all() { return JSON.parse(localStorage.getItem(this.KEY) || '[]'); },
  set all(v) { localStorage.setItem(this.KEY, JSON.stringify(v)); },
  add(msg, type) {
    const arr = this.all;
    arr.unshift({ id: uid(), msg, type: type || 'info', time: new Date().toISOString(), read: false });
    if (arr.length > 50) arr.length = 50;
    this.all = arr;
    updateNotifBadge();
  },
  clear() { this.all = []; updateNotifBadge(); },
};

function updateNotifBadge() {
  const unread = NotifStore.all.filter(n => !n.read).length;
  const dot = document.getElementById('notifDot');
  if (dot) dot.classList.toggle('hidden', unread === 0);
}

function renderNotifPanel() {
  const list = document.getElementById('notifList');
  const notifs = NotifStore.all;
  if (!notifs.length) {
    list.innerHTML = '<div class="notif-empty">No notifications yet. Trade well!</div>';
    return;
  }
  list.innerHTML = notifs.slice(0, 20).map(n => `
    <div class="notif-item ${n.read ? '' : 'unread'}">
      <div class="notif-msg">${sanitize(n.msg)}</div>
      <div class="notif-time">${fmtDateTime(n.time)}</div>
    </div>
  `).join('');
  // Mark all as read
  const updated = NotifStore.all.map(n => ({ ...n, read: true }));
  NotifStore.all = updated;
  updateNotifBadge();
}

function initNotifPanel() {
  const panel = document.getElementById('notifPanel');
  document.getElementById('notifBtn').addEventListener('click', () => {
    panel.classList.toggle('hidden');
    if (!panel.classList.contains('hidden')) renderNotifPanel();
  });
  document.getElementById('notifClearAll').addEventListener('click', () => {
    NotifStore.clear();
    renderNotifPanel();
  });
  // Close panel when clicking outside
  document.addEventListener('click', e => {
    if (!panel.contains(e.target) && !document.getElementById('notifBtn').contains(e.target)) {
      panel.classList.add('hidden');
    }
  });
  updateNotifBadge();
}

function addNotification(msg, type) {
  NotifStore.add(msg, type);
  // Try sending a native push notification if granted
  if ('Notification' in window && Notification.permission === 'granted') {
    try {
      new Notification('TrafxOS', { body: msg, icon: 'https://i.postimg.cc/PxH6xwBr/web-app-manifest-192x192.png', badge: 'https://i.postimg.cc/PxH6xwBr/web-app-manifest-192x192.png' });
    } catch (_) { /* ignore if fails */ }
  }
}

function requestNotifPermission() {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'default') {
    Notification.requestPermission();
  }
}

/* ────────────────────────────────────────────────────────────
   FEEDBACK SYSTEM
──────────────────────────────────────────────────────────── */
function initFeedback() {
  let feedbackRating = 0;
  const fab = document.getElementById('feedbackFab');
  const modal = document.getElementById('feedbackModal');
  if (!fab || !modal) return;

  fab.addEventListener('click', () => showModal('feedbackModal'));
  document.getElementById('feedbackModalClose').addEventListener('click', () => hideModal('feedbackModal'));
  modal.addEventListener('click', e => { if (e.target === e.currentTarget) hideModal('feedbackModal'); });

  document.getElementById('feedbackEmojiRow').addEventListener('click', e => {
    const btn = e.target.closest('.fb-emoji-btn');
    if (!btn) return;
    document.querySelectorAll('.fb-emoji-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    feedbackRating = parseInt(btn.dataset.rating);
  });

  document.getElementById('feedbackSubmitBtn').addEventListener('click', () => {
    const text = document.getElementById('feedbackText').value.trim();
    if (!feedbackRating) { toast('Please select a rating emoji first.', 'warn'); return; }
    // Store feedback locally + send to Firestore if signed in
    const feedback = {
      rating: feedbackRating,
      text,
      timestamp: new Date().toISOString(),
      userId: FIREBASE.user?.uid || 'anonymous',
    };
    const stored = JSON.parse(localStorage.getItem('trafxos_feedback') || '[]');
    stored.push(feedback);
    localStorage.setItem('trafxos_feedback', JSON.stringify(stored));
    // Send to Firestore if available
    if (FIREBASE.db && FIREBASE.user) {
      FIREBASE.db.collection('feedback').add(feedback).catch(() => {});
    }
    hideModal('feedbackModal');
    feedbackRating = 0;
    document.getElementById('feedbackText').value = '';
    document.querySelectorAll('.fb-emoji-btn').forEach(b => b.classList.remove('active'));
    toast('Thanks for your feedback! We read every one.', 'success');
  });
}

/* ────────────────────────────────────────────────────────────
   SCREENSHOT UPLOAD
──────────────────────────────────────────────────────────── */
function initScreenshotUpload() {
  const fileInput = document.getElementById('screenshotFileInput');
  const dropzone = document.getElementById('screenshotDropzone');
  const preview = document.getElementById('screenshotPreview');
  const previewImg = document.getElementById('screenshotPreviewImg');
  const removeBtn = document.getElementById('screenshotRemoveBtn');
  if (!fileInput || !dropzone) return;

  dropzone.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', e => {
    const file = e.target.files[0];
    if (file) processScreenshot(file);
  });

  // Drag & drop
  dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('dragover'); });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
  dropzone.addEventListener('drop', e => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) processScreenshot(file);
  });

  removeBtn.addEventListener('click', () => {
    formState.screenshotData = null;
    fileInput.value = '';
    preview.classList.add('hidden');
    dropzone.classList.remove('hidden');
  });

  function processScreenshot(file) {
    if (file.size > 1024 * 1024) {
      toast('Image too large. Max 1MB — try a smaller screenshot.', 'warn');
      return;
    }
    if (!file.type.startsWith('image/')) {
      toast('Please select an image file (JPG, PNG, WebP).', 'warn');
      return;
    }
    const reader = new FileReader();
    reader.onload = ev => {
      // Compress by drawing to canvas
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const maxW = 800, maxH = 600;
        let w = img.width, h = img.height;
        if (w > maxW) { h = h * (maxW / w); w = maxW; }
        if (h > maxH) { w = w * (maxH / h); h = maxH; }
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        const compressed = canvas.toDataURL('image/jpeg', 0.7);
        formState.screenshotData = compressed;
        previewImg.src = compressed;
        preview.classList.remove('hidden');
        dropzone.classList.add('hidden');
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  }
}

/* ────────────────────────────────────────────────────────────
   MT4 / MT5 TRADE IMPORT
──────────────────────────────────────────────────────────── */
function initMT4Import() {
  document.getElementById('importMT4Btn').addEventListener('click', () => {
    document.getElementById('importMT4FileInput').click();
  });

  document.getElementById('importMT4FileInput').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { toast('File too large. Max 5MB.', 'error'); return; }
    const reader = new FileReader();
    const isHTML = file.name.endsWith('.htm') || file.name.endsWith('.html');
    reader.onload = ev => {
      try {
        if (isHTML) {
          importMT4HTML(ev.target.result);
        } else {
          importMT5CSV(ev.target.result);
        }
      } catch (err) {
        toast('Import failed. Please check the file format.', 'error');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  });
}

function importMT4HTML(html) {
  // MT4 exports trade history as HTML tables
  // Parse by creating a temporary DOM element
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const rows = doc.querySelectorAll('tr');
  let imported = 0;
  const trades = DB.trades;

  for (const row of rows) {
    const cells = row.querySelectorAll('td');
    if (cells.length < 13) continue;

    const ticket = cells[0]?.textContent?.trim();
    const openTime = cells[1]?.textContent?.trim();
    const type = cells[2]?.textContent?.trim()?.toLowerCase();
    const size = cells[3]?.textContent?.trim();
    const item = cells[4]?.textContent?.trim();
    const closeTime = cells[8]?.textContent?.trim();
    const profit = cells[12]?.textContent?.trim();

    // Only import buy/sell trades, skip balance/deposit/withdrawal lines
    if (!type || (!type.includes('buy') && !type.includes('sell'))) continue;
    if (!item || !openTime) continue;

    const instrument = normalizeInstrument(item);
    const direction = type.includes('buy') ? 'LONG' : 'SHORT';
    const pnl = parseFloat(profit) || 0;
    const outcome = pnl > 0 ? 'WIN' : pnl < 0 ? 'LOSS' : 'BE';

    // Parse MT4 date format (usually yyyy.mm.dd hh:mm)
    const dt = parseMT4Date(openTime);

    trades.push({
      id: uid(),
      instrument,
      direction,
      outcome,
      pnl,
      lotSize: parseFloat(size) || null,
      session: guessSession(dt),
      emotion: null,
      setupQuality: null,
      mistakes: [],
      rules: { plan: false, sl: false, rr: false, session: false, size: false },
      notes: `Imported from MT4 (Ticket #${ticket})`,
      screenshot: '',
      datetime: dt,
      createdAt: new Date().toISOString(),
      source: 'mt4',
    });
    imported++;
  }

  if (imported > 0) {
    DB.trades = trades;
    if (FIREBASE.user) FIREBASE.syncTrades();
    toast(`Imported ${imported} trades from MT4! Add emotions & rules for deeper insights.`, 'success', 5000);
    renderDashboard();
  } else {
    toast('No trades found in the MT4 report. Ensure you exported the Account History as a "Detailed Report".', 'warn', 5000);
  }
}

function importMT5CSV(text) {
  if (text.length > 5 * 1024 * 1024) { toast('File too large. Max 5MB.', 'error'); return; }
  const lines = text.trim().split('\n');
  if (lines.length < 2) { toast('CSV appears empty.', 'warn'); return; }

  const headers = lines[0].split(/[,\t]/).map(h => h.replace(/"/g, '').trim().toLowerCase());
  let imported = 0;
  const trades = DB.trades;

  // MT5 CSV typical headers: Ticket, Open Time, Type, Volume, Symbol, Price, S/L, T/P, Close Time, Close Price, Commission, Swap, Profit
  const getCol = (row, ...names) => {
    for (const name of names) {
      const idx = headers.indexOf(name);
      if (idx !== -1 && row[idx]) return row[idx].replace(/^"|"$/g, '').trim();
    }
    return '';
  };

  for (let i = 1; i < lines.length; i++) {
    const vals = lines[i].split(/[,\t]/).map(v => v.replace(/^"|"$/g, '').trim());
    if (vals.length < 5) continue;

    const ticket = getCol(vals, 'ticket', 'order', 'deal');
    const type = getCol(vals, 'type', 'direction').toLowerCase();
    const symbol = getCol(vals, 'symbol', 'item', 'instrument');
    const volume = getCol(vals, 'volume', 'lots', 'size');
    const openTime = getCol(vals, 'open time', 'time', 'open date');
    const profit = getCol(vals, 'profit', 'p/l', 'net profit');
    const entry = getCol(vals, 'price', 'open price', 'entry');
    const closePrice = getCol(vals, 'close price', 'exit');
    const sl = getCol(vals, 's/l', 'sl', 'stop loss');
    const tp = getCol(vals, 't/p', 'tp', 'take profit');

    if (!symbol) continue;
    if (!type.includes('buy') && !type.includes('sell')) continue;

    const instrument = normalizeInstrument(symbol);
    const direction = type.includes('buy') ? 'LONG' : 'SHORT';
    const pnl = parseFloat(profit) || 0;
    const outcome = pnl > 0 ? 'WIN' : pnl < 0 ? 'LOSS' : 'BE';
    const dt = openTime ? openTime.replace(/\./g, '-').slice(0, 16) : new Date().toISOString().slice(0, 16);

    trades.push({
      id: uid(),
      instrument,
      direction,
      outcome,
      pnl,
      entry: parseFloat(entry) || null,
      exit: parseFloat(closePrice) || null,
      sl: parseFloat(sl) || null,
      tp: parseFloat(tp) || null,
      lotSize: parseFloat(volume) || null,
      session: guessSession(dt),
      emotion: null,
      setupQuality: null,
      mistakes: [],
      rules: { plan: false, sl: !!parseFloat(sl), rr: false, session: false, size: false },
      notes: `Imported from MT5 (Ticket #${ticket})`,
      screenshot: '',
      datetime: dt,
      createdAt: new Date().toISOString(),
      source: 'mt5',
    });
    imported++;
  }

  if (imported > 0) {
    DB.trades = trades;
    if (FIREBASE.user) FIREBASE.syncTrades();
    toast(`Imported ${imported} trades from MT5! Add emotions & rules for deeper insights.`, 'success', 5000);
    renderDashboard();
  } else {
    toast('No trades found. Ensure the CSV has columns like Symbol, Type, Profit.', 'warn', 5000);
  }
}

function normalizeInstrument(raw) {
  const s = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const map = {
    EURUSD: 'EUR/USD', GBPUSD: 'GBP/USD', USDJPY: 'USD/JPY', USDCHF: 'USD/CHF',
    AUDUSD: 'AUD/USD', NZDUSD: 'NZD/USD', USDCAD: 'USD/CAD', EURGBP: 'EUR/GBP',
    EURJPY: 'EUR/JPY', GBPJPY: 'GBP/JPY', XAUUSD: 'XAU/USD', XAGUSD: 'XAG/USD',
    BTCUSD: 'BTC/USD', ETHUSD: 'ETH/USD', NAS100: 'NAS100', US30: 'US30',
    USTEC: 'NAS100', US500: 'SPX500',
  };
  return map[s] || raw.toUpperCase();
}

function parseMT4Date(str) {
  // MT4 format: "2024.01.15 14:30" or "2024.01.15 14:30:00"
  return str.replace(/\./g, '-').replace(/\s/, 'T').slice(0, 16);
}

function guessSession(dt) {
  try {
    const h = new Date(dt).getUTCHours();
    if (h >= 0 && h < 7) return 'Asia';
    if (h >= 7 && h < 12) return 'London';
    if (h >= 12 && h < 16) return 'Overlap';
    return 'NY';
  } catch { return ''; }
}

/* ────────────────────────────────────────────────────────────
   SMART ALERTS (personalized, data-driven)
──────────────────────────────────────────────────────────── */
function initSmartAlerts() {
  renderSmartAlerts();
}

function renderSmartAlerts() {
  const feed = document.getElementById('smartAlertsFeed');
  if (!feed) return;
  const alerts = generateSmartAlerts();

  if (!alerts.length) {
    feed.innerHTML = `<div class="smart-alert-placeholder"><i class="fa-solid fa-brain"></i> Log more trades to unlock personalized smart alerts based on YOUR data.</div>`;
    return;
  }

  const visible = PRO.active ? alerts : alerts.slice(0, 2);
  let html = visible.map(a => `
    <div class="smart-alert smart-alert-${a.urgency}">
      <div class="sa-icon">${a.icon}</div>
      <div class="sa-body">
        <strong>${sanitize(a.title)}</strong>
        <p>${sanitize(a.body)}</p>
      </div>
    </div>
  `).join('');

  if (!PRO.active && alerts.length > 2) {
    html += `<div class="smart-alert smart-alert-locked" style="cursor:pointer" onclick="showUpgradeModal('All Smart Alerts')">
      <div class="sa-icon">🔒</div>
      <div class="sa-body"><strong>${alerts.length - 2} more alerts hidden</strong><p>Upgrade to Pro to see all personalized alerts.</p></div>
    </div>`;
  }
  feed.innerHTML = html;
}

function generateSmartAlerts() {
  const trades = DB.trades;
  if (trades.length < 3) return [];
  const alerts = [];
  const now = new Date();
  const dayName = now.toLocaleDateString('en-US', { weekday: 'long' });
  const dayShort = now.toLocaleDateString('en-US', { weekday: 'short' });
  const hour = now.getHours();
  const todayStr = now.toISOString().slice(0, 10);
  const todayTrades = trades.filter(t => (t.datetime || '').startsWith(todayStr));

  // 1) Day-of-week analysis
  const dowTrades = trades.filter(t => {
    if (!t.datetime) return false;
    return new Date(t.datetime).toLocaleDateString('en-US', { weekday: 'short' }) === dayShort;
  });
  if (dowTrades.length >= 3) {
    const dowWins = dowTrades.filter(t => t.outcome === 'WIN').length;
    const dowWR = Math.round((dowWins / dowTrades.length) * 100);
    const dowPnl = dowTrades.reduce((s, t) => s + (parseFloat(t.pnl) || 0), 0);
    if (dowWR < 40) {
      alerts.push({ icon: '📅', title: `${dayName}s are tough for you`, body: `Your win rate on ${dayName}s is only ${dowWR}% across ${dowTrades.length} trades (${fmt(dowPnl)} total). Consider reducing size or sitting out.`, urgency: 'danger' });
    } else if (dowWR >= 65) {
      alerts.push({ icon: '📅', title: `${dayName}s are your day!`, body: `Win rate: ${dowWR}% on ${dayName}s (${dowTrades.length} trades, ${fmt(dowPnl)}). Execute your best setups with confidence.`, urgency: 'positive' });
    }
  }

  // 2) Session-aware alert
  const currentSession = hour >= 0 && hour < 7 ? 'Asia' : hour < 12 ? 'London' : hour < 16 ? 'Overlap' : 'NY';
  const sessionTrades = trades.filter(t => t.session === currentSession);
  if (sessionTrades.length >= 3) {
    const sWins = sessionTrades.filter(t => t.outcome === 'WIN').length;
    const sWR = Math.round((sWins / sessionTrades.length) * 100);
    if (sWR < 35) {
      alerts.push({ icon: '🕐', title: `${currentSession} session is weak`, body: `Only ${sWR}% win rate in ${currentSession} (${sessionTrades.length} trades). Your best edge may be in a different session.`, urgency: 'warn' });
    } else if (sWR >= 60) {
      alerts.push({ icon: '🕐', title: `${currentSession} is your strong session`, body: `${sWR}% win rate in ${currentSession} session. You're in your zone — stick to your rules.`, urgency: 'positive' });
    }
  }

  // 3) Instrument-specific alert for today's day
  const instMap = {};
  for (const t of trades) {
    if (!t.instrument || !t.datetime) continue;
    const d = new Date(t.datetime).toLocaleDateString('en-US', { weekday: 'short' });
    const key = `${t.instrument}__${d}`;
    if (!instMap[key]) instMap[key] = { wins: 0, total: 0, pnl: 0 };
    instMap[key].total++;
    instMap[key].pnl += parseFloat(t.pnl) || 0;
    if (t.outcome === 'WIN') instMap[key].wins++;
  }
  for (const [key, data] of Object.entries(instMap)) {
    const [inst, d] = key.split('__');
    if (d !== dayShort || data.total < 3) continue;
    const wr = Math.round((data.wins / data.total) * 100);
    if (wr < 30) {
      alerts.push({ icon: '⚠️', title: `Avoid ${inst} on ${dayName}s`, body: `You LOSE ${100 - wr}% of ${inst} trades on ${dayName}s (${data.total} trades). Today is ${dayName} — be careful.`, urgency: 'danger' });
    }
  }

  // 4) Overtrading detection
  if (todayTrades.length >= 3) {
    const lastHourTrades = todayTrades.filter(t => {
      const td = new Date(t.datetime);
      return (now - td) < 3600000;
    });
    if (lastHourTrades.length >= 3) {
      const wr = Math.round(lastHourTrades.filter(t => t.outcome === 'WIN').length / lastHourTrades.length * 100);
      alerts.push({ icon: '🔥', title: 'Overtrading detected', body: `${lastHourTrades.length} trades in the last hour (${wr}% WR). Slow down — quality over quantity.`, urgency: 'danger' });
    }
  }

  // 5) Revenge trading pattern
  if (todayTrades.length >= 2) {
    const sorted = [...todayTrades].sort((a, b) => new Date(a.datetime) - new Date(b.datetime));
    let revCount = 0;
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i - 1].outcome === 'LOSS' && sorted[i].emotion === 'revenge') revCount++;
    }
    if (revCount > 0) {
      alerts.push({ icon: '🔴', title: 'Revenge trading alert', body: `${revCount} potential revenge trade${revCount > 1 ? 's' : ''} detected today. Step away for 30 minutes.`, urgency: 'danger' });
    }
  }

  // 6) Consecutive loss warning
  const sortedAll = [...trades].sort((a, b) => new Date(b.datetime) - new Date(a.datetime));
  let currentLossStreak = 0;
  for (const t of sortedAll) {
    if (t.outcome === 'LOSS') currentLossStreak++;
    else break;
  }
  if (currentLossStreak >= 3) {
    alerts.push({ icon: '📉', title: `${currentLossStreak} losses in a row`, body: `You're on a ${currentLossStreak}-loss streak. Take a break, review your last trades, and reset mentally before trading again.`, urgency: 'danger' });
  }

  // 7) Discipline trend
  const recent7 = tradesForPeriod(trades, 7);
  const prev7 = tradesForPeriod(trades, 14).filter(t => !recent7.includes(t));
  if (recent7.length >= 3 && prev7.length >= 3) {
    const dsRecent = calcDisciplineScore(recent7);
    const dsPrev = calcDisciplineScore(prev7);
    if (dsRecent !== null && dsPrev !== null) {
      const diff = dsRecent - dsPrev;
      if (diff <= -15) {
        alerts.push({ icon: '📊', title: 'Discipline dropping fast', body: `Your discipline score dropped ${Math.abs(diff)} pts this week vs. last week (${dsPrev} → ${dsRecent}). Tighten up rule adherence.`, urgency: 'warn' });
      } else if (diff >= 15) {
        alerts.push({ icon: '🏆', title: 'Discipline improving!', body: `+${diff} pts this week vs. last (${dsPrev} → ${dsRecent}). Keep executing your process.`, urgency: 'positive' });
      }
    }
  }

  // 8) Best emotion state reminder
  const emoMap = {};
  for (const t of trades) {
    if (!t.emotion) continue;
    if (!emoMap[t.emotion]) emoMap[t.emotion] = { wins: 0, total: 0 };
    emoMap[t.emotion].total++;
    if (t.outcome === 'WIN') emoMap[t.emotion].wins++;
  }
  let bestEmo = null, bestEmoWR = 0;
  for (const [emo, d] of Object.entries(emoMap)) {
    if (d.total < 3) continue;
    const wr = d.wins / d.total;
    if (wr > bestEmoWR) { bestEmoWR = wr; bestEmo = emo; }
  }
  if (bestEmo && bestEmoWR >= 0.6) {
    alerts.push({ icon: '🧘', title: `Trade "${bestEmo}" for best results`, body: `Your win rate when feeling ${bestEmo} is ${Math.round(bestEmoWR * 100)}%. Only trade when you're in this state.`, urgency: 'positive' });
  }

  return alerts;
}

/* ────────────────────────────────────────────────────────────
   COMMUNITY CHALLENGES
──────────────────────────────────────────────────────────── */
const COMMUNITY_CHALLENGES = [
  {
    id: 'streak_7',
    title: '7-Day Logging Streak',
    desc: 'Log at least 1 trade every day for 7 consecutive days.',
    icon: '🔥',
    type: 'streak',
    target: 7,
    unit: 'days',
  },
  {
    id: 'discipline_80',
    title: 'Discipline Master',
    desc: 'Maintain a Discipline Score of 80+ for 5 consecutive trades.',
    icon: '🎯',
    type: 'discipline',
    target: 80,
    unit: 'score',
  },
  {
    id: 'zero_revenge',
    title: 'Zero Revenge Week',
    desc: 'Complete 7 days with zero revenge trades tagged.',
    icon: '🧊',
    type: 'no_revenge',
    target: 7,
    unit: 'days',
  },
  {
    id: 'emotion_logger',
    title: 'Emotion Tracker Pro',
    desc: 'Log 20 trades with emotions tagged. Self-awareness is your edge.',
    icon: '🧠',
    type: 'emotion_count',
    target: 20,
    unit: 'trades',
  },
  {
    id: 'rules_perfect',
    title: 'Perfect Execution',
    desc: 'Follow ALL 5 rules on 10 consecutive trades.',
    icon: '✅',
    type: 'perfect_rules',
    target: 10,
    unit: 'trades',
  },
  {
    id: 'journal_30',
    title: '30-Day Journal Challenge',
    desc: 'Log trades for 30 days straight. Build the habit that separates pros from amateurs.',
    icon: '📓',
    type: 'streak',
    target: 30,
    unit: 'days',
  },
];

function initCommunity() {
  renderCommunityDash();
}

function getCommunityState() {
  return JSON.parse(localStorage.getItem('trafxos_community') || '{}');
}
function saveCommunityState(state) {
  localStorage.setItem('trafxos_community', JSON.stringify(state));
}

function calcChallengeProgress(challenge) {
  const trades = DB.trades;
  const sorted = [...trades].sort((a, b) => new Date(a.datetime) - new Date(b.datetime));

  switch (challenge.type) {
    case 'streak': {
      // Count consecutive unique days with at least 1 trade, ending today
      const daySet = new Set(sorted.map(t => (t.datetime || '').slice(0, 10)).filter(Boolean));
      const days = [...daySet].sort().reverse();
      let streak = 0;
      const today = new Date();
      for (let i = 0; i < challenge.target + 5; i++) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        const ds = d.toISOString().slice(0, 10);
        if (daySet.has(ds)) streak++;
        else break;
      }
      return Math.min(streak, challenge.target);
    }
    case 'discipline': {
      const ds = calcDisciplineScore(trades);
      return ds !== null && ds >= challenge.target ? challenge.target : (ds || 0);
    }
    case 'no_revenge': {
      const today = new Date();
      let cleanDays = 0;
      for (let i = 0; i < challenge.target + 5; i++) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        const ds = d.toISOString().slice(0, 10);
        const dayTrades = trades.filter(t => (t.datetime || '').startsWith(ds));
        const hasRevenge = dayTrades.some(t => t.emotion === 'revenge' || (t.mistakes && t.mistakes.includes('revenge')));
        if (!hasRevenge && dayTrades.length > 0) cleanDays++;
        else if (dayTrades.length > 0) break;
      }
      return Math.min(cleanDays, challenge.target);
    }
    case 'emotion_count': {
      return Math.min(trades.filter(t => t.emotion).length, challenge.target);
    }
    case 'perfect_rules': {
      let consecutive = 0, max = 0;
      for (const t of sorted) {
        if (t.rules && Object.values(t.rules).every(Boolean)) {
          consecutive++;
          max = Math.max(max, consecutive);
        } else {
          consecutive = 0;
        }
      }
      return Math.min(max, challenge.target);
    }
    default: return 0;
  }
}

function renderCommunityDash() {
  const container = document.getElementById('communityChallenges');
  if (!container) return;
  const state = getCommunityState();
  const trades = DB.trades;

  if (!trades.length) {
    container.innerHTML = `<div class="community-empty"><i class="fa-solid fa-users"></i><p>Start logging trades to join community challenges and compete with traders worldwide.</p></div>`;
    return;
  }

  const joined = state.joined || [];

  let html = COMMUNITY_CHALLENGES.map(ch => {
    const isJoined = joined.includes(ch.id);
    const progress = isJoined ? calcChallengeProgress(ch) : 0;
    const pct = Math.min(100, Math.round((progress / ch.target) * 100));
    const isComplete = pct >= 100;

    return `
      <div class="cc-card ${isComplete ? 'cc-complete' : ''}">
        <div class="cc-icon">${ch.icon}</div>
        <div class="cc-info">
          <div class="cc-title">${sanitize(ch.title)}</div>
          <div class="cc-desc">${sanitize(ch.desc)}</div>
          ${isJoined ? `
            <div class="cc-progress-wrap">
              <div class="cc-progress-bar"><div class="cc-progress-fill" style="width:${pct}%"></div></div>
              <span class="cc-progress-text">${progress}/${ch.target} ${ch.unit} ${isComplete ? '✅' : ''}</span>
            </div>
          ` : ''}
        </div>
        <button class="btn-sm ${isJoined ? (isComplete ? 'btn-complete' : 'btn-secondary') : 'btn-primary'}" 
                onclick="joinChallenge('${ch.id}')" ${isComplete ? 'disabled' : ''}>
          ${isComplete ? 'Done!' : isJoined ? 'Joined' : 'Join'}
        </button>
      </div>
    `;
  }).join('');

  // Leaderboard summary
  const ds = calcDisciplineScore(trades) || 0;
  const streaks = calcStreaks(trades);
  html += `
    <div class="cc-leaderboard">
      <div class="cc-lb-title"><i class="fa-solid fa-ranking-star"></i> Your Stats</div>
      <div class="cc-lb-row">
        <span>Discipline Score</span>
        <span class="cc-lb-val" style="color:${ds >= 80 ? 'var(--green)' : ds >= 60 ? 'var(--yellow)' : 'var(--red)'}">${ds}</span>
      </div>
      <div class="cc-lb-row">
        <span>Current Win Streak</span>
        <span class="cc-lb-val">${streaks.currentWin}</span>
      </div>
      <div class="cc-lb-row">
        <span>Total Trades Logged</span>
        <span class="cc-lb-val">${trades.length}</span>
      </div>
      <div class="cc-lb-row">
        <span>Active Challenges</span>
        <span class="cc-lb-val">${joined.length}</span>
      </div>
    </div>
  `;

  container.innerHTML = html;
}

function joinChallenge(id) {
  const state = getCommunityState();
  if (!state.joined) state.joined = [];
  if (!state.joined.includes(id)) {
    state.joined.push(id);
    saveCommunityState(state);
    toast('Challenge joined! Track your progress on the dashboard. 💪', 'success');
  }
  renderCommunityDash();
}

/* ────────────────────────────────────────────────────────────
   DASHBOARD INSTALL CARD
──────────────────────────────────────────────────────────── */
function initDashInstallCard() {
  const card = document.getElementById('dashInstallCard');
  if (!card) return;
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
  const dismissed = localStorage.getItem('trafxos_dash_install_dismissed');
  if (isStandalone || dismissed) return;
  card.classList.remove('hidden');

  document.getElementById('dashInstallBtn').addEventListener('click', async () => {
    if (deferredInstallPrompt) {
      deferredInstallPrompt.prompt();
      const { outcome } = await deferredInstallPrompt.userChoice;
      deferredInstallPrompt = null;
      if (outcome === 'accepted') {
        card.classList.add('hidden');
        toast('TrafxOS installed! 🎉', 'success');
      }
    } else {
      // Show the full install modal
      const modal = document.getElementById('pwaInstallModal');
      if (modal) modal.classList.remove('hidden');
    }
  });

  document.getElementById('dashInstallDismiss').addEventListener('click', () => {
    card.classList.add('hidden');
    localStorage.setItem('trafxos_dash_install_dismissed', '1');
  });
}

/* ────────────────────────────────────────────────────────────
   SERVICE WORKER REGISTRATION
──────────────────────────────────────────────────────────── */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}

/* ────────────────────────────────────────────────────────────
   BOOT
──────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  initSplash();
});
