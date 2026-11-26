// Pytania do Żanny (menadżerka biura): baza odpowiedzi w Firestore + dokument na Dysku Żanny,
// a Asystentka podpowiada odpowiedź, jeśli podobne pytanie już padło.
const claude = require('./claude');

const NAZWA_DOKUMENTU = 'Pytania do Żanny - baza KRAMM';
const DOPASUJ = { name: 'dopasowanie', description: 'Czy na nowe pytanie odpowiada Baza wiedzy KRAMM albo wcześniejsza odpowiedź Żanny.',
  input_schema: { type: 'object', properties: {
    zrodlo: { type: 'string', enum: ['zanna', 'baza', 'brak'], description: 'zanna - odpowiedź z wcześniejszej odpowiedzi Żanny (podaj numer); baza - odpowiedź wprost z Bazy wiedzy KRAMM; brak - nie ma pewnej odpowiedzi' },
    numer: { type: 'integer', description: 'numer wcześniejszego pytania, którego odpowiedź naprawdę odpowiada na nowe pytanie; 0 gdy żadna nie pasuje albo nie ma pewności' },
    odpowiedz: { type: 'string', description: 'krótka odpowiedź po polsku oparta WYŁĄCZNIE na wskazanym źródle, bez dopowiadania; pusta gdy zrodlo = brak' }
  }, required: ['zrodlo', 'numer', 'odpowiedz'] } };

// Baza wiedzy KRAMM - tajna: leży tylko w Firestore (bez dostępu z telefonów), nigdy w repozytorium ani w odpowiedziach API w całości
let bazaPamiec = null, bazaCzas = 0;
async function bazaWiedzy(db) {
  if (bazaPamiec !== null && Date.now() - bazaCzas < 5 * 60e3) return bazaPamiec;
  const d = (await db.collection('ustawienia').doc('baza_wiedzy').get()).data();
  bazaPamiec = (d && d.tekst) || ''; bazaCzas = Date.now();
  return bazaPamiec;
}
async function wgrajBaze(db, tekst, kto) {
  const wpis = { tekst, kiedy: Date.now(), kto, dlugosc: tekst.length };
  await db.collection('ustawienia').doc('baza_wiedzy').set(wpis);
  bazaPamiec = tekst; bazaCzas = Date.now();
  return { kiedy: wpis.kiedy, dlugosc: wpis.dlugosc };
}
async function bazaInfo(db) {
  const d = (await db.collection('ustawienia').doc('baza_wiedzy').get()).data();
  return d ? { kiedy: d.kiedy, dlugosc: d.dlugosc, kto: d.kto } : null;
}

const esc = t => String(t ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const data = t => new Date(t).toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw', day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });

async function wszystkie(db, ile = 300) {
  const q = await db.collection('pytania_baza').orderBy('odpowiedziano', 'desc').limit(ile).get();
  return q.docs.map(x => ({ id: x.id, ...x.data() }));
}

// zapisuje pytanie z odpowiedzią do bazy
async function zapisz(db, id, wpis) {
  await db.collection('pytania_baza').doc(String(id)).set(wpis, { merge: true });
}

// odświeża dokument Google na Dysku Żanny (tworzy go przy pierwszym razie)
async function dokument(db, api) {
  const lista = await wszystkie(db, 1000);
  const html = `<html><head><meta charset="utf-8"></head><body><h1>${NAZWA_DOKUMENTU}</h1>
<p>Pytania dziewczyn z Asystentki KRAMM i odpowiedzi Żanny. Dokument aktualizuje się sam po każdej odpowiedzi - najnowsze na górze.</p>
${lista.map(p => `<h3>${esc(p.pytanie)}</h3><p><b>Pytała:</b> ${esc(p.odImie || '')}, ${esc(data(p.czas || p.odpowiedziano))}</p><p><b>Odpowiedź:</b> ${esc(p.odpowiedz)}</p><p><i>${esc(data(p.odpowiedziano))}</i></p><hr>`).join('\n')}
</body></html>`;
  const ust = db.collection('ustawienia').doc('pytania');
  const st = (await ust.get()).data() || {};
  if (st.dokument) {
    try {
      await api(`https://www.googleapis.com/upload/drive/v3/files/${st.dokument}?uploadType=media`, { method: 'PATCH', headers: { 'Content-Type': 'text/html; charset=utf-8' }, body: html });
      return st.dokument;
    } catch (e) { /* dokument usunięty - utworzymy nowy */ }
  }
  const granica = 'kramm' + Date.now();
  const cialo = `--${granica}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name: NAZWA_DOKUMENTU, mimeType: 'application/vnd.google-apps.document' })}\r\n--${granica}\r\nContent-Type: text/html; charset=UTF-8\r\n\r\n${html}\r\n--${granica}--`;
  const plik = await api('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${granica}` }, body: cialo });
  await ust.set({ dokument: plik.id }, { merge: true });
  return plik.id;
}

// szuka odpowiedzi: najpierw wcześniejsze odpowiedzi Żanny, potem Baza wiedzy KRAMM
async function szukaj(db, { klucz, tekst }) {
  const [baza, wiedza] = await Promise.all([wszystkie(db, 250).then(l => l.filter(p => p.odpowiedz && p.pytanie)), bazaWiedzy(db)]);
  if (!baza.length && !wiedza) return null;
  const tresc = [];
  if (wiedza) tresc.push({ type: 'text', text: `<baza_wiedzy_kramm>\n${wiedza}\n</baza_wiedzy_kramm>`, cache_control: { type: 'ephemeral' } });
  tresc.push({ type: 'text', text: `Wcześniejsze pytania i odpowiedzi Żanny:\n${baza.length ? baza.map((p, i) => `${i + 1}. P: ${p.pytanie}\n   O: ${p.odpowiedz}`).join('\n') : '(brak)'}\n\nNowe pytanie agentki: ${tekst}` });
  const odp = await claude.zapytaj({ klucz, model: claude.MODEL_TEKSTY, maxTokenow: 700, narzedzia: [DOPASUJ], wymusNarzedzie: 'dopasowanie',
    system: 'Pomagasz agentkom biura nieruchomości KRAMM, zanim ich pytanie trafi do menadżerki biura Żanny. Masz wewnętrzną Bazę wiedzy KRAMM i wcześniejsze odpowiedzi Żanny. Odpowiedz tylko wtedy, gdy źródło rzeczywiście i w pełni odpowiada na pytanie: zrodlo = zanna (ta sama sprawa, podaj numer) albo zrodlo = baza (odpowiedź wprost w bazie). Sprawy zależne od konkretnego dnia, osoby, mieszkania lub sytuacji, które mogły się zmienić, oraz decyzje do podjęcia - zrodlo = brak, wtedy pytanie trafi do Żanny. Niczego nie dopowiadaj, nie cytuj obszernie bazy, odpowiedz krótko (do 5 zdań) i wskaż, gdzie szukać szczegółów (np. folder lub dokument na Dysku), jeśli baza to podaje.',
    wiadomosci: [{ role: 'user', content: tresc }] });
  const o = claude.narzedzie(odp);
  if (!o || !String(o.dane.odpowiedz || '').trim()) return null;
  if (o.dane.zrodlo === 'zanna' && baza[o.dane.numer - 1]) {
    const p = baza[o.dane.numer - 1];
    return { zrodlo: 'zanna', odpowiedz: o.dane.odpowiedz.trim(), pytanie: p.pytanie, kiedy: p.odpowiedziano, id: p.id };
  }
  if (o.dane.zrodlo === 'baza' && wiedza) return { zrodlo: 'baza', odpowiedz: o.dane.odpowiedz.trim() };
  return null;
}

module.exports = { zapisz, dokument, szukaj, wszystkie, wgrajBaze, bazaInfo, NAZWA_DOKUMENTU };
