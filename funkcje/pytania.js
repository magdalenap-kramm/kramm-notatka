// Pytania do Żanny (menadżerka biura): baza odpowiedzi w Firestore + dokument na Dysku Żanny,
// a Asystentka podpowiada odpowiedź, jeśli podobne pytanie już padło.
const claude = require('./claude');

const NAZWA_DOKUMENTU = 'Pytania do Żanny - baza KRAMM';
const DOPASUJ = { name: 'dopasowanie', description: 'Czy któraś wcześniejsza odpowiedź Żanny odpowiada na nowe pytanie.',
  input_schema: { type: 'object', properties: {
    numer: { type: 'integer', description: 'numer wcześniejszego pytania, którego odpowiedź naprawdę odpowiada na nowe pytanie; 0 gdy żadna nie pasuje albo nie ma pewności' },
    odpowiedz: { type: 'string', description: 'krótka odpowiedź po polsku oparta WYŁĄCZNIE na tej wcześniejszej odpowiedzi Żanny, bez dopowiadania; pusta gdy numer = 0' }
  }, required: ['numer', 'odpowiedz'] } };

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

// szuka wcześniejszej odpowiedzi na podobne pytanie
async function szukaj(db, { klucz, tekst }) {
  const baza = (await wszystkie(db, 250)).filter(p => p.odpowiedz && p.pytanie);
  if (!baza.length) return null;
  const odp = await claude.zapytaj({ klucz, model: claude.MODEL_TEKSTY, maxTokenow: 500, narzedzia: [DOPASUJ], wymusNarzedzie: 'dopasowanie',
    system: 'Pomagasz agentkom biura nieruchomości KRAMM. Masz bazę wcześniejszych pytań do menadżerki biura Żanny z jej odpowiedziami. Wskaż wcześniejsze pytanie tylko wtedy, gdy jego odpowiedź rzeczywiście i w pełni odpowiada na nowe pytanie (ta sama sprawa, nie tylko podobny temat). Sprawy zależne od konkretnego dnia, osoby lub sytuacji, które mogły się zmienić, traktuj ostrożnie - wtedy numer 0. Niczego nie dopowiadaj.',
    wiadomosci: [{ role: 'user', content: `Nowe pytanie: ${tekst}\n\nWcześniejsze pytania i odpowiedzi Żanny:\n${baza.map((p, i) => `${i + 1}. P: ${p.pytanie}\n   O: ${p.odpowiedz}`).join('\n')}` }] });
  const o = claude.narzedzie(odp);
  if (!o || !o.dane.numer || !baza[o.dane.numer - 1] || !String(o.dane.odpowiedz || '').trim()) return null;
  const p = baza[o.dane.numer - 1];
  return { odpowiedz: o.dane.odpowiedz.trim(), pytanie: p.pytanie, oryginal: p.odpowiedz, kiedy: p.odpowiedziano, id: p.id };
}

module.exports = { zapisz, dokument, szukaj, wszystkie, NAZWA_DOKUMENTU };
