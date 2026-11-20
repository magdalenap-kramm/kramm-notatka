// Tabela Dziewczyny Kramm: piątkowe przypomnienie o uzupełnieniu zakładki
// i zadania o przedłużeniu umów pośrednictwa na miesiąc przed końcem (co tydzień, dopóki termin się nie zmieni).
const crypto = require('crypto');
const czas = require('./czas');

const TABELA_ID = '10yqMas3m5Ojj-95IBZsE1TobAZ33-1F5VnJ0eeO6YXo';
const TABELA_URL = `https://docs.google.com/spreadsheets/d/${TABELA_ID}/edit`;
const DNI_PRZED = 30;      // zadanie o przedłużeniu na miesiąc przed końcem umowy
const CO_ILE_DNI = 7;      // ponowne zadanie, dopóki termin w tabeli się nie zmieni

// domyślne zakładki dla adresów, gdy agentka nie wybrała swojej w ustawieniach
const DOMYSLNE = {
  'magdalena.k@kramm.pl': 'Magda K', 'magdalena@kramm.pl': 'Magda H', 'zanna@kramm.pl': 'Żanna',
  'sonia@kramm.pl': 'Sonia', 'barbara@kramm.pl': 'Basia', 'dominika@kramm.pl': 'Domi', 'wiktoria@kramm.pl': 'Wiktoria'
};
const bezPl = t => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l').trim();

async function zakladki(api) {
  const j = await api(`https://sheets.googleapis.com/v4/spreadsheets/${TABELA_ID}?fields=sheets.properties.title`);
  return (j.sheets || []).map(s => s.properties.title).filter(t => !/^liczba odpowiedzi|^arkusz\d+$/i.test(t));
}
function zgadnijZakladke(agentka, lista) {
  if (agentka.zakladkaTabeli && lista.includes(agentka.zakladkaTabeli)) return agentka.zakladkaTabeli;
  const d = DOMYSLNE[agentka.email]; if (d && lista.includes(d)) return d;
  const imie = bezPl(agentka.imie);
  const pasujace = lista.filter(t => bezPl(t).split(/\s+/)[0] === imie);
  return pasujace.length === 1 ? pasujace[0] : null;
}

// "2026-12-15", "15.12.2026", "15.12.26", "15/12/2026" -> "2026-12-15"
function data(t) {
  const s = String(t || '').trim();
  let m = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/);
  if (m) return `${m[3].length === 2 ? '20' + m[3] : m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}
const dniMiedzy = (a, b) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 864e5);
const krotko = d => `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}`;

// umowy "w toku" z terminem zakończenia
async function umowy(api, zakladka) {
  const j = await api(`https://sheets.googleapis.com/v4/spreadsheets/${TABELA_ID}/values/${encodeURIComponent(`'${zakladka}'!A1:AB`)}`);
  const w = j.values || [];
  const iNag = w.findIndex(r => r.some(c => /termin zako/i.test(c)));
  if (iNag < 0) return [];
  const nag = w[iNag];
  const k = re => nag.findIndex(c => re.test(String(c)));
  const kNazwa = k(/nazwa kontraktu/i), kTermin = k(/termin zako/i), kStatus = k(/^status/i);
  return w.slice(iNag + 1).map(r => ({
    nazwa: String(r[kNazwa] || '').split('\n')[0].trim(),
    termin: data(r[kTermin]),
    status: String(kStatus >= 0 ? r[kStatus] || '' : '').toLowerCase().trim()
  })).filter(u => u.nazwa && u.termin && (!u.status || u.status === 'w toku'));
}

// wywoływane przy każdym briefie; dodaje zadania na dziś (bez duplikatów)
async function sprawdz({ api, ref, agentka }) {
  const dzis = czas.dzien();
  const wynik = { zadania: [], zakladka: null, blad: null };
  const dodaj = async (id, tekst) => {
    const d = ref.collection('zadania').doc(id);
    if ((await d.get()).exists) return;
    await d.set({ dzien: dzis, tekst, zrobione: false, utworzono: Date.now(), od: 'Tabela KRAMM' });
    wynik.zadania.push(tekst);
  };
  try {
    const lista = await zakladki(api);
    const zak = zgadnijZakladke(agentka, lista);
    wynik.zakladka = zak;
    if (new Date(dzis + 'T12:00:00Z').getUTCDay() === 5 && zak) {
      await dodaj(`tabela-${dzis}`, `Uzupełnij tabelę KRAMM - zakładka „${zak}”: statusy, terminy umów i komentarz z tego tygodnia`);
    }
    if (!zak) return wynik;
    const stanRef = ref.collection('stan').doc('umowy');
    const stan = ((await stanRef.get()).data() || {}).umowy || {};
    const nowy = {};
    for (const u of await umowy(api, zak)) {
      const klucz = crypto.createHash('sha1').update(u.nazwa).digest('hex').slice(0, 16);
      const ile = dniMiedzy(dzis, u.termin);
      const s = stan[klucz] && stan[klucz].termin === u.termin ? stan[klucz] : { termin: u.termin };   // zmiana terminu = umowa przedłużona, licz od nowa
      if (ile <= DNI_PRZED) {
        if (!s.ostatnie || dniMiedzy(s.ostatnie, dzis) >= CO_ILE_DNI) {
          const kiedy = ile < 0 ? `wygasła ${krotko(u.termin)}` : ile === 0 ? 'kończy się dziś' : `kończy się ${krotko(u.termin)} (za ${ile} dni)`;
          await dodaj(`umowa-${klucz}-${dzis}`, `Przedłuż umowę pośrednictwa: ${u.nazwa} - ${kiedy}. Po przedłużeniu zmień termin w tabeli`);
          s.ostatnie = dzis;
        }
      }
      nowy[klucz] = s;
    }
    await stanRef.set({ umowy: nowy, sprawdzono: dzis });
  } catch (e) {
    if (e.kod) throw e;
    wynik.blad = e.message;
  }
  return wynik;
}

module.exports = { TABELA_ID, TABELA_URL, sprawdz, zakladki, zgadnijZakladke, umowy, data, dniMiedzy };
