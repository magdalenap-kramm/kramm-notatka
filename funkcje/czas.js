// Czas w strefie Europe/Warsaw (serwer działa w UTC).
const STREFA = 'Europe/Warsaw';

function czesci(d = new Date()) {
  const p = {};
  new Intl.DateTimeFormat('en-GB', { timeZone: STREFA, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short' })
    .formatToParts(d).forEach(x => { p[x.type] = x.value; });
  if (p.hour === '24') p.hour = '00';
  return p;
}
// '2026-11-18'
function dzien(d = new Date()) { const p = czesci(d); return `${p.year}-${p.month}-${p.day}`; }
// '07:35'
function godzina(d = new Date()) { const p = czesci(d); return `${p.hour}:${p.minute}`; }
// przesunięcie strefy, np. '+01:00'
function przesuniecie(d = new Date()) {
  const s = d.toLocaleString('en-US', { timeZone: STREFA, timeZoneName: 'longOffset' });
  const m = s.match(/GMT([+-]\d{2}:\d{2})/);
  return m ? m[1] : '+00:00';
}
// początek dnia (dataTekst 'YYYY-MM-DD') jako RFC3339 z przesunięciem
function poczatekDnia(dataTekst) {
  const poludnie = new Date(dataTekst + 'T12:00:00Z');
  return `${dataTekst}T00:00:00${przesuniecie(poludnie)}`;
}
function dodajDni(dataTekst, n) {
  const d = new Date(dataTekst + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function czyWeekend(d = new Date()) { const w = czesci(d).weekday; return w === 'Sat' || w === 'Sun'; }
// zaokrąglenie godziny do 5 minut w dół: '07:37' -> '07:35'
function doPieciu(hhmm) {
  const m = String(hhmm || '').match(/^(\d{1,2}):(\d{2})/); if (!m) return null;
  const h = Math.min(23, +m[1]), mi = Math.floor(Math.min(59, +m[2]) / 5) * 5;
  return `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
}
// 'piątek 21 listopada o 11:00' (lokalny tekst 'YYYY-MM-DDTHH:MM' albo Date)
function mowionaData(x, zGodzina = true) {
  const d = typeof x === 'string' ? lokalnyNaDate(x) : x;
  const t = new Intl.DateTimeFormat('pl-PL', { timeZone: STREFA, weekday: 'long', day: 'numeric', month: 'long' }).format(d);
  const dzis = dzien(), ten = dzien(d);
  let opis = t;
  if (ten === dzis) opis = 'dziś';
  else if (ten === dodajDni(dzis, 1)) opis = 'jutro';
  else if (ten === dodajDni(dzis, 2)) opis = 'pojutrze, ' + t;
  return zGodzina ? `${opis} o ${godzina(d)}` : opis;
}
// lokalny czas warszawski 'YYYY-MM-DDTHH:MM' -> Date
function lokalnyNaDate(t) {
  const s = String(t).slice(0, 16);
  return new Date(`${s}:00${przesuniecie(new Date(s.slice(0, 10) + 'T12:00:00Z'))}`);
}
// opis "teraz" dla modelu
function terazOpis(d = new Date()) {
  const dz = new Intl.DateTimeFormat('pl-PL', { timeZone: STREFA, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(d);
  return `${dz}, godzina ${godzina(d)} (${dzien(d)}, strefa Europe/Warsaw)`;
}

module.exports = { STREFA, czesci, dzien, godzina, przesuniecie, poczatekDnia, dodajDni, czyWeekend, doPieciu, mowionaData, lokalnyNaDate, terazOpis };
