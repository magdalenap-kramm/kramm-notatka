// Poranny brief: kalendarz (dziś + jutro), maile do odpowiedzi, rozmowy z Notatki KRAMM.
const czas = require('./czas');
const g = require('./google');
const claude = require('./claude');

const NARZEDZIE_BRIEF = {
  name: 'zapisz_brief',
  description: 'Zapisuje poranny brief agentki.',
  input_schema: {
    type: 'object',
    properties: {
      dzis: { type: 'array', items: { type: 'object', properties: {
        godzina: { type: 'string' }, tytul: { type: 'string' }, miejsce: { type: 'string' }, notka: { type: 'string', description: 'co warto wiedzieć lub zabrać, np. z historii rozmów; pusty tekst jeśli nic' } }, required: ['godzina', 'tytul'] } },
      maile: { type: 'array', description: 'Maile, na które agentka powinna odpowiedzieć, od najpilniejszego. Uwzględnij każdy mail od konkretnej osoby lub firmy, który zawiera pytanie, prośbę albo sprawę do załatwienia; w razie wątpliwości uwzględnij. Pomiń tylko newslettery, reklamy i automatyczne powiadomienia systemów.', items: { type: 'object', properties: {
        id: { type: 'string', description: 'krótki identyfikator maila z listy, np. M3' }, od: { type: 'string', description: 'imię i nazwisko nadawcy, a przy firmie także jej nazwa. Gdy w nagłówku jest tylko adres e-mail, ustal nadawcę z podpisu na końcu maila (pole podpis). Nigdy nie wpisuj tu adresu e-mail, chyba że naprawdę nie da się ustalić nadawcy.' }, temat: { type: 'string' }, dlaczego: { type: 'string', description: 'jedno zdanie: czego dotyczy i czego oczekuje nadawca' } }, required: ['id', 'od', 'temat', 'dlaczego'] } },
      kontakty: { type: 'array', description: 'Osoby do kontaktu dziś: zadania i alerty z rozmów, obiecane oddzwonienia, follow-upy po prezentacjach.', items: { type: 'object', properties: {
        kto: { type: 'string' }, numer: { type: 'string' }, sprawa: { type: 'string' } }, required: ['kto', 'sprawa'] } },
      jutro: { type: 'array', description: 'Co przygotować dziś na jutro (dokumenty, klucze, wydruki, umowy, sprzęt) na podstawie jutrzejszego kalendarza.', items: { type: 'string' } },
      mowa: { type: 'string', description: 'Tekst do przeczytania na głos (60-90 sekund). Naturalna polszczyzna, bez list i znaków specjalnych, godziny słownie zrozumiałe dla lektora (np. "o jedenastej trzydzieści").' }
    },
    required: ['dzis', 'maile', 'kontakty', 'jutro', 'mowa']
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
- Nieprzeczytane wiadomości od dziewczyn z KRAMM wymień w "mowa" (kto i czego dotyczy); sprawy do zrobienia z nich dodaj do "dzis".
- Zadania z listy agentki na dziś i zaległe umieść w "dzis" (zaległe z dopiskiem "zaległe"), zadania na jutro w "jutro".
- Najpierw wypełnij listy dzis, maile, kontakty i jutro. W "mowa" podaj tylko, ile nowych wpisów jest w każdym arkuszu (np. "W arkuszu Leady masz 3 nowe wpisy"), bez wymieniania osób z arkuszy. Każda osoba, mail i sprawa wymieniona w "mowa" musi też być na odpowiedniej liście.
- Na końcu "mowa" dodaj jedno zdanie: "Powiedz, na który mail odpisać, albo co dodać do kalendarza."`;
}

// ile nowych wierszy przybyło w każdym pilnowanym arkuszu od ostatniego briefu
function liczArkusze(dane) {
  return (dane.arkusze || []).map(a => ({ id: a.id, nazwa: a.nazwa, nowe: typeof a.znane === 'number' ? Math.max(0, a.wiersze.length - a.znane) : 0, wszystkie: a.wiersze.length }));
}
async function zbierzDane(agentka, sekret) {
  const token = await g.tokenDostepu(agentka, sekret);
  const api = g.klient(token);
  const dzis = czas.dzien(), jutro = czas.dodajDni(dzis, 1);
  const dane = { braki: [] };
  await Promise.all([
    g.wydarzenia(api, dzis, jutro).then(w => { dane.wydarzenia = w; }).catch(e => { if (e.kod) throw e; dane.braki.push('kalendarz: ' + e.message); dane.wydarzenia = []; }),
    g.watkiDoOdpowiedzi(api, agentka.email).then(m => { dane.maile = m; }).catch(e => { if (e.kod) throw e; dane.braki.push('poczta: ' + (/quota|rate limit/i.test(e.message) ? 'Gmail chwilowo ograniczył odczyt, przygotuj brief od nowa za minutę' : e.message)); dane.maile = []; }),
    g.arkuszNotatki(api, agentka.arkuszNotatki).then(async id => { dane.arkusz = id; dane.rozmowy = await g.rozmowy(api, id); })
      .catch(e => { if (e.kod) throw e; dane.braki.push('arkusz rozmów: ' + e.message); dane.rozmowy = []; }),
    Promise.all((agentka.arkusze || []).slice(0, 5).map(a => g.odczytajArkusz(api, a.id).then(r => ({ ...r, id: a.id, znane: a.wiersze }))
      .catch(e => { if (e.kod) throw e; dane.braki.push(`arkusz ${a.nazwa}: ${e.message}`); return null; })))
      .then(l => { dane.arkusze = l.filter(Boolean); })
  ]);
  return { api, dane, dzis, jutro };
}

async function przygotuj(agentka, { sekret, klucz }) {
  const { dane, dzis, jutro } = await zbierzDane(agentka, sekret);
  const tresc = {
    kalendarz_dzis: dane.wydarzenia.filter(e => (e.start || '').startsWith(dzis)),
    kalendarz_jutro: dane.wydarzenia.filter(e => (e.start || '').startsWith(jutro)),
    maile_bez_odpowiedzi: dane.maile.map((m, i) => ({ id: 'M' + (i + 1), od: m.od, adres: m.odEmail, temat: m.temat, data: m.data, fragment: m.fragment, podpis: m.podpis, nieprzeczytany: m.nieprzeczytany, oznaczony_jako_wazny: m.wazny, masowy: m.masowy })),
    ostatnie_rozmowy_z_notatki: dane.rozmowy,
    wiadomosci_od_dziewczyn_z_kramm: agentka.wiadomosciOdDziewczyn || [],
    zadania_z_listy_agentki: agentka.zadania || { dzis: [], jutro: [], zalegle: [] },
    arkusze_pilnowane: liczArkusze(dane).map(a => ({ nazwa: a.nazwa, nowe_wpisy_od_ostatniego_briefu: a.nowe })),
    niedostepne_zrodla: dane.braki
  };
  const odp = await claude.zapytaj({ klucz, model: claude.MODEL_TEKSTY, system: system(agentka), narzedzia: [NARZEDZIE_BRIEF], wymusNarzedzie: 'zapisz_brief', maxTokenow: 8000,
    wiadomosci: [{ role: 'user', content: 'Dane na dziś (JSON):\n' + JSON.stringify(tresc) }] });
  const n = claude.narzedzie(odp);
  if (!n) throw new Error('Nie udało się przygotować briefu');
  const b = n.dane;
  // tylko wątki, które naprawdę istnieją; uzupełnij adres nadawcy
  const wg = Object.fromEntries(dane.maile.map((m, i) => ['M' + (i + 1), m]));
  b.maile = (b.maile || []).map(m => ({ m, z: wg[String(m.id || '').trim().toUpperCase()] })).filter(x => x.z)
    .map((x, i) => ({ nr: i + 1, watek: x.z.watek, od: x.m.od || x.z.od, odEmail: x.z.odEmail, temat: x.m.temat || x.z.temat, dlaczego: x.m.dlaczego || '' }));
  b.liczbaMaili = dane.maile.length;
  for (const k of ['dzis', 'kontakty', 'jutro']) if (!Array.isArray(b[k])) b[k] = [];
  b.arkusze = liczArkusze(dane);
  b.stanArkuszy = Object.fromEntries((dane.arkusze || []).map(a => [a.id, a.wiersze.length]));
  if (!b.maile.length) {   // model nie oddał listy - pokaż maile od ludzi (bez masowych)
    b.maile = dane.maile.filter(m => !m.masowy).slice(0, 8)
      .map((m, i) => ({ nr: i + 1, watek: m.watek, od: m.od, odEmail: m.odEmail, temat: m.temat, dlaczego: m.fragment.slice(0, 160) }));
  }
  return { ...b, data: dzis, utworzono: new Date().toISOString(), arkusz: dane.arkusz || null, braki: dane.braki };
}

module.exports = { przygotuj, zbierzDane, NARZEDZIE_BRIEF };
