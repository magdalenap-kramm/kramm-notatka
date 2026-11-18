// Poranny brief: kalendarz (dziś + jutro), maile do odpowiedzi, rozmowy z Notatki KRAMM, punkty agentki.
const czas = require('./czas');
const g = require('./google');
const claude = require('./claude');

const NARZEDZIE_BRIEF = {
  name: 'zapisz_brief',
  description: 'Zapisuje poranny brief agentki.',
  input_schema: {
    type: 'object',
    properties: {
      mowa: { type: 'string', description: 'Tekst do przeczytania na głos (60-90 sekund). Naturalna polszczyzna, bez list i znaków specjalnych, godziny słownie zrozumiałe dla lektora (np. "o jedenastej trzydzieści").' },
      dzis: { type: 'array', items: { type: 'object', properties: {
        godzina: { type: 'string' }, tytul: { type: 'string' }, miejsce: { type: 'string' }, notka: { type: 'string', description: 'co warto wiedzieć lub zabrać, np. z historii rozmów; pusty tekst jeśli nic' } }, required: ['godzina', 'tytul'] } },
      maile: { type: 'array', description: 'Tylko maile, które wymagają odpowiedzi agentki, od najpilniejszego. Pomiń newslettery, powiadomienia automatyczne, faktury bez pytania.', items: { type: 'object', properties: {
        watek: { type: 'string', description: 'identyfikator wątku z listy' }, od: { type: 'string', description: 'imię i nazwisko nadawcy, a przy firmie także jej nazwa. Gdy w nagłówku jest tylko adres e-mail, ustal nadawcę z podpisu na końcu maila (pole podpis). Nigdy nie wpisuj tu adresu e-mail, chyba że naprawdę nie da się ustalić nadawcy.' }, temat: { type: 'string' }, dlaczego: { type: 'string', description: 'jedno zdanie: czego dotyczy i czego oczekuje nadawca' } }, required: ['watek', 'od', 'temat', 'dlaczego'] } },
      kontakty: { type: 'array', description: 'Osoby do kontaktu dziś: zadania i alerty z rozmów, obiecane oddzwonienia, follow-upy po prezentacjach.', items: { type: 'object', properties: {
        kto: { type: 'string' }, numer: { type: 'string' }, sprawa: { type: 'string' } }, required: ['kto', 'sprawa'] } },
      jutro: { type: 'array', description: 'Co przygotować dziś na jutro (dokumenty, klucze, wydruki, umowy, sprzęt) na podstawie jutrzejszego kalendarza.', items: { type: 'string' } },
      punkty: { type: 'array', description: 'Własne punkty codziennego sprawdzania agentki, przepisane bez zmian.', items: { type: 'string' } }
    },
    required: ['mowa', 'dzis', 'maile', 'kontakty', 'jutro', 'punkty']
  }
};

function system(agentka) {
  return `Jesteś asystentką agentki nieruchomości w KRAMM Nieruchomości w Poznaniu (zespół kobiet). Przygotowujesz poranny brief dla: ${agentka.imie || 'agentki'}.
Teraz: ${czas.terazOpis()}.
Zasady:
- Zwracaj się do agentki po imieniu, w drugiej osobie, w formie żeńskiej ("masz", "przygotuj", "odezwij się").
- Konkretnie i rzeczowo, bez superlatyw, bez angielskich wtrąceń, bez wykrzykników. Zamiast półpauz używaj zwykłego łącznika.
- Tekst "mowa" jest czytany przez syntezator w samochodzie: krótkie zdania, najważniejsze na początku, maksymalnie 3 maile i 3 kontakty wymienione z nazwiska, resztę podsumuj liczbą.
- Nadawców maili przedstawiaj imieniem i nazwiskiem albo nazwą firmy, ustalonymi z nagłówka lub z podpisu na końcu maila. Nie czytaj na głos adresów e-mail.
- Nie wymyślaj faktów. Jeśli czegoś nie ma w danych, pomiń. Jeśli źródło danych jest niedostępne, powiedz o tym jednym zdaniem.
- Na końcu "mowa" dodaj jedno zdanie: "Powiedz, na który mail odpisać, albo co dodać do kalendarza."`;
}

async function zbierzDane(agentka, sekret) {
  const token = await g.tokenDostepu(agentka, sekret);
  const api = g.klient(token);
  const dzis = czas.dzien(), jutro = czas.dodajDni(dzis, 1);
  const dane = { braki: [] };
  await Promise.all([
    g.wydarzenia(api, dzis, jutro).then(w => { dane.wydarzenia = w; }).catch(e => { if (e.kod) throw e; dane.braki.push('kalendarz: ' + e.message); dane.wydarzenia = []; }),
    g.watkiDoOdpowiedzi(api, agentka.email).then(m => { dane.maile = m; }).catch(e => { if (e.kod) throw e; dane.braki.push('poczta: ' + e.message); dane.maile = []; }),
    g.arkuszNotatki(api, agentka.arkuszNotatki).then(async id => { dane.arkusz = id; dane.rozmowy = await g.rozmowy(api, id); })
      .catch(e => { if (e.kod) throw e; dane.braki.push('arkusz rozmów: ' + e.message); dane.rozmowy = []; })
  ]);
  return { api, dane, dzis, jutro };
}

async function przygotuj(agentka, { sekret, klucz }) {
  const { dane, dzis, jutro } = await zbierzDane(agentka, sekret);
  const tresc = {
    kalendarz_dzis: dane.wydarzenia.filter(e => (e.start || '').startsWith(dzis)),
    kalendarz_jutro: dane.wydarzenia.filter(e => (e.start || '').startsWith(jutro)),
    maile_bez_odpowiedzi: dane.maile,
    ostatnie_rozmowy_z_notatki: dane.rozmowy,
    punkty_codzienne_agentki: agentka.punkty || [],
    niedostepne_zrodla: dane.braki
  };
  const odp = await claude.zapytaj({ klucz, model: claude.MODEL_TEKSTY, system: system(agentka), narzedzia: [NARZEDZIE_BRIEF], wymusNarzedzie: 'zapisz_brief', maxTokenow: 3000,
    wiadomosci: [{ role: 'user', content: 'Dane na dziś (JSON):\n' + JSON.stringify(tresc) }] });
  const n = claude.narzedzie(odp);
  if (!n) throw new Error('Nie udało się przygotować briefu');
  const b = n.dane;
  // tylko wątki, które naprawdę istnieją; uzupełnij adres nadawcy
  const wg = Object.fromEntries(dane.maile.map(m => [m.watek, m]));
  b.maile = (b.maile || []).filter(m => wg[m.watek]).map((m, i) => ({ ...m, nr: i + 1, odEmail: wg[m.watek].odEmail }));
  return { ...b, data: dzis, utworzono: new Date().toISOString(), arkusz: dane.arkusz || null, braki: dane.braki };
}

module.exports = { przygotuj, zbierzDane, NARZEDZIE_BRIEF };
