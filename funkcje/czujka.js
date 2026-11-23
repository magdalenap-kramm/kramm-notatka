// Czujka w ciągu dnia: pilne maile i nowe leady w pilnowanych arkuszach -> powiadomienie na telefon
const g = require('./google');
const claude = require('./claude');

const OCENA = { name: 'ocena', description: 'Ocena, czy mail wymaga szybkiej reakcji agentki nieruchomości.',
  input_schema: { type: 'object', properties: {
    pilny: { type: 'boolean', description: 'true tylko gdy klient, właściciel, najemca, kupujący, notariusz, bank albo współpracownik czeka na odpowiedź lub działanie dziś: pytanie o ofertę, oględziny, termin, umowa, awaria, reklamacja, pilna prośba. Newslettery, powiadomienia systemowe, faktury automatyczne, reklamy = false' },
    powod: { type: 'string', description: 'kilka słów po polsku, czego dotyczy, np. "pyta o oglądanie mieszkania jutro"' }
  }, required: ['pilny', 'powod'] } };

// nowe wątki w skrzynce od ostatniego sprawdzenia, ocenione przez Claude
async function pilneMaile({ api, agentka, znane, klucz }) {
  const p = new URLSearchParams({ maxResults: '15' }); p.append('labelIds', 'INBOX');
  const lista = await api('https://gmail.googleapis.com/gmail/v1/users/me/threads?' + p);
  const watki = (lista.threads || []).map(t => t.id);
  if (!znane) return { znane: watki, pilne: [] };                 // pierwsze uruchomienie: tylko zapamiętaj
  const nowe = watki.filter(id => !znane.includes(id)).slice(0, 6);
  const pilne = [];
  for (const id of nowe) {
    const w = await api(`https://gmail.googleapis.com/gmail/v1/users/me/threads/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=List-Unsubscribe`);
    const ost = (w.messages || []).slice(-1)[0]; if (!ost) continue;
    const etyk = ost.labelIds || [];
    const od = g.naglowek(ost, 'From');
    if (etyk.includes('SENT') || g.adresEmail(od) === agentka.email) continue;
    if (etyk.some(l => ['CATEGORY_PROMOTIONS', 'CATEGORY_SOCIAL', 'CATEGORY_FORUMS', 'CATEGORY_UPDATES', 'SPAM'].includes(l))) continue;
    if (g.naglowek(ost, 'List-Unsubscribe') || /no-?reply|noreply|powiadomienia@|notifications?@/i.test(od)) continue;
    const temat = g.naglowek(ost, 'Subject');
    try {
      const odp = await claude.zapytaj({ klucz, model: claude.MODEL_KOMENDY, maxTokenow: 300, narzedzia: [OCENA], wymusNarzedzie: 'ocena',
        system: 'Oceniasz maile agentki biura nieruchomości KRAMM w Poznaniu.',
        wiadomosci: [{ role: 'user', content: `Od: ${od}\nTemat: ${temat}\nFragment: ${ost.snippet || ''}` }] });
      const o = claude.narzedzie(odp);
      if (o && o.dane.pilny) pilne.push({ id, od: g.nazwaNadawcy ? g.nazwaNadawcy(od) : od, temat, powod: o.dane.powod });
    } catch (e) { /* brak oceny - pomijamy */ }
  }
  return { znane: [...new Set([...nowe, ...watki])].slice(0, 60), pilne };
}

// nowe wiersze w arkuszach pilnowanych przez agentkę
async function noweLeady({ api, arkusze, stan }) {
  const wynik = [], nowyStan = { ...(stan || {}) };
  for (const a of (arkusze || []).slice(0, 5)) {
    try {
      const r = await g.odczytajArkusz(api, a.id);
      const ile = r.wiersze.length;
      if (typeof nowyStan[a.id] === 'number' && ile > nowyStan[a.id]) {
        const nowe = r.wiersze.slice(nowyStan[a.id]);
        wynik.push({ arkusz: r.nazwa || a.nazwa, ile: nowe.length, opis: nowe.slice(-1)[0].filter(c => String(c).trim()).slice(0, 3).join(' · ').slice(0, 90) });
      }
      nowyStan[a.id] = ile;
    } catch (e) { if (e.kod) throw e; }
  }
  return { wynik, stan: nowyStan };
}

module.exports = { pilneMaile, noweLeady };
