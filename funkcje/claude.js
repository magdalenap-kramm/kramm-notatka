// Wywołania Claude (API Anthropic).
const MODEL_TEKSTY = 'claude-sonnet-5-5';   // brief i odpowiedzi na maile
const MODEL_KOMENDY = 'claude-haiku-5-5';   // szybkie rozpoznanie polecenia głosowego

async function zapytaj({ klucz, model, system, wiadomosci, narzedzia, wymusNarzedzie, maxTokenow = 2000 }) {
  const cialo = { model, max_tokens: maxTokenow, system, messages: wiadomosci };
  if (narzedzia) cialo.tools = narzedzia;
  if (wymusNarzedzie) cialo.tool_choice = { type: 'tool', name: wymusNarzedzie };
  else if (narzedzia) cialo.tool_choice = { type: 'any' };
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
// pierwsze wywołanie narzędzia z odpowiedzi: { nazwa, dane }
function narzedzie(odp) {
  const b = (odp.content || []).find(c => c.type === 'tool_use');
  return b ? { nazwa: b.name, dane: b.input || {} } : null;
}
function tekst(odp) { return (odp.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n').trim(); }

module.exports = { MODEL_TEKSTY, MODEL_KOMENDY, zapytaj, narzedzie, tekst };
