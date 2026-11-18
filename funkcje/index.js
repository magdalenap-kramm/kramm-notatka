// Asystentka KRAMM - zaplecze (Firebase Cloud Functions, region Warszawa).
const { onRequest } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { defineSecret } = require('firebase-functions/params');
const logger = require('firebase-functions/logger');
const admin = require('firebase-admin');
const crypto = require('crypto');
const webpush = require('web-push');

const czas = require('./czas');
const g = require('./google');
const brief = require('./brief');
const komendy = require('./komendy');

admin.initializeApp();
const db = admin.firestore();

const GOOGLE_CLIENT_SECRET = defineSecret('GOOGLE_CLIENT_SECRET');
const ANTHROPIC_API_KEY = defineSecret('ANTHROPIC_API_KEY');
const VAPID_PUBLIC = defineSecret('VAPID_PUBLIC');
const VAPID_PRIVATE = defineSecret('VAPID_PRIVATE');
const SEKRETY = [GOOGLE_CLIENT_SECRET, ANTHROPIC_API_KEY, VAPID_PUBLIC, VAPID_PRIVATE];
const REGION = 'europe-central2';
const DOMENA = 'kramm.pl';
const DOMYSLNA_GODZINA = '07:30';

const hash = t => crypto.createHash('sha256').update(t).digest('hex');
const agentkaRef = email => db.collection('agentki').doc(email);

// ---------- powiadomienia ----------
let vapidGotowe = false;
function vapid() {
  if (!vapidGotowe) { webpush.setVapidDetails('mailto:magdalena.p@kramm.pl', VAPID_PUBLIC.value().trim(), VAPID_PRIVATE.value().trim()); vapidGotowe = true; }
}
async function wyslijPush(email, tresc) {
  vapid();
  const ref = agentkaRef(email); const a = (await ref.get()).data() || {};
  const subs = a.push || []; const zostaja = [];
  for (const s of subs) {
    try { await webpush.sendNotification(s, JSON.stringify(tresc), { TTL: 6 * 3600, urgency: 'high' }); zostaja.push(s); }
    catch (e) { if (![404, 410].includes(e.statusCode)) { zostaja.push(s); logger.warn('push', email, e.statusCode, e.body); } }
  }
  if (zostaja.length !== subs.length) await ref.update({ push: zostaja });
  return zostaja.length;
}

// ---------- brief ----------
function podsumowanie(b) {
  const l = (n, a, b2, c) => n === 1 ? a : (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20)) ? b2 : c;
  const cz = [];
  const s = (b.dzis || []).length, m = (b.maile || []).length, k = (b.kontakty || []).length;
  if (s) cz.push(`${s} ${l(s, 'pozycja', 'pozycje', 'pozycji')} w kalendarzu`);
  if (m) cz.push(`${m} ${l(m, 'mail', 'maile', 'maili')} do odpowiedzi`);
  if (k) cz.push(`${k} ${l(k, 'osoba', 'osoby', 'osób')} do kontaktu`);
  return (cz.join(', ') || 'Spokojny dzień') + '. Dotknij, żeby odsłuchać.';
}
async function zrobBrief(email) {
  const ref = agentkaRef(email);
  const a = (await ref.get()).data();
  const b = await brief.przygotuj(a, { sekret: GOOGLE_CLIENT_SECRET.value().trim(), klucz: ANTHROPIC_API_KEY.value().trim() });
  await ref.collection('briefy').doc(b.data).set(b);
  const arkusze = (a.arkusze || []).map(x => b.stanArkuszy && b.stanArkuszy[x.id] !== undefined ? { ...x, wiersze: b.stanArkuszy[x.id] } : x);
  await ref.update({ ostatniBrief: b.data, arkusze, ...(b.arkusz && !a.arkuszNotatki ? { arkuszNotatki: b.arkusz } : {}), polaczenie: 'ok' });
  return b;
}
async function dzisiejszyBrief(email) {
  const d = await agentkaRef(email).collection('briefy').doc(czas.dzien()).get();
  return d.exists ? d.data() : null;
}

// ---------- logowanie ----------
async function polacz({ kod, powrot }) {
  if (!kod || !powrot) throw Object.assign(new Error('Brak kodu logowania'), { status: 400 });
  const t = await g.wymienKod(kod, powrot, GOOGLE_CLIENT_SECRET.value().trim());
  if (!t.weryfikacja || (t.domena !== DOMENA && !t.email.endsWith('@' + DOMENA))) throw Object.assign(new Error('Zaloguj się kontem @kramm.pl'), { status: 403 });
  const ref = agentkaRef(t.email); const byla = (await ref.get()).data();
  const refresh = t.refresh || (byla && byla.refresh);
  if (!refresh) throw Object.assign(new Error('Google nie przekazał stałego dostępu. Zaloguj się jeszcze raz i zaznacz wszystkie zgody.'), { status: 400 });
  const brakZgod = g.ZAKRESY.filter(z => z.startsWith('https') && !t.zakres.includes(z));
  await ref.set({ email: t.email, imie: t.imie, foto: t.foto, refresh, zakres: t.zakres, polaczenie: 'ok',
    ...(byla ? {} : { godzina: DOMYSLNA_GODZINA, dniRobocze: true, punkty: [], push: [], utworzona: new Date().toISOString() }) }, { merge: true });
  const sesja = crypto.randomBytes(32).toString('base64url');
  await db.collection('sesje').doc(hash(sesja)).set({ email: t.email, utworzono: new Date().toISOString() });
  return { sesja, brakZgod };
}
async function kto(req) {
  const m = String(req.get('authorization') || '').match(/^Bearer (.+)$/);
  if (!m) return null;
  const s = await db.collection('sesje').doc(hash(m[1])).get();
  return s.exists ? s.data().email : null;
}
function profil(a) {
  return { email: a.email, imie: a.imie, foto: a.foto, godzina: a.godzina, dniRobocze: a.dniRobocze !== false, punkty: a.punkty || [],
    powiadomienia: (a.push || []).length, polaczenie: a.polaczenie || 'ok',
    arkusze: (a.arkusze || []).map(x => ({ id: x.id, nazwa: x.nazwa })),
    brakZgod: g.ZAKRESY.filter(z => z.startsWith('https') && !String(a.zakres || '').includes(z)).length > 0 };
}

// ---------- API dla aplikacji ----------
exports.api = onRequest({ region: REGION, secrets: SEKRETY, cors: [/^https:\/\/magdalenap-kramm\.github\.io$/, /^http:\/\/localhost(:\d+)?$/], timeoutSeconds: 120, memory: '512MiB' }, async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ blad: 'Tylko POST' });
  const body = req.body || {};
  try {
    if (body.akcja === 'konfig') return res.json({ vapid: VAPID_PUBLIC.value().trim(), clientId: g.CLIENT_ID, zakresy: g.ZAKRESY.join(' ') });
    if (body.akcja === 'polacz') return res.json(await polacz(body));

    const email = await kto(req);
    if (!email) return res.status(401).json({ kod: 'polacz', blad: 'Zaloguj się' });
    const ref = agentkaRef(email);
    const a = (await ref.get()).data();
    if (!a) return res.status(401).json({ kod: 'polacz', blad: 'Zaloguj się' });

    switch (body.akcja) {
      case 'ja': {
        const ocz = (await ref.collection('stan').doc('oczekujace').get()).data();
        return res.json({ profil: profil(a), brief: await dzisiejszyBrief(email), oczekujace: ocz && ocz.typ ? ocz : null });
      }
      case 'ustawienia': {
        const zm = {};
        if (body.godzina !== undefined) { const h = czas.doPieciu(body.godzina); if (!h) return res.status(400).json({ blad: 'Zła godzina' }); zm.godzina = h; }
        if (body.dniRobocze !== undefined) zm.dniRobocze = !!body.dniRobocze;
        if (Array.isArray(body.punkty)) zm.punkty = body.punkty.map(p => String(p).trim()).filter(Boolean).slice(0, 15);
        await ref.update(zm);
        return res.json({ profil: profil({ ...a, ...zm }) });
      }
      case 'push': {
        const s = body.subskrypcja;
        if (!s || !s.endpoint) return res.status(400).json({ blad: 'Brak subskrypcji' });
        const push = [...(a.push || []).filter(x => x.endpoint !== s.endpoint), s].slice(-5);
        await ref.update({ push });
        if (body.test) await wyslijPush(email, { tytul: 'Asystentka KRAMM', tresc: 'Powiadomienia działają. Rano przyjdzie tu Twój brief.', url: './' });
        return res.json({ ok: true, powiadomienia: push.length });
      }
      case 'arkusze_szukaj': {
        const api = g.klient(await g.tokenDostepu(a, GOOGLE_CLIENT_SECRET.value().trim()));
        return res.json({ wyniki: await g.szukajArkuszy(api, String(body.fraza || '').slice(0, 100)) });
      }
      case 'arkusze_dodaj': {
        if (!body.id || !body.nazwa) return res.status(400).json({ blad: 'Brak arkusza' });
        const arkusze = [...(a.arkusze || []).filter(x => x.id !== body.id), { id: String(body.id), nazwa: String(body.nazwa).slice(0, 120) }].slice(-5);
        await ref.update({ arkusze });
        return res.json({ profil: profil({ ...a, arkusze }) });
      }
      case 'arkusze_usun': {
        const arkusze = (a.arkusze || []).filter(x => x.id !== body.id);
        await ref.update({ arkusze });
        return res.json({ profil: profil({ ...a, arkusze }) });
      }
      case 'brief': {
        const b = !body.odswiez && await dzisiejszyBrief(email);
        return res.json({ brief: b || await zrobBrief(email) });
      }
      case 'komenda': {
        const stanRef = ref.collection('stan');
        const [oczD, rozD] = await Promise.all([stanRef.doc('oczekujace').get(), stanRef.doc('rozmowa').get()]);
        const ocz = oczD.exists && oczD.data().typ ? oczD.data() : null;
        const roz = rozD.exists && Date.now() - (rozD.data().czas || 0) < 15 * 60000 ? rozD.data().wpisy || [] : [];
        let b = await dzisiejszyBrief(email);
        const tekst = String(body.tekst || '').slice(0, 1000);
        if (/^(przygotuj|zrób|odśwież|zaktualizuj) (mi )?(brief|podsumowanie)/i.test(tekst.trim())) {
          b = await zrobBrief(email);
          return res.json({ mow: b.mowa, oczekuje: false, brief: b });
        }
        const w = await komendy.obsluz({ agentka: a, tekst, stan: { oczekujace: ocz, rozmowa: roz, brief: b, ostatniMail: rozD.exists && Date.now() - (rozD.data().czas || 0) < 15 * 60000 ? rozD.data().ostatniMail || null : null }, sekret: GOOGLE_CLIENT_SECRET.value().trim(), klucz: ANTHROPIC_API_KEY.value().trim() });
        const ostatniMail = w.wybranyMail || (rozD.exists && rozD.data().ostatniMail) || null;
        const zapisy = [stanRef.doc('rozmowa').set({ czas: Date.now(), ostatniMail, wpisy: [...roz, { rola: 'agentka', tekst }, { rola: 'asystentka', tekst: w.mow }].slice(-10) })];
        if (w.noweOczekujace === null) zapisy.push(stanRef.doc('oczekujace').set({ typ: null }));
        else if (w.noweOczekujace) zapisy.push(stanRef.doc('oczekujace').set({ ...w.noweOczekujace, czas: Date.now() }));
        if (w.zapisz) zapisy.push(ref.update(w.zapisz));
        if (w.wyslanyWatek && b) {
          b.maile = (b.maile || []).filter(m => m.watek !== w.wyslanyWatek).map((m, i) => ({ ...m, nr: i + 1 }));
          zapisy.push(ref.collection('briefy').doc(b.data).update({ maile: b.maile }));
        }
        await Promise.all(zapisy);
        return res.json({ mow: w.mow, oczekuje: !!w.oczekuje, ekran: w.ekran || null, profil: w.zapisz ? profil({ ...a, ...w.zapisz }) : undefined, brief: w.wyslanyWatek ? b : undefined });
      }
      case 'wyloguj': {
        const m = String(req.get('authorization')).match(/^Bearer (.+)$/);
        await db.collection('sesje').doc(hash(m[1])).delete();
        return res.json({ ok: true });
      }
      default: return res.status(400).json({ blad: 'Nieznana akcja' });
    }
  } catch (e) {
    if (e.kod === 'polacz') {
      const email = await kto(req).catch(() => null);
      if (email) await agentkaRef(email).update({ polaczenie: 'wygaslo' }).catch(() => {});
      return res.status(401).json({ kod: 'polacz', blad: e.message });
    }
    logger.error('api', body.akcja, e);
    return res.status(e.status || 500).json({ blad: e.message || 'Błąd serwera' });
  }
});

// ---------- poranny brief: co 5 minut sprawdza, komu pora go wysłać ----------
exports.poranek = onSchedule({ region: REGION, schedule: 'every 5 minutes', timeZone: czas.STREFA, secrets: SEKRETY, timeoutSeconds: 540, memory: '512MiB' }, async () => {
  const dzis = czas.dzien(), teraz = czas.godzina(), weekend = czas.czyWeekend();
  const naMinuty = h => +h.slice(0, 2) * 60 + +h.slice(3, 5);
  const wszystkie = await db.collection('agentki').get();
  for (const doc of wszystkie.docs) {
    const a = doc.data();
    const godz = a.godzina || DOMYSLNA_GODZINA;
    if (a.ostatniBrief === dzis || (a.dniRobocze !== false && weekend) || !a.refresh) continue;
    const roznica = naMinuty(teraz) - naMinuty(godz);
    if (roznica < 0 || roznica > 120) continue;
    await doc.ref.update({ ostatniBrief: dzis });          // blokada przed podwójnym wysłaniem
    try {
      const b = await zrobBrief(a.email);
      await wyslijPush(a.email, { tytul: `Dzień dobry, ${a.imie}`, tresc: podsumowanie(b), url: './?brief=1' });
    } catch (e) {
      logger.error('poranek', a.email, e);
      if (e.kod === 'polacz') {
        await doc.ref.update({ polaczenie: 'wygaslo' });
        await wyslijPush(a.email, { tytul: 'Asystentka KRAMM', tresc: 'Zaloguj się ponownie, żeby dostać poranny brief.', url: './' }).catch(() => {});
      }
    }
  }
});

exports._test = { podsumowanie };
