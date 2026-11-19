// Testy logiki bez prawdziwych API (atrapy Google i Claude). Uruchom: npm test
const assert = require('assert');
const czas = require('./czas');
const g = require('./google');
const komendy = require('./komendy');
const brief = require('./brief');

const wywolania = [];
let claudeOdp = null;          // funkcja(cialo) -> { nazwa, dane }
const jutro = czas.dodajDni(czas.dzien(), 1);
const b64 = t => Buffer.from(t).toString('base64url');

global.fetch = async (url, op = {}) => {
  const u = String(url); wywolania.push({ url: u, op });
  const ok = j => ({ ok: true, status: 200, json: async () => j });
  if (u.includes('oauth2.googleapis.com/token')) return ok({ access_token: 'AT', expires_in: 3600 });
  if (u.includes('api.anthropic.com')) { const c = JSON.parse(op.body); const n = claudeOdp(c); return ok({ content: [{ type: 'tool_use', name: n.nazwa, input: n.dane }] }); }
  if (u.includes('/calendar/v3/calendars/primary/events?')) return ok({ items: [
    { id: 'e1', summary: 'Prezentacja Głogowska', start: { dateTime: jutro + 'T14:00:00+01:00' }, end: { dateTime: jutro + 'T15:00:00+01:00' }, location: 'Głogowska 40, Poznań' },
    { id: 'e2', summary: 'Podpisanie umowy', start: { dateTime: jutro + 'T09:00:00+01:00' }, end: { dateTime: jutro + 'T10:00:00+01:00' } }] });
  if (u.endsWith('/calendar/v3/calendars/primary/events')) return ok({ id: 'nowe' });
  if (u.includes('/threads?')) return ok({ threads: [{ id: 't1' }, { id: 't2' }] });
  if (u.includes('/threads/t1?format=metadata')) return ok({ messages: [{ id: 'm1', labelIds: ['INBOX', 'UNREAD'], snippet: 'Czy mieszkanie jest dostępne?', payload: { headers: [{ name: 'From', value: 'Jan Kowalski <jan@x.pl>' }, { name: 'Subject', value: 'Mieszkanie Jeżyce' }] } }] });
  if (u.includes('/threads/t2?format=metadata')) return ok({ messages: [{ labelIds: ['INBOX'], payload: { headers: [{ name: 'From', value: 'Ja <magdalena.p@kramm.pl>' }] } }, { labelIds: ['SENT'], payload: { headers: [{ name: 'From', value: 'magdalena.p@kramm.pl' }] } }] });
  if (u.includes('/threads/t1?format=full')) return ok({ messages: [{ labelIds: ['INBOX'], payload: { mimeType: 'text/plain', body: { data: b64('Dzień dobry, czy mieszkanie na Jeżycach jest dostępne?\n\n> stary cytat') },
    headers: [{ name: 'From', value: 'Jan Kowalski <jan@x.pl>' }, { name: 'Subject', value: 'Mieszkanie Jeżyce' }, { name: 'Message-ID', value: '<abc@x.pl>' }] } }] });
  if (u.includes('/messages/m1?format=full')) return ok({ payload: { mimeType: 'text/plain', body: { data: b64('Czy mieszkanie jest dostępne?\n\nPozdrawiam\nJan Kowalski\nABC Sp. z o.o.\ntel. 600 100 200') } } });
  if (u.includes('/messages/send')) return ok({ id: 'wyslany' });
  if (u.includes('/drive/v3/files')) return ok({ files: [{ id: 'ark1' }] });
  if (u.includes('sheets.googleapis.com')) return ok({ values: [[czas.dzien(), '10:00', "'570111222", 'Anna Nowak', 'Szuka 3 pokoi', 'zadanie', 'Oddzwonić', czas.dzien() + ' 12:00', 'W kalendarzu']] });
  throw new Error('nieznany adres ' + u);
};

const agentka = { email: 'magdalena.p@kramm.pl', imie: 'Magda', refresh: 'RT', punkty: ['Sprawdzić Otodom'] };
const opcje = { sekret: 'S', klucz: 'K' };

(async () => {
  // czas
  assert.strictEqual(czas.doPieciu('7:37'), '07:35');
  assert.ok(czas.mowionaData(jutro + 'T11:00').startsWith('jutro o 11:00'));

  // brief: bierze tylko istniejące wątki i numeruje
  claudeOdp = c => { assert.ok(!c.tool_choice && c.system.includes('zapisz_brief')); const dane = JSON.parse(c.messages[0].content.split('\n').slice(1).join('\n'));
    assert.strictEqual(dane.maile_bez_odpowiedzi.length, 1, 'wątek z odpowiedzią pominięty'); assert.ok(dane.maile_bez_odpowiedzi[0].podpis.includes('ABC Sp. z o.o.')); assert.strictEqual(dane.kalendarz_jutro.length, 2);
    return { nazwa: 'zapisz_brief', dane: { mowa: 'Dzień dobry Magda.', dzis: [], maile: [{ id: 'm1', od: 'Jan Kowalski', temat: 'Mieszkanie Jeżyce', dlaczego: 'pyta o dostępność' }, { id: 'M9', od: 'X', temat: 'Y', dlaczego: 'Z' }], kontakty: [], jutro: ['Klucze'], punkty: ['Sprawdzić Otodom'] } }; };
  const b = await brief.przygotuj(agentka, opcje);
  assert.strictEqual(b.maile.length, 1); assert.strictEqual(b.maile[0].nr, 1); assert.strictEqual(b.maile[0].watek, 't1'); assert.strictEqual(b.maile[0].odEmail, 'jan@x.pl'); assert.strictEqual(b.arkusz, 'ark1');

  // kalendarz: propozycja -> potwierdzenie -> zapis
  claudeOdp = () => ({ nazwa: 'kalendarz_dodaj', dane: { rodzaj: 'wydarzenie', tytul: 'Prezentacja', start: jutro + 'T11:00', miejsce: 'Głogowska 40' } });
  let w = await komendy.obsluz({ agentka, tekst: 'dodaj prezentację jutro o 11 Głogowska 40', stan: { brief: b }, ...opcje });
  assert.ok(w.oczekuje && w.noweOczekujace.typ === 'kalendarz'); assert.ok(/jutro o 11:00/.test(w.mow), w.mow);
  w = await komendy.obsluz({ agentka, tekst: 'Tak.', stan: { oczekujace: w.noweOczekujace, brief: b }, ...opcje });
  assert.strictEqual(w.mow, 'Dodane do kalendarza.');
  const ins = wywolania.filter(x => x.url.endsWith('/events') && x.op.method === 'POST').pop();
  const ev = JSON.parse(ins.op.body); assert.strictEqual(ev.start.dateTime, jutro + 'T11:00:00'); assert.strictEqual(ev.start.timeZone, 'Europe/Warsaw'); assert.strictEqual(ev.end.dateTime, jutro + 'T12:00:00');

  // "tak, ale ..." nie zatwierdza
  const ocz = { typ: 'kalendarz', dane: { rodzaj: 'zadanie', tytul: 'A', start: jutro + 'T09:00' } };
  claudeOdp = () => ({ nazwa: 'kalendarz_dodaj', dane: { rodzaj: 'zadanie', tytul: 'A', start: jutro + 'T10:00' } });
  w = await komendy.obsluz({ agentka, tekst: 'tak ale na dziesiątą', stan: { oczekujace: ocz, brief: b }, ...opcje });
  assert.strictEqual(w.noweOczekujace.dane.start, jutro + 'T10:00');
  w = await komendy.obsluz({ agentka, tekst: 'nie', stan: { oczekujace: ocz, brief: b }, ...opcje });
  assert.strictEqual(w.noweOczekujace, null);

  // mail: szkic -> poprawka -> wysłanie
  claudeOdp = c => c.system.includes('"szkic"')
    ? { nazwa: 'szkic', dane: { tresc: 'Dzień dobry,\nmieszkanie jest dostępne — zapraszam na prezentację.\n\nPozdrawiam serdecznie,\nMagda\nKRAMM Nieruchomości' } }
    : { nazwa: 'mail_odpowiedz', dane: { opis: 'Kowalski', polecenie: 'że jest dostępne, zaproś na prezentację' } };
  w = await komendy.obsluz({ agentka, tekst: 'odpisz Kowalskiemu że jest dostępne', stan: { brief: b }, ...opcje });
  assert.strictEqual(w.noweOczekujace.typ, 'mail'); assert.ok(!w.mow.includes('Pozdrawiam')); assert.ok(!w.noweOczekujace.szkic.tresc.includes('—'));
  assert.strictEqual(w.noweOczekujace.szkic.odpowiedzNa, '<abc@x.pl>'); assert.strictEqual(w.noweOczekujace.szkic.temat, 'Re: Mieszkanie Jeżyce');
  const w2 = await komendy.obsluz({ agentka, tekst: 'dopisz że w czwartek o 16', stan: { oczekujace: w.noweOczekujace, brief: b }, ...opcje });
  assert.ok(w2.noweOczekujace.polecenie.includes('czwartek'));
  const w3 = await komendy.obsluz({ agentka, tekst: 'wyślij', stan: { oczekujace: w2.noweOczekujace, brief: b }, ...opcje });
  assert.strictEqual(w3.wyslanyWatek, 't1');
  const send = JSON.parse(wywolania.filter(x => x.url.includes('/messages/send')).pop().op.body);
  const raw = Buffer.from(send.raw, 'base64url').toString();
  assert.ok(raw.includes('To: Jan Kowalski <jan@x.pl>') && raw.includes('In-Reply-To: <abc@x.pl>') && raw.includes('=?UTF-8?B?')); assert.strictEqual(send.threadId, 't1');

  // dopasowanie po odmienionym nazwisku i po ostatnio czytanym mailu
  assert.strictEqual(komendy.wybierzMail({ maile: [{ nr: 1, od: 'Jan Kowalski', odEmail: 'jan@x.pl', temat: 'A', dlaczego: '' }, { nr: 2, od: 'Żaneta Łącka', odEmail: 'z@x.pl', temat: 'B', dlaczego: '' }] }, { opis: 'przeczytaj maila od Żanety Łąckiej' }).nr, 2);
  assert.strictEqual(komendy.wybierzMail({ maile: [{ nr: 1, od: 'Jan Kowalski', odEmail: 'j', temat: 'A', dlaczego: '' }, { nr: 2, od: 'Ola', odEmail: 'o', temat: 'B', dlaczego: '' }] }, { opis: 'Kowalskiemu' }).nr, 1);
  assert.strictEqual(komendy.wybierzMail({ maile: [{ nr: 1, od: 'A' }, { nr: 2, od: 'B' }] }, { ostatni: 2 }).nr, 2);
  claudeOdp = () => ({ nazwa: 'mail_przeczytaj', dane: { opis: 'Kowalskiego' } });
  w = await komendy.obsluz({ agentka, tekst: 'przeczytaj maila od Jana Kowalskiego', stan: { brief: b }, ...opcje });
  assert.strictEqual(w.wybranyMail, 1); assert.ok(/Co mam odpisać/.test(w.mow));

  // sprawdzenie kalendarza
  claudeOdp = () => ({ nazwa: 'kalendarz_sprawdz', dane: { od: jutro, do: jutro, pora: 'popoludnie' } });
  w = await komendy.obsluz({ agentka, tekst: 'co mam jutro po południu', stan: { brief: b }, ...opcje });
  assert.ok(/jedną pozycję/.test(w.mow) && /14:00 Prezentacja Głogowska/.test(w.mow), w.mow);

  // godzina
  claudeOdp = () => ({ nazwa: 'godzina_briefu', dane: { godzina: '6:52' } });
  w = await komendy.obsluz({ agentka, tekst: 'brief o 6:52', stan: {}, ...opcje });
  assert.strictEqual(w.zapisz.godzina, '06:50');

  // budowa maila: polskie znaki w temacie i treści
  const raw2 = Buffer.from(g.zbudujMail({ do: 'a@b.pl', temat: 'Zażółć', tresc: 'gęślą jaźń' }), 'base64url').toString();
  assert.ok(raw2.includes('=?UTF-8?B?') && !raw2.includes('Zażółć'));
  // wiadomości i zadania między dziewczynami
  const zesp = [{ email: 'magdalena.p@kramm.pl', imie: 'Magdalena' }, { email: 'zanna@kramm.pl', imie: 'Żanna', nazwa: 'Żanna Test' }];
  claudeOdp = c => { assert.ok(c.system.includes('zanna@kramm.pl')); return { nazwa: 'zadanie_dla', dane: { do: 'zanna@kramm.pl', tekst: 'Zadzwonić do Nowaka', dzien: '2026-11-20' } }; };
  w = await komendy.obsluz({ agentka, tekst: 'wrzuć Żannie na piątek telefon do Nowaka', stan: {}, zespol: zesp, ...opcje });
  assert.strictEqual(w.noweOczekujace.typ, 'wiadomosc'); assert.ok(w.noweOczekujace.zadanie);
  w = await komendy.obsluz({ agentka, tekst: 'tak', stan: { oczekujace: w.noweOczekujace }, zespol: zesp, ...opcje });
  assert.strictEqual(w.wyslijWiadomosc.do, 'zanna@kramm.pl'); assert.strictEqual(w.wyslijWiadomosc.dzien, '2026-11-20');
  claudeOdp = () => ({ nazwa: 'zadanie_dodaj', dane: { tekst: 'Wysłać umowę', dzien: '2026-11-19' } });
  w = await komendy.obsluz({ agentka, tekst: 'na jutro wysłać umowę', stan: {}, ...opcje });
  assert.deepStrictEqual(w.noweZadanie, { dzien: '2026-11-19', tekst: 'Wysłać umowę' });

  // zaproszenie gości do wydarzenia
  let wyslaneWyd = null; const f0 = global.fetch;
  global.fetch = async (u, op) => { if (String(u).includes('calendars/primary/events') && op && op.method === 'POST') { wyslaneWyd = { u: String(u), b: JSON.parse(op.body) }; return { ok: true, status: 200, json: async () => ({ id: 'e1' }) }; } return f0(u, op); };
  claudeOdp = c => { assert.ok(c.system.includes('zanna@kramm.pl')); return { nazwa: 'kalendarz_dodaj', dane: { rodzaj: 'wydarzenie', tytul: 'Spotkanie', start: '2026-11-20T10:00', goscie: ['zanna@kramm.pl', 'jan.kowalski@gmail.com'] } }; };
  w = await komendy.obsluz({ agentka, tekst: 'spotkanie w piątek o 10 z Żanną i jan kropka kowalski małpa gmail', stan: {}, ...opcje });
  assert.ok(/Zaproszę: Żanna, jan.kowalski@gmail.com/.test(w.mow), w.mow);
  w = await komendy.obsluz({ agentka, tekst: 'tak', stan: { oczekujace: w.noweOczekujace }, ...opcje });
  assert.ok(wyslaneWyd.u.includes('sendUpdates=all') && wyslaneWyd.b.attendees.length === 2, JSON.stringify(wyslaneWyd));
  global.fetch = f0;

  // stopka z Gmaila w mailu HTML
  const raw3 = Buffer.from(g.zbudujMail({ do: 'a@b.pl', temat: 'T', tresc: 'Dzień dobry\nok', stopka: '<b>KRAMM Nieruchomości</b><br>tel. 570' }), 'base64url').toString();
  assert.ok(raw3.includes('multipart/alternative') && raw3.includes('text/html'));
  const czesci = raw3.split(/\r\n\r\n/).slice(1).map(c => { try { return Buffer.from(c.split('\r\n--')[0].replace(/\r\n/g, ''), 'base64').toString(); } catch (e) { return ''; } }).join(' ');
  assert.ok(czesci.includes('KRAMM Nieruchomości') && czesci.includes('<br>'));

  // arkusz z leadami: tylko nowe wiersze od ostatniego briefu
  const stareFetch = global.fetch;
  global.fetch = async (u, op) => {
    if (String(u).includes('spreadsheets/L1?fields')) return { ok: true, status: 200, json: async () => ({ properties: { title: 'Leady' }, sheets: [{ properties: { title: 'Leady' } }] }) };
    if (String(u).includes('spreadsheets/L1/values')) return { ok: true, status: 200, json: async () => ({ values: [['Data', 'Imię', 'Telefon'], ['1.11', 'Stary', '1'], ['17.11', 'Nowy Lead', '600']] }) };
    return stareFetch(u, op);
  };
  claudeOdp = c => { const d = JSON.parse(c.messages[0].content.split('\n').slice(1).join('\n'));
    assert.strictEqual(d.arkusze_pilnowane[0].nowe_wpisy_od_ostatniego_briefu, 1);
    return { nazwa: 'zapisz_brief', dane: { mowa: 'x', dzis: [], maile: [], kontakty: [], arkusze: [{ arkusz: 'Leady', kto: 'Nowy Lead', sprawa: 'oddzwonić', nowy: true }], jutro: [], punkty: [] } }; };
  const b2 = await brief.przygotuj({ ...agentka, arkusze: [{ id: 'L1', nazwa: 'Leady', wiersze: 1 }] }, opcje);
  assert.deepStrictEqual(b2.arkusze, [{ id: 'L1', nazwa: 'Leady', nowe: 1, wszystkie: 2 }]); assert.strictEqual(b2.stanArkuszy.L1, 2);
  global.fetch = stareFetch;
  console.log('Wszystkie testy przeszły.');
})().catch(e => { console.error(e); process.exit(1); });
