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
const tabela = require('./tabela');
const czujka = require('./czujka');

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
  // licznik na ikonie aplikacji: rośnie z każdym powiadomieniem, zeruje się po otwarciu Asystentki
  const licznik = (a.licznik || 0) + 1;
  if (subs.length) await ref.update({ licznik: admin.firestore.FieldValue.increment(1) }).catch(() => {});
  for (const s of subs) {
    try { await webpush.sendNotification(s, JSON.stringify({ ...tresc, licznik }), { TTL: 6 * 3600, urgency: 'high' }); zostaja.push(s); }
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
async function zadaniaDnia(email, dzien) {
  const q = await agentkaRef(email).collection('zadania').where('dzien', '==', dzien).get();
  return q.docs.map(x => ({ id: x.id, ...x.data() })).sort((x, y) => (x.utworzono || 0) - (y.utworzono || 0));
}
async function zalegle(email) {
  const dzis = czas.dzien();
  const q = await agentkaRef(email).collection('zadania').where('zrobione', '==', false).get();
  return q.docs.map(x => ({ id: x.id, ...x.data() })).filter(z => z.dzien < dzis).sort((x, y) => x.dzien < y.dzien ? -1 : 1);
}
// cały zespół KRAMM: zalogowane w Asystentce + pozostałe z katalogu (wiadomości do nich czekają do pierwszego logowania)
async function zespol() {
  const q = await db.collection('agentki').get();
  const zal = q.docs.filter(x => x.data().refresh || x.data().imie).map(x => ({ email: x.id, imie: x.data().imie || '', nazwa: x.data().nazwa || '', zalogowana: true }));
  const reszta = komendy.KATALOG_KRAMM.filter(([, e]) => !zal.some(x => x.email === e)).map(([n, e]) => ({ email: e, imie: n.split(' ')[0], nazwa: n, zalogowana: false }));
  return [...zal, ...reszta];
}
async function noweWiadomosci(email) {
  const q = await agentkaRef(email).collection('wiadomosci').where('przeczytana', '==', false).get();
  return q.docs.map(x => ({ id: x.id, ...x.data() })).sort((a, b) => a.czas - b.czas);
}
async function wyslijDoAgentki(nadawca, w) {
  const adresatka = agentkaRef(w.do);
  const odImie = nadawca.nazwa || nadawca.imie;
  const teraz = Date.now();
  const doc = adresatka.collection('wiadomosci').doc();
  if (w.zadanie) await adresatka.collection('zadania').add({ dzien: w.dzien, tekst: w.tekst, zrobione: false, utworzono: teraz, od: odImie, odEmail: nadawca.email, wiadomosc: doc.id });
  const tekst = w.zadanie ? `Nowe zadanie na ${czas.mowionaData(w.dzien, false)}: ${w.tekst}` : w.tekst;
  const odbiorca = (await adresatka.get()).data() || {};
  await Promise.all([
    doc.set({ od: nadawca.email, odImie, tekst, czas: teraz, przeczytana: false, ...(w.zadanie ? { zadanie: true } : {}) }),
    agentkaRef(nadawca.email).collection('wyslane').doc(doc.id).set({ do: w.do, doImie: odbiorca.nazwa || odbiorca.imie || w.do, tekst, czas: teraz, stan: 'nowa', odpowiedz: null, zadanie: !!w.zadanie })
  ]);
  await wyslijPush(w.do, { tytul: w.zadanie ? `Zadanie od ${odImie}` : `Wiadomość od ${odImie}`, tresc: w.tekst.slice(0, 140), url: './?wiadomosci=1', tag: 'wiad-' + doc.id }).catch(() => {});
}
// odbiorczyni przeczytała / odpowiedziała OK albo Nie - zmiana widoczna u nadawczyni
async function oznaczWiadomosc(odbiorczyni, id, odpowiedz, uzasadnienie) {
  const uz = String(uzasadnienie || '').trim().slice(0, 500);
  const ref = agentkaRef(odbiorczyni.email).collection('wiadomosci').doc(String(id));
  const w = (await ref.get()).data();
  if (!w) return;
  await ref.update({ przeczytana: true, ...(odpowiedz ? { odpowiedz } : {}), ...(uz ? { uzasadnienie: uz } : {}) });
  if (w.od) {
    await agentkaRef(w.od).collection('wyslane').doc(String(id)).update({ stan: 'przeczytana', czytano: Date.now(), ...(odpowiedz ? { odpowiedz } : {}), ...(uz ? { uzasadnienie: uz } : {}) }).catch(() => {});
    if (odpowiedz) await wyslijPush(w.od, { tytul: `${odbiorczyni.nazwa || odbiorczyni.imie}: ${odpowiedz === 'ok' ? 'OK' : 'Nie'}`,
      tresc: uz ? `Powód: ${uz.slice(0, 120)}` : w.tekst.slice(0, 140), url: './?wiadomosci=1', tag: 'odp-' + id }).catch(() => {});
    if (odpowiedz) {   // OK albo odmowa z powodem - widoczne u nadawczyni w karcie "Od dziewczyn"
      const imie = odbiorczyni.nazwa || odbiorczyni.imie;
      const tekst = odpowiedz === 'ok' ? `OK ✓ do: „${w.tekst.slice(0, 120)}”` : `Odrzuciła: „${w.tekst.slice(0, 120)}”. Powód: ${uz || 'nie podano'}`;
      await agentkaRef(w.od).collection('wiadomosci').add({ od: odbiorczyni.email, odImie: imie, tekst, czas: Date.now(), przeczytana: false, potwierdzenie: odpowiedz }).catch(() => {});
    }
  }
}
async function zrobBrief(email) {
  const ref = agentkaRef(email);
  const a = (await ref.get()).data();
  const dzis = czas.dzien();
  // tabela KRAMM: piątkowe przypomnienie i umowy do przedłużenia -> zadania na dziś
  const tab = await tabela.sprawdz({ api: g.klient(await g.tokenDostepu(a, GOOGLE_CLIENT_SECRET.value().trim())), ref, agentka: a }).catch(e => { if (e.kod) throw e; return { zadania: [] }; });
  const [zd, zj, zz] = await Promise.all([zadaniaDnia(email, dzis), zadaniaDnia(email, czas.dodajDni(dzis, 1)), zalegle(email)]).catch(() => [[], [], []]);
  a.wiadomosciOdDziewczyn = (await noweWiadomosci(email).catch(() => [])).map(w => `${w.odImie}: ${w.tekst}`);
  a.zadania = { dzis: zd.filter(z => !z.zrobione).map(z => z.tekst), jutro: zj.filter(z => !z.zrobione).map(z => z.tekst), zalegle: zz.map(z => `${z.tekst} (z ${z.dzien})`) };
  const b = await brief.przygotuj(a, { sekret: GOOGLE_CLIENT_SECRET.value().trim(), klucz: ANTHROPIC_API_KEY.value().trim() });
  b.tabela = { zadania: tab.zadania || [], zakladka: tab.zakladka || null, url: tabela.TABELA_URL };
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
  await ref.set({ email: t.email, imie: t.imie, nazwa: t.nazwa || '', foto: t.foto, refresh, zakres: t.zakres, polaczenie: 'ok',
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
    arkusze: (a.arkusze || []).map(x => ({ id: x.id, nazwa: x.nazwa })), zakladkaTabeli: a.zakladkaTabeli || '', tourWidziany: !!a.tourWidziany, czujkaMaile: a.czujkaMaile !== false, czujkaLeady: a.czujkaLeady !== false,
    brakZgod: g.ZAKRESY.filter(z => z.startsWith('https') && !String(a.zakres || '').includes(z)).length > 0 };
}

// ---------- API dla aplikacji ----------
exports.api = onRequest({ region: REGION, secrets: SEKRETY, cors: [/^https:\/\/magdalenap-kramm\.github\.io$/, /^https:\/\/asystentka-kramm\.(web\.app|firebaseapp\.com)$/, /^http:\/\/localhost(:\d+)?$/], timeoutSeconds: 300, memory: '512MiB' }, async (req, res) => {
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
        if (body.tourWidziany) zm.tourWidziany = true;
        if (body.czujkaMaile !== undefined) zm.czujkaMaile = !!body.czujkaMaile;
        if (body.czujkaLeady !== undefined) zm.czujkaLeady = !!body.czujkaLeady;
        if (body.zakladkaTabeli !== undefined) zm.zakladkaTabeli = String(body.zakladkaTabeli).slice(0, 60);
        if (Array.isArray(body.punkty)) zm.punkty = body.punkty.map(p => String(p).trim()).filter(Boolean).slice(0, 15);
        await ref.update(zm);
        return res.json({ profil: profil({ ...a, ...zm }) });
      }
      case 'push': {
        const s = body.subskrypcja;
        if (!s || !s.endpoint) return res.status(400).json({ blad: 'Brak subskrypcji' });
        // tylko subskrypcje z nowego adresu Asystentki - stare (z adresu Notatki) pokazywały powiadomienia na ikonie Notatki
        const zrodlo = String(body.zrodlo || '');
        const push = [...(a.push || []).filter(x => x.endpoint !== s.endpoint && (!zrodlo || x.zrodlo === zrodlo)), { ...s, zrodlo }].slice(-5);
        await ref.update({ push });
        if (body.test) await wyslijPush(email, { tytul: 'Asystentka KRAMM', tresc: 'Powiadomienia działają. Rano przyjdzie tu Twój brief.', url: './' });
        return res.json({ ok: true, powiadomienia: push.length });
      }
      case 'odczytane': {
        if (a.licznik) await ref.update({ licznik: 0 });
        return res.json({ ok: true });
      }
      case 'tabela_zakladki': {
        const api = g.klient(await g.tokenDostepu(a, GOOGLE_CLIENT_SECRET.value().trim()));
        const lista = await tabela.zakladki(api);
        return res.json({ lista, wybrana: tabela.zgadnijZakladke(a, lista), url: tabela.TABELA_URL });
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
      case 'zadania': {
        const dzien = /^\d{4}-\d{2}-\d{2}$/.test(body.dzien || '') ? body.dzien : czas.dzien();
        const api = g.klient(await g.tokenDostepu(a, GOOGLE_CLIENT_SECRET.value().trim()));
        const [zadania, wydarzenia, zal] = await Promise.all([zadaniaDnia(email, dzien), g.wydarzenia(api, dzien, dzien).catch(() => []), dzien === czas.dzien() ? zalegle(email) : []]);
        return res.json({ dzien, zadania, zalegle: zal, wydarzenia: wydarzenia.map(e => ({ godzina: e.caly ? '' : e.start.slice(11, 16), tytul: e.tytul, miejsce: e.miejsce })) });
      }
      case 'wiadomosci': {
        const [q, wy] = await Promise.all([ref.collection('wiadomosci').orderBy('czas', 'desc').limit(60).get(), ref.collection('wyslane').orderBy('czas', 'desc').limit(60).get()]);
        return res.json({ wiadomosci: q.docs.map(x => ({ id: x.id, ...x.data() })), wyslane: wy.docs.map(x => ({ id: x.id, ...x.data() })), zespol: (await zespol()).filter(x => x.email !== email) });
      }
      case 'wiadomosc_przeczytana': {
        if (body.odpowiedz === 'nie' && !String(body.uzasadnienie || '').trim()) return res.status(400).json({ blad: 'Napisz krótko, dlaczego nie.' });
        await oznaczWiadomosc(a, body.id, ['ok', 'nie'].includes(body.odpowiedz) ? body.odpowiedz : null, body.uzasadnienie);
        return res.json({ ok: true });
      }
      case 'wiadomosc_wyslij': {
        const tekst = String(body.tekst || '').trim().slice(0, 500);
        const zesp = await zespol();
        if (!tekst || !zesp.some(x => x.email === body.do)) return res.status(400).json({ blad: 'Wybierz adresatkę i wpisz treść' });
        const zadanie = !!body.zadanie;
        await wyslijDoAgentki(a, { do: body.do, tekst, zadanie, dzien: zadanie ? (/^\d{4}-\d{2}-\d{2}$/.test(body.dzien || '') ? body.dzien : czas.dzien()) : null });
        return res.json({ ok: true });
      }
      case 'zadanie_dodaj': {
        const tekst = String(body.tekst || '').trim().slice(0, 300);
        if (!tekst || !/^\d{4}-\d{2}-\d{2}$/.test(body.dzien || '')) return res.status(400).json({ blad: 'Brak treści lub dnia' });
        const d = await ref.collection('zadania').add({ dzien: body.dzien, tekst, zrobione: false, utworzono: Date.now(), ...(body.od ? { od: String(body.od).slice(0, 80) } : {}) });
        if (body.wiadomosc) await oznaczWiadomosc(a, body.wiadomosc, 'ok').catch(() => {});
        return res.json({ id: d.id });
      }
      case 'zadanie_zmien': {
        if (String(body.id).startsWith('tabela-') && body.zrobione) {
          const u = await tabela.uzupelniona({ api: g.klient(await g.tokenDostepu(a, GOOGLE_CLIENT_SECRET.value().trim())), ref });
          if (!u.jest) return res.status(409).json({ blad: 'Najpierw uzupełnij swoją zakładkę w Tabeli KRAMM. Zadanie odhaczy się samo po zmianach.' });
        }
        const zm = {};
        if (body.zrobione !== undefined) zm.zrobione = !!body.zrobione;
        if (/^\d{4}-\d{2}-\d{2}$/.test(body.dzien || '')) zm.dzien = body.dzien;
        const zRef = ref.collection('zadania').doc(String(body.id));
        const przed = (await zRef.get()).data() || {};
        await zRef.update(zm);
        // zadanie zlecone przez inną dziewczynę zostało wykonane -> potwierdzenie dla zlecającej
        if (zm.zrobione && !przed.zrobione && przed.odEmail && przed.odEmail !== email) {
          const imie = a.nazwa || a.imie;
          if (przed.wiadomosc) await agentkaRef(przed.odEmail).collection('wyslane').doc(przed.wiadomosc).update({ stan: 'wykonane', odpowiedz: 'wykonane', wykonano: Date.now() }).catch(() => {});
          await agentkaRef(przed.odEmail).collection('wiadomosci').add({ od: email, odImie: imie, tekst: `Wykonane ✓ „${String(przed.tekst).slice(0, 140)}”`, czas: Date.now(), przeczytana: false, potwierdzenie: 'wykonane' }).catch(() => {});
          await wyslijPush(przed.odEmail, { tytul: `${imie}: zadanie wykonane ✓`, tresc: String(przed.tekst).slice(0, 140), url: './?wiadomosci=1', tag: 'wyk-' + body.id }).catch(() => {});
        }
        return res.json({ ok: true });
      }
      case 'zadanie_usun': {
        if (String(body.id).startsWith('tabela-')) {
          const u = await tabela.uzupelniona({ api: g.klient(await g.tokenDostepu(a, GOOGLE_CLIENT_SECRET.value().trim())), ref });
          if (!u.jest) return res.status(409).json({ blad: 'Tego zadania nie da się usunąć, dopóki nie uzupełnisz tabeli KRAMM.' });
        }
        await ref.collection('zadania').doc(String(body.id)).delete();
        return res.json({ ok: true });
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
        const w = await komendy.obsluz({ agentka: a, tekst, zadania: dz => zadaniaDnia(email, dz), zespol: await zespol(), wiadomosci: () => noweWiadomosci(email), stan: { oczekujace: ocz, rozmowa: roz, brief: b, ostatniaWiadomosc: rozD.exists && Date.now() - (rozD.data().czas || 0) < 15 * 60000 ? rozD.data().ostatniaWiadomosc || null : null, ostatniMail: rozD.exists && Date.now() - (rozD.data().czas || 0) < 15 * 60000 ? rozD.data().ostatniMail || null : null }, sekret: GOOGLE_CLIENT_SECRET.value().trim(), klucz: ANTHROPIC_API_KEY.value().trim() });
        const ostatniMail = w.wybranyMail || (rozD.exists && rozD.data().ostatniMail) || null;
        const ostatniaWiadomosc = w.ostatniaWiadomosc || (rozD.exists && rozD.data().ostatniaWiadomosc) || null;
        const zapisy = [stanRef.doc('rozmowa').set({ czas: Date.now(), ostatniMail, ostatniaWiadomosc, wpisy: [...roz, { rola: 'agentka', tekst }, { rola: 'asystentka', tekst: w.mow }].slice(-10) })];
        if (w.noweOczekujace === null) zapisy.push(stanRef.doc('oczekujace').set({ typ: null }));
        else if (w.noweOczekujace) zapisy.push(stanRef.doc('oczekujace').set({ ...w.noweOczekujace, czas: Date.now() }));
        if (w.zapisz) zapisy.push(ref.update(w.zapisz));
        if (w.wyslijWiadomosc) zapisy.push(wyslijDoAgentki(a, w.wyslijWiadomosc));
        (w.przeczytane || []).forEach(id => zapisy.push(oznaczWiadomosc(a, id)));
        if (w.noweZadanie) zapisy.push(ref.collection('zadania').add({ ...w.noweZadanie, zrobione: false, utworzono: Date.now() }));
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
  const godzinaTeraz = +teraz.slice(0, 2);
  const piatek = new Date(dzis + 'T12:00:00Z').getUTCDay() === 5;
  for (const doc of wszystkie.docs) {
    const a = doc.data();
    // piątek 15-18: co godzinę przypomnienie o Tabeli KRAMM, dopóki zakładka się nie zmieni
    if (piatek && a.refresh && tabela.PRZYPOMNIENIA[godzinaTeraz]) {
      try {
        const sRef = doc.ref.collection('stan').doc('tabela');
        const st = (await sRef.get()).data();
        if (st && st.dzien === dzis && !st.uzupelniona && st.ostatniaGodzina !== godzinaTeraz) {
          await sRef.update({ ostatniaGodzina: godzinaTeraz });
          const u = await tabela.uzupelniona({ api: g.klient(await g.tokenDostepu(a, GOOGLE_CLIENT_SECRET.value().trim())), ref: doc.ref });
          if (u.jest) await wyslijPush(a.email, { tytul: 'Tabela KRAMM', tresc: 'Dziękuję! Tabela uzupełniona, miłego weekendu 🎉', url: './' });
          else await wyslijPush(a.email, { tytul: 'Tabela KRAMM', tresc: tabela.PRZYPOMNIENIA[godzinaTeraz], url: './' });
        }
      } catch (e) { logger.error('tabela', a.email, e.message); }
    }
    const godz = a.godzina || DOMYSLNA_GODZINA;
    if (a.ostatniBrief === dzis || (a.dniRobocze !== false && weekend) || !a.refresh) continue;
    const roznica = naMinuty(teraz) - naMinuty(godz);
    if (roznica < 0 || roznica > 120) continue;
    await doc.ref.update({ ostatniBrief: dzis });          // blokada przed podwójnym wysłaniem
    try {
      const b = await zrobBrief(a.email);
      const piatek = (b.tabela && b.tabela.zadania || []).some(t => t.startsWith('Uzupełnij tabelę'));
      await wyslijPush(a.email, { tytul: `Dzień dobry, ${a.imie}`, tresc: (piatek ? 'Piątek: uzupełnij tabelę KRAMM. ' : '') + podsumowanie(b), url: './?brief=1' });
    } catch (e) {
      logger.error('poranek', a.email, e);
      if (e.kod === 'polacz') {
        await doc.ref.update({ polaczenie: 'wygaslo' });
        await wyslijPush(a.email, { tytul: 'Asystentka KRAMM', tresc: 'Zaloguj się ponownie, żeby dostać poranny brief.', url: './' }).catch(() => {});
      }
    }
  }
});

// ---------- czujka: pilne maile i nowe leady w ciągu dnia (dni robocze 7-20) ----------
exports.czujka = onSchedule({ region: REGION, schedule: 'every 15 minutes', timeZone: czas.STREFA, secrets: SEKRETY, timeoutSeconds: 300, memory: '512MiB' }, async () => {
  const h = +czas.godzina().slice(0, 2);
  if (czas.czyWeekend() || h < 7 || h >= 20) return;
  const wszystkie = await db.collection('agentki').get();
  for (const doc of wszystkie.docs) {
    const a = doc.data();
    if (!a.refresh || !(a.push || []).length || (a.czujkaMaile === false && a.czujkaLeady === false)) continue;
    try {
      const api = g.klient(await g.tokenDostepu(a, GOOGLE_CLIENT_SECRET.value().trim()));
      const sRef = doc.ref.collection('stan').doc('czujka');
      const st = (await sRef.get()).data() || {};
      const nowy = {};
      if (a.czujkaMaile !== false) {
        const m = await czujka.pilneMaile({ api, agentka: a, znane: st.watki, klucz: ANTHROPIC_API_KEY.value().trim() });
        nowy.watki = m.znane;
        for (const x of m.pilne.slice(0, 3)) await wyslijPush(a.email, { tytul: `Pilny mail: ${x.od}`, tresc: `${x.temat} - ${x.powod}`, url: './', tag: 'mail-' + x.id });
      }
      if (a.czujkaLeady !== false && (a.arkusze || []).length) {
        const l = await czujka.noweLeady({ api, arkusze: a.arkusze, stan: st.leady });
        nowy.leady = l.stan;
        for (const x of l.wynik) await wyslijPush(a.email, { tytul: x.ile === 1 ? `Nowy lead: ${x.arkusz}` : `${x.ile} nowe leady: ${x.arkusz}`, tresc: x.opis || 'Sprawdź arkusz', url: './', tag: 'lead-' + x.arkusz });
      }
      await sRef.set({ ...st, ...nowy, czas: Date.now() });
    } catch (e) { logger.warn('czujka', a.email, e.message); }
  }
});

exports._test = { podsumowanie };
