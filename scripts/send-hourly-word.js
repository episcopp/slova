// Runs inside GitHub Actions (about once an hour per user). For every registered device (Firestore field
// pushToken on users/{uid}), picks a random word from that user's own word list in the
// language they're currently reminding themselves of (pushLang), and sends one push
// notification via Firebase Cloud Messaging. Uses a service-account key, never a key
// that lives in the app itself, and that key only ever sits in a GitHub Actions secret.
const admin = require('firebase-admin');

function main() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) {
    console.error('Missing FIREBASE_SERVICE_ACCOUNT secret.');
    process.exit(1);
  }
  const serviceAccount = JSON.parse(raw);
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  const db = admin.firestore();
  const siteBase = process.env.SITE_BASE || 'https://episcopp.github.io/slova/';
  // GitHub fires scheduled workflows only a couple of times a day, so in the normal (non-manual)
  // mode this process stays alive for LOOP_MINUTES and checks every 5 minutes; the workflow then
  // starts the next run itself. A manual "force" run just sends once and exits.
  const loopMin = Number(process.env.LOOP_MINUTES || 0);
  if (!loopMin || process.env.FORCE_SEND === 'true') return run(db, siteBase, false);
  return loop(db, siteBase, loopMin);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function loop(db, siteBase, minutes) {
  const end = Date.now() + minutes * 60 * 1000;
  console.log('Loop mode for', minutes, 'min, check every 5 min. Started', new Date().toISOString());
  while (Date.now() < end) {
    try { await run(db, siteBase, true); } catch (e) { console.error('Cycle failed:', e.message); }
    await sleep(5 * 60 * 1000);
  }
  console.log('Loop finished', new Date().toISOString());
}

// Reminders only go out from 08:00 to 22:00 in the user's own time zone (saved at enable time).
const START_HOUR = 8, END_HOUR = 22;
function inActiveHours(tz) {
  let hour;
  try {
    hour = parseInt(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hourCycle: 'h23', timeZone: tz || 'Europe/Rome' }).format(new Date()), 10);
  } catch (e) {
    hour = parseInt(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hourCycle: 'h23', timeZone: 'Europe/Rome' }).format(new Date()), 10);
  }
  return hour >= START_HOUR && hour <= END_HOUR;
}

async function run(db, siteBase, quiet) {
  const log = quiet ? () => {} : console.log;
  const snap = await db.collection('users').get();
  log('Users in Firestore:', snap.size, '| force:', process.env.FORCE_SEND);
  let sent = 0, skipped = 0;
  for (const doc of snap.docs) {
    const d = doc.data();
    log('user', doc.id.slice(0, 6) + '…', 'hasToken=' + !!d.pushToken, 'lang=' + d.pushLang, 'tz=' + d.pushTz, 'hasData=' + !!d.data);
    if (!d.pushToken) { skipped++; continue; }

    let parsed = {};
    try { parsed = JSON.parse(d.data || '{}'); } catch (e) { skipped++; continue; }
    const force = process.env.FORCE_SEND === 'true';
    if (!force && !inActiveHours(d.pushTz)) { skipped++; continue; }
    // The job runs every ~15 min because GitHub drops many scheduled runs; this makes it send about once an hour.
    if (!force && d.lastPushAt && Date.now() - d.lastPushAt < 55 * 60 * 1000) { skipped++; continue; }
    const lang = d.pushLang || 'it-IT';
    const list = (parsed.words && parsed.words[lang]) || [];
    log('  words in', lang + ':', list.length);
    if (!list.length) { skipped++; continue; }

    const w = list[Math.floor(Math.random() * list.length)];
    const qs = 'notif=1&uk=' + encodeURIComponent(w.uk || '') +
      '&tl=' + encodeURIComponent(w.tl || '') +
      '&lang=' + encodeURIComponent(lang) +
      '&wid=' + encodeURIComponent(w.id || '');
    const link = siteBase + '?' + qs;

    // Data-only message: the service worker builds the visible notification itself.
    const message = {
      token: d.pushToken,
      data: { title: 'Слова · ' + lang.slice(0, 2).toUpperCase(), body: w.uk || '', uk: w.uk || '', tl: w.tl || '', lang, wid: w.id || '', link },
      webpush: { headers: { Urgency: 'high', TTL: '3600' } }
    };

    try {
      const id = await admin.messaging().send(message);
      console.log(new Date().toISOString(), 'sent to', doc.id.slice(0, 6) + '…', '| FCM:', id);
      sent++;
      await doc.ref.update({ lastPushAt: Date.now() }).catch((e) => console.error('  could not save lastPushAt:', e.message));
    } catch (e) {
      console.error('  Send failed:', e.code || '', e.message);
      if (e.code === 'messaging/registration-token-not-registered' || e.code === 'messaging/invalid-argument') {
        await doc.ref.update({
          pushToken: admin.firestore.FieldValue.delete(),
          pushLang: admin.firestore.FieldValue.delete()
        }).catch(() => {});
      }
    }
  }
  if (!quiet) console.log(`Done. Sent: ${sent}, skipped: ${skipped}.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
