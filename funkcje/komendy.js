// Polecenia głosowe: rozpoznanie (Claude), potwierdzenie i wykonanie.
const czas = require('./czas');
const g = require('./google');
const claude = require('./claude');

const TAK = /^(tak|no tak|jasne|potwierdzam|potwierdź|wyślij|wysyłaj|wysyłam|dodaj|dodawaj|zapisz|ok|okej|okay|dobrze|zgadza się|pewnie|zgoda|może być|śmiało|dawaj)\b/i;
const NIE = /^(nie|anuluj|stop|zostaw|rezygnuj|odwołaj|nic|skasuj|usuń to)\b/i;
const czysc = t => String(t || '').trim().toLowerCase().replace(/[.,!?]+$/g, '');

const NARZEDZIA = [
  { name: 'kalendarz_dodaj', description: 'Dodaje do Kalendarza Google wydarzenie (spotkanie, prezentacja), przypomnienie (alert) albo zadanie.',
    input_schema: { type: 'object', properties: {
      rodzaj: { type: 'string', enum: ['wydarzenie', 'przypomnienie', 'zadanie'] },
      tytul: { type: 'string', description: 'krótki tytuł, np. "Prezentacja mieszkania - Pani Nowak"' },
      start: { type: 'string', description: 'czas warszawski w formacie YYYY-MM-DDTHH:MM; gdy nie podano godziny zadania, przyjmij 09:00' },
      minut: { type: 'integer', description: 'czas trwania w minutach, jeśli podany' },
      miejsce: { type: 'string' }, opis: { type: 'string' } }, required: ['rodzaj', 'tytul', 'start'] } },
  { name: 'kalendarz_sprawdz', description: 'Sprawdza, co agentka ma w kalendarzu w danym okresie.',
    input_schema: { type: 'object', properties: { od: { type: 'string', description: 'YYYY-MM-DD' }, do: { type: 'string', description: 'YYYY-MM-DD' },
      pora: { type: 'string', enum: ['caly', 'rano', 'popoludnie', 'wieczor'] } }, required: ['od', 'do'] } },
  { name: 'mail_odpowiedz', description: 'Przygotowuje odpowiedź na mail z listy z briefu (Claude pisze tekst, agentka potwierdza wysłanie).',
    input_schema: { type: 'object', properties: { nr: { type: 'integer', description: 'numer maila z listy z briefu. Gdy agentka podaje nadawcę (imię, nazwisko, firmę, także w innej odmianie) albo temat, dobierz numer z listy. Gdy mówi o mailu, który właśnie był czytany, podaj jego numer.' },
      opis: { type: 'string', description: 'od kogo albo czego dotyczy mail, jeśli nie podano numeru' },
      polecenie: { type: 'string', description: 'co ma być w odpowiedzi, słowami agentki' } }, required: ['polecenie'] } },
  { name: 'mail_przeczytaj', description: 'Czyta na głos treść maila z listy.',
    input_schema: { type: 'object', properties: { nr: { type: 'integer', description: 'numer maila z listy z briefu; gdy agentka podaje nadawcę (w dowolnej odmianie) albo temat, dobierz numer z listy' }, opis: { type: 'string', description: 'nadawca lub temat, gdy nie da się dobrać numeru' } } } },
  { name: 'brief_czytaj', description: 'Czyta poranny brief albo jego część.',
    input_schema: { type: 'object', properties: { sekcja: { type: 'string', enum: ['wszystko', 'dzis', 'maile', 'kontakty', 'jutro', 'punkty'] } }, required: ['sekcja'] } },
  { name: 'punkt_dodaj', description: 'Dodaje stały punkt do codziennego porannego sprawdzania, np. "sprawdzić nowe ogłoszenia na Otodomie".',
    input_schema: { type: 'object', properties: { tekst: { type: 'string' } }, required: ['tekst'] } },
  { name: 'punkt_usun', description: 'Usuwa punkt z codziennego sprawdzania.',
    input_schema: { type: 'object', properties: { tekst: { type: 'string' } }, required: ['tekst'] } },
  { name: 'godzina_briefu', description: 'Zmienia godzinę porannego briefu.',
    input_schema: { type: 'object', properties: { godzina: { type: 'string', description: 'HH:MM' } }, required: ['godzina'] } },
  { name: 'odpowiedz', description: 'Krótka odpowiedź słowna: dopytanie, gdy brakuje danych (np. godziny), albo informacja, że czegoś nie umiesz.',
    input_schema: { type: 'object', properties: { tekst: { type: 'string' } }, required: ['tekst'] } }
];

function systemKomend(agentka, brief, ostatni) {
  const maile = (brief && brief.maile || []).map(m => `${m.nr}. od ${m.od}: ${m.temat}`).join('\n') || '(brak)';
  return `Jesteś głosową asystentką agentki nieruchomości ${agentka.imie || ''} z KRAMM Nieruchomości. Agentka mówi do telefonu, często w samochodzie.
Teraz: ${czas.terazOpis()}.
Zawsze wybierz dokładnie jedno narzędzie. Daty względne ("jutro", "w piątek", "za tydzień") zamień na konkretne daty względem dzisiaj; "w piątek" to najbliższy przyszły piątek.
Jeśli w poleceniu dodania do kalendarza brakuje dnia, dopytaj narzędziem "odpowiedz". Jeśli brakuje godziny wydarzenia lub przypomnienia, dopytaj; dla zadania przyjmij 09:00.
Odpowiedzi w narzędziu "odpowiedz" mają 1-2 krótkie zdania, w formie żeńskiej, bez list.
Maile z porannego briefu:
${maile}
Punkty codzienne agentki: ${(agentka.punkty || []).join('; ') || '(brak)'}${ostatni ? `\nOstatnio czytany mail: numer ${ostatni}. Jeśli agentka mówi "odpisz", "odpowiedz mu/jej" bez wskazania maila, chodzi o ten mail.` : ''}`;
}

// ---------- pomocnicze ----------
const krotkiTekst = t => String(t || '').replace(/\s+/g, ' ').trim();
function bezPodpisu(t) { return String(t).split(/\n\s*(Pozdrawiam|Z poważaniem|Serdecznie pozdrawiam)/i)[0].trim(); }
const bezPl = t => czysc(t).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ł/g, 'l');
const POMIN = new Set(['mail', 'maila', 'mailu', 'maile', 'przeczytaj', 'odpisz', 'odpowiedz', 'pana', 'pani', 'panu', 'temat', 'tego', 'jego', 'jej', 'numer', 'wiadomosc']);
function wybierzMail(brief, { nr, opis, ostatni } = {}) {
  const lista = (brief && brief.maile) || [];
  if (nr) { const m = lista.find(x => x.nr === nr); if (m) return m; }
  if (opis) {
    const slowa = bezPl(opis).split(/[\s,.]+/).filter(s => s.length > 2 && !POMIN.has(s));
    let naj = null, ocena = 0;
    for (const m of lista) {
      const tekst = bezPl(`${m.od} ${m.odEmail} ${m.temat} ${m.dlaczego}`);
      const o = slowa.filter(s => tekst.includes(s.slice(0, Math.min(5, s.length)))).length;
      if (o > ocena) { ocena = o; naj = m; }
    }
    if (naj) return naj;
  }
  if (ostatni) { const m = lista.find(x => x.nr === ostatni); if (m) return m; }
  return lista.length === 1 ? lista[0] : null;
}
function wPorze(e, pora) {
  if (!pora || pora === 'caly' || e.caly) return true;
  const h = +String(e.start).slice(11, 13);
  return pora === 'rano' ? h < 12 : pora === 'popoludnie' ? h >= 12 && h < 18 : h >= 17;
}
function opisWydarzen(lista, od, doDnia, pora) {
  const okres = od === doDnia ? czas.mowionaData(od + 'T12:00', false) : `od ${czas.mowionaData(od + 'T12:00', false)} do ${czas.mowionaData(doDnia + 'T12:00', false)}`;
  const kiedy = okres + (pora === 'rano' ? ' rano' : pora === 'popoludnie' ? ' po południu' : pora === 'wieczor' ? ' wieczorem' : '');
  if (!lista.length) return `${kiedy[0].toUpperCase() + kiedy.slice(1)} nie masz nic w kalendarzu.`;
  const czesci = lista.slice(0, 8).map(e => {
    const dz = od === doDnia ? '' : czas.mowionaData(e.start.slice(0, 10) + 'T12:00', false) + ', ';
    return e.caly ? `${dz}cały dzień: ${e.tytul}` : `${dz}o ${e.start.slice(11, 16)} ${e.tytul}${e.miejsce ? ', ' + e.miejsce.split(',')[0] : ''}`;
  });
  const ile = lista.length === 1 ? 'jedną pozycję' : lista.length < 5 ? `${lista.length} pozycje` : `${lista.length} pozycji`;
  return `${kiedy[0].toUpperCase() + kiedy.slice(1)} masz ${ile}. ${czesci.join('. ')}.${lista.length > 8 ? ' I jeszcze kilka innych.' : ''}`;
}
function czytajBrief(b, sekcja) {
  if (!b) return 'Nie mam jeszcze dzisiejszego briefu. Powiedz: przygotuj brief.';
  const lista = (t, xs) => xs.length ? t + ' ' + xs.join('. ') + '.' : '';
  switch (sekcja) {
    case 'dzis': return lista('Dziś:', (b.dzis || []).map(d => `${d.godzina} ${d.tytul}${d.miejsce ? ', ' + d.miejsce : ''}`)) || 'Dziś nie masz nic w kalendarzu.';
    case 'maile': return lista('Maile do odpowiedzi:', (b.maile || []).map(m => `${m.nr}, od ${m.od}: ${m.dlaczego}`)) || 'Nie ma maili czekających na odpowiedź.';
    case 'kontakty': return lista('Do kontaktu:', (b.kontakty || []).map(k => `${k.kto}, ${k.sprawa}`)) || 'Nie ma osób do kontaktu.';
    case 'jutro': return lista('Na jutro przygotuj:', b.jutro || []) || 'Na jutro nie ma nic do przygotowania.';
    case 'punkty': return lista('Twoje punkty na dziś:', b.punkty || []) || 'Nie masz ustawionych punktów codziennych.';
    default: return b.mowa;
  }
}

// ---------- maile ----------
async function napiszOdpowiedz({ agentka, w, polecenie, poprzedni, klucz }) {
  const tekstWatku = w.wiadomosci.map(m => `--- ${m.wyslana ? 'AGENTKA' : 'OD: ' + m.od} (${m.data})\n${m.tekst}`).join('\n\n');
  const odp = await claude.zapytaj({ klucz, model: claude.MODEL_TEKSTY, maxTokenow: 1200,
    system: `Piszesz odpowiedź na maila w imieniu agentki ${agentka.imie} z KRAMM Nieruchomości (Poznań). Forma żeńska ("przesłałam", "jestem dostępna").
Ton: uprzejmy, rzeczowy, krótki. Bez superlatyw, bez angielskich wtrąceń, zwykły łącznik zamiast półpauzy. Zwracaj się "Pani"/"Panie" lub tak, jak nadawca zwraca się w wątku.
Nie obiecuj niczego i nie podawaj faktów (ceny, terminy, adresy), których nie ma w poleceniu agentki ani w wątku.
Zakończ podpisem:\nPozdrawiam serdecznie,\n${agentka.podpis || agentka.imie}\nKRAMM Nieruchomości`,
    narzedzia: [{ name: 'szkic', description: 'Treść maila (bez tematu).', input_schema: { type: 'object', properties: { tresc: { type: 'string' } }, required: ['tresc'] } }],
    wymusNarzedzie: 'szkic',
    wiadomosci: [{ role: 'user', content: `Wątek:\n${tekstWatku}\n\nPolecenie agentki: ${polecenie}${poprzedni ? `\n\nPoprzedni szkic do poprawienia:\n${poprzedni}` : ''}` }] });
  const n = claude.narzedzie(odp);
  return n ? String(n.dane.tresc).replace(/—|–/g, '-') : '';
}
async function przygotujMail({ agentka, api, brief, nr, opis, ostatni, polecenie, klucz }) {
  const m = wybierzMail(brief, { nr, opis, ostatni });
  if (!m) return { mow: (brief && brief.maile && brief.maile.length) ? 'Nie wiem, o który mail chodzi. Powiedz numer albo od kogo jest.' : 'Nie mam listy maili do odpowiedzi. Powiedz: przygotuj brief.', oczekuje: true };
  const w = await g.watek(api, m.watek);
  const ost = [...w.wiadomosci].reverse().find(x => !x.wyslana) || w.wiadomosci[w.wiadomosci.length - 1];
  const tresc = await napiszOdpowiedz({ agentka, w, polecenie, klucz });
  const temat = /^(re|odp):/i.test(ost.temat) ? ost.temat : 'Re: ' + ost.temat;
  const szkic = { do: ost.od, temat, tresc, odpowiedzNa: ost.idWiadomosci, referencje: ost.referencje, watek: m.watek };
  return { mow: `Szkic do ${m.od}: ${krotkiTekst(bezPodpisu(tresc))}. Wysłać, czy coś zmienić?`, oczekuje: true,
    noweOczekujace: { typ: 'mail', szkic, od: m.od, polecenie }, ekran: { typ: 'szkic', do: m.od, temat, tresc }, wybranyMail: m.nr };
}

// ---------- główna funkcja ----------
// stan: { oczekujace, rozmowa: [{rola, tekst}], brief }
async function obsluz({ agentka, tekst, stan, sekret, klucz }) {
  const t = czysc(tekst);
  if (!t) return { mow: 'Nie usłyszałam. Powtórz, proszę.', oczekuje: true };
  const ocz = stan.oczekujace;
  let api = null;
  const google = async () => api || (api = g.klient(await g.tokenDostepu(agentka, sekret)));

  // 1. odpowiedź na pytanie o potwierdzenie
  if (ocz) {
    if (TAK.test(t) && t.split(/\s+/).length <= 4 && !/\b(ale|tylko|zmień|popraw|nie|dopisz)\b/.test(t)) {
      if (ocz.typ === 'kalendarz') {
        await g.dodajWydarzenie(await google(), ocz.dane);
        return { mow: 'Dodane do kalendarza.', noweOczekujace: null, ekran: { typ: 'ok', tekst: 'Dodane do kalendarza' } };
      }
      if (ocz.typ === 'mail') {
        await g.wyslijMail(await google(), ocz.szkic);
        return { mow: `Wysłane do ${ocz.od}.`, noweOczekujace: null, ekran: { typ: 'ok', tekst: 'Mail wysłany' }, wyslanyWatek: ocz.szkic.watek };
      }
    }
    if (NIE.test(t) && t.split(/\s+/).length <= 3) return { mow: 'Dobrze, anulowane.', noweOczekujace: null, ekran: { typ: 'ok', tekst: 'Anulowane' } };
    if (ocz.typ === 'mail' && !/^(dodaj do kalendarza|przypomnij|co mam|przeczytaj brief)/.test(t)) {
      // poprawka szkicu
      const w = await g.watek(await google(), ocz.szkic.watek);
      const tresc = await napiszOdpowiedz({ agentka, w, polecenie: ocz.polecenie + '. Poprawka: ' + tekst, poprzedni: ocz.szkic.tresc, klucz });
      const szkic = { ...ocz.szkic, tresc };
      return { mow: `Poprawiony szkic: ${krotkiTekst(bezPodpisu(tresc))}. Wysłać?`, oczekuje: true,
        noweOczekujace: { ...ocz, szkic, polecenie: ocz.polecenie + '. ' + tekst }, ekran: { typ: 'szkic', do: ocz.od, temat: szkic.temat, tresc } };
    }
  }

  // 2. rozpoznanie polecenia
  const historia = (stan.rozmowa || []).slice(-6).map(r => ({ role: r.rola === 'agentka' ? 'user' : 'assistant', content: r.tekst }));
  const kontekst = ocz && ocz.typ === 'kalendarz' ? `\n(Czekasz na potwierdzenie: ${ocz.dane.rodzaj} "${ocz.dane.tytul}" ${ocz.dane.start}. Jeśli agentka coś poprawia, użyj kalendarz_dodaj z poprawionymi danymi.)` : '';
  const wiad = [...historia, { role: 'user', content: tekst + kontekst }];
  while (wiad.length && wiad[0].role !== 'user') wiad.shift();
  const odp = await claude.zapytaj({ klucz, model: claude.MODEL_KOMENDY, system: systemKomend(agentka, stan.brief, stan.ostatniMail), narzedzia: NARZEDZIA, wiadomosci: wiad, maxTokenow: 600 });
  const n = claude.narzedzie(odp) || { nazwa: 'odpowiedz', dane: { tekst: claude.tekst(odp) || 'Nie zrozumiałam. Powtórz, proszę.' } };
  const d = n.dane;

  switch (n.nazwa) {
    case 'kalendarz_dodaj': {
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(d.start || '')) return { mow: 'Na kiedy to ustawić?', oczekuje: true };
      const nazwa = { wydarzenie: 'wydarzenie', przypomnienie: 'przypomnienie', zadanie: 'zadanie' }[d.rodzaj] || 'wydarzenie';
      return { mow: `Dodaję ${nazwa}: ${d.tytul}, ${czas.mowionaData(d.start)}${d.miejsce ? ', ' + d.miejsce : ''}. Potwierdzasz?`, oczekuje: true,
        noweOczekujace: { typ: 'kalendarz', dane: d }, ekran: { typ: 'kalendarz', ...d, kiedy: czas.mowionaData(d.start) } };
    }
    case 'kalendarz_sprawdz': {
      const od = d.od || czas.dzien(), doDnia = d.do || od;
      const lista = (await g.wydarzenia(await google(), od, doDnia)).filter(e => wPorze(e, d.pora));
      return { mow: opisWydarzen(lista, od, doDnia, d.pora), noweOczekujace: null, ekran: { typ: 'lista', pozycje: lista.map(e => ({ godzina: e.caly ? 'cały dzień' : e.start.slice(11, 16), tytul: e.tytul, miejsce: e.miejsce })) } };
    }
    case 'mail_odpowiedz':
      return przygotujMail({ agentka, api: await google(), brief: stan.brief, nr: d.nr, opis: d.opis, ostatni: stan.ostatniMail, polecenie: d.polecenie, klucz });
    case 'mail_przeczytaj': {
      const m = wybierzMail(stan.brief, { ...d, ostatni: stan.ostatniMail });
      if (!m) return { mow: 'Który mail przeczytać? Powiedz numer albo od kogo.', oczekuje: true };
      const w = await g.watek(await google(), m.watek);
      const ost = [...w.wiadomosci].reverse().find(x => !x.wyslana) || w.wiadomosci[w.wiadomosci.length - 1];
      return { mow: `Mail od ${m.od}, temat: ${ost.temat}. ${krotkiTekst(ost.tekst).slice(0, 1200)}. Co mam odpisać?`, oczekuje: true, noweOczekujace: null,
        ekran: { typ: 'mail', od: m.od, temat: ost.temat, tresc: ost.tekst }, wybranyMail: m.nr };
    }
    case 'brief_czytaj':
      return { mow: czytajBrief(stan.brief, d.sekcja), oczekuje: false, noweOczekujace: null };
    case 'punkt_dodaj': {
      const punkty = [...(agentka.punkty || []), krotkiTekst(d.tekst)].slice(0, 15);
      return { mow: `Dodane do codziennego sprawdzania: ${d.tekst}.`, zapisz: { punkty }, noweOczekujace: null };
    }
    case 'punkt_usun': {
      const s = czysc(d.tekst).split(/\s+/).filter(x => x.length > 3);
      const punkty = (agentka.punkty || []).filter(p => !s.some(x => czysc(p).includes(x.slice(0, 5))));
      if (punkty.length === (agentka.punkty || []).length) return { mow: 'Nie znalazłam takiego punktu.' };
      return { mow: 'Usunięte z codziennego sprawdzania.', zapisz: { punkty }, noweOczekujace: null };
    }
    case 'godzina_briefu': {
      const h = czas.doPieciu(d.godzina);
      if (!h) return { mow: 'O której godzinie?', oczekuje: true };
      return { mow: `Brief będzie codziennie o ${h}.`, zapisz: { godzina: h }, noweOczekujace: null };
    }
    default:
      return { mow: d.tekst || 'Nie zrozumiałam. Powtórz, proszę.', oczekuje: /\?\s*$/.test(d.tekst || '') };
  }
}

module.exports = { obsluz, wybierzMail, opisWydarzen, czytajBrief, TAK, NIE, NARZEDZIA };
