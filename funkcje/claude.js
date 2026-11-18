// Wywołania Claude (API Anthropic).
const MODEL_TEKSTY = 'claude-sonnet-5-5';   // brief i odpowiedzi na maile
const MODEL_KOMENDY = 'claude-haiku-5-5';   // szybkie rozpoznanie polecenia głosowego

async function wyslij(klucz, cialo) {
  let ost;
  for (let proba = 0; proba < 3; proba++) {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', headers: { 'x-api-key': klucz, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: JSON.stringify(cialo)
    });
    const j = await r.json().catch(() => ({}));
    if (r.ok) return j;
    ost = new Error('Claude: ' + ((j.error && j.error.message) || r.status));
    if (![429, 500, 529].includes(r.status)) break;
    await new Promise(z => setTimeout(z, 1500 * (proba + 1)));
  }
  throw ost;
}
// Model nie przyjmuje wymuszonego tool_choice, więc prosimy o narzędzie w treści
// i w razie potrzeby ponawiamy raz z przypomnieniem.
async function zapytaj({ klucz, model, system, wiadomosci, narzedzia, wymusNarzedzie, maxTokenow = 2000 }) {
  const sys = wymusNarzedzie ? `${system}\n\nOdpowiedz wyłącznie wywołaniem narzędzia "${wymusNarzedzie}".`
    : narzedzia ? `${system}\n\nZawsze odpowiadaj wywołaniem jednego z narzędzi.` : system;
  const cialo = { model, max_tokens: maxTokenow, system: sys, messages: wiadomosci };
  if (narzedzia) cialo.tools = narzedzia;
  let j = await wyslij(klucz, cialo);
  const ok = x => (x.content || []).some(c => c.type === 'tool_use' && (!wymusNarzedzie || c.name === wymusNarzedzie));
  if (wymusNarzedzie && !ok(j)) {
    j = await wyslij(klucz, { ...cialo, messages: [...wiadomosci, { role: 'assistant', content: tekst(j) || '...' },
      { role: 'user', content: `Użyj teraz narzędzia "${wymusNarzedzie}".` }] });
  }
  return j;
}
// pierwsze wywołanie narzędzia z odpowiedzi: { nazwa, dane }
function narzedzie(odp) {
  const b = (odp.content || []).find(c => c.type === 'tool_use');
  return b ? { nazwa: b.name, dane: b.input || {} } : null;
}
function tekst(odp) { return (odp.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n').trim(); }

module.exports = { MODEL_TEKSTY, MODEL_KOMENDY, zapytaj, narzedzie, tekst };
