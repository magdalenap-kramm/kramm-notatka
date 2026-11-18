// Połączenia z Google (Kalendarz, Gmail, Dysk, Arkusze) na koncie agentki.
const czas = require('./czas');

const CLIENT_ID = '696449098485-ejg71rbdnanoqbm7rql7033stlmg7tfu.apps.googleusercontent.com';
const ZAKRESY = [
  'openid', 'email', 'profile',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/drive.metadata.readonly',
  'https://www.googleapis.com/auth/spreadsheets.readonly'
];

class BladPolaczenia extends Error { constructor(m) { super(m); this.kod = 'polacz'; } }

// wymiana kodu z logowania na tokeny (z odświeżającym)
async function wymienKod(kod, adresPowrotu, sekret) {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code: kod, client_id: CLIENT_ID, client_secret: sekret, redirect_uri: adresPowrotu, grant_type: 'authorization_code' })
  });
  const j = await r.json();
  if (!r.ok) throw new Error('Google: ' + (j.error_description || j.error || r.status));
  const dane = JSON.parse(Buffer.from(j.id_token.split('.')[1], 'base64url').toString());
  return { refresh: j.refresh_token || null, dostep: j.access_token, zakres: j.scope || '', email: (dane.email || '').toLowerCase(), weryfikacja: !!dane.email_verified,
    domena: dane.hd || '', imie: dane.given_name || (dane.name || '').split(' ')[0] || '', nazwa: dane.name || '', foto: dane.picture || '' };
}

const pamiec = new Map();   // email -> { token, do }
async function tokenDostepu(agentka, sekret) {
  const z = pamiec.get(agentka.email);
  if (z && Date.now() < z.do) return z.token;
  if (!agentka.refresh) throw new BladPolaczenia('Brak połączenia z Google');
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ refresh_token: agentka.refresh, client_id: CLIENT_ID, client_secret: sekret, grant_type: 'refresh_token' })
  });
  const j = await r.json();
  if (!r.ok) { if (j.error === 'invalid_grant') throw new BladPolaczenia('Połączenie z Google wygasło'); throw new Error('Google: ' + (j.error_description || j.error)); }
  pamiec.set(agentka.email, { token: j.access_token, do: Date.now() + ((j.expires_in || 3600) - 120) * 1000 });
  return j.access_token;
}

function klient(token) {
  return async function api(url, opcje = {}) {
    let r, j;
    for (let proba = 0; ; proba++) {
      r = await fetch(url, { ...opcje, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', ...(opcje.headers || {}) } });
      j = await r.json().catch(() => ({}));
      const limit = r.status === 429 || ((r.status === 403 || r.status === 503) && /quota|rate|limit/i.test(JSON.stringify(j)));
      if (!limit || proba >= 4) break;
      await new Promise(ok => setTimeout(ok, 1500 * 2 ** proba));   // limit Gmaila - odczekaj i ponów
    }
    if (r.status === 401) throw new BladPolaczenia('Google odrzucił dostęp');
    if (!r.ok) throw new Error((j.error && j.error.message) || ('Google ' + r.status));
    return j;
  };
}

// ---------- Kalendarz ----------
function uproscWydarzenie(e) {
  const start = e.start && (e.start.dateTime || e.start.date);
  return { id: e.id, tytul: e.summary || '(bez tytułu)', start, caly: !!(e.start && e.start.date && !e.start.dateTime),
    koniec: e.end && (e.end.dateTime || e.end.date), miejsce: e.location || '', opis: (e.description || '').slice(0, 400),
    goscie: (e.attendees || []).filter(a => !a.self).map(a => a.displayName || a.email).slice(0, 6) };
}
async function wydarzenia(api, odDnia, doDnia) {
  const q = new URLSearchParams({ timeMin: czas.poczatekDnia(odDnia), timeMax: czas.poczatekDnia(czas.dodajDni(doDnia, 1)),
    singleEvents: 'true', orderBy: 'startTime', maxResults: '60', timeZone: czas.STREFA });
  const j = await api('https://www.googleapis.com/calendar/v3/calendars/primary/events?' + q);
  return (j.items || []).filter(e => e.status !== 'cancelled').map(uproscWydarzenie);
}
// rodzaj: wydarzenie | przypomnienie | zadanie; start: 'YYYY-MM-DDTHH:MM' (czas warszawski)
async function dodajWydarzenie(api, { rodzaj, tytul, start, minut, miejsce, opis, goscie }) {
  const dl = minut || (rodzaj === 'wydarzenie' ? 60 : 15);
  const s = czas.lokalnyNaDate(start), k = new Date(s.getTime() + dl * 60000);
  const lok = d => `${czas.dzien(d)}T${czas.godzina(d)}:00`;
  const przed = rodzaj === 'wydarzenie' ? [{ method: 'popup', minutes: 30 }, { method: 'popup', minutes: 0 }] : [{ method: 'popup', minutes: 0 }];
  const prefiks = rodzaj === 'zadanie' ? 'Zadanie: ' : rodzaj === 'przypomnienie' ? 'Przypomnienie: ' : '';
  const lista = (goscie || []).map(x => String(x).trim().toLowerCase()).filter(x => /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(x));
  return api('https://www.googleapis.com/calendar/v3/calendars/primary/events' + (lista.length ? '?sendUpdates=all' : ''), { method: 'POST', body: JSON.stringify({
    ...(lista.length ? { attendees: lista.map(email => ({ email })) } : {}),
    summary: prefiks + tytul, location: miejsce || undefined, description: (opis ? opis + '\n\n' : '') + 'Dodane głosem w Asystentce KRAMM',
    start: { dateTime: lok(s), timeZone: czas.STREFA }, end: { dateTime: lok(k), timeZone: czas.STREFA },
    reminders: { useDefault: false, overrides: przed }
  }) });
}

// ---------- Gmail ----------
const naglowek = (m, n) => ((m.payload && m.payload.headers) || []).find(h => h.name.toLowerCase() === n.toLowerCase())?.value || '';
function adresEmail(t) { const m = String(t).match(/<([^>]+)>/); return (m ? m[1] : t).trim().toLowerCase(); }
function nazwaNadawcy(t) { const m = String(t).match(/^\s*"?([^"<]+?)"?\s*</); return m ? m[1].trim() : adresEmail(t); }

// wątki z ostatnich dni, na które agentka jeszcze nie odpisała
async function watkiDoOdpowiedzi(api, mojEmail, dni = 7, ile = 25) {
  const q = `in:inbox newer_than:${dni}d -category:promotions -category:social -category:forums -from:me`;
  const lista = await api('https://gmail.googleapis.com/gmail/v1/users/me/threads?' + new URLSearchParams({ q, maxResults: String(ile) }));
  const wynik = [];
  let pelnych = 0;
  const jeden = async (t, nr) => {
    const w = await api(`https://gmail.googleapis.com/gmail/v1/users/me/threads/${t.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date&metadataHeaders=List-Unsubscribe`);
    const msgs = w.messages || []; if (!msgs.length) return;
    const ost = msgs[msgs.length - 1];
    const od = naglowek(ost, 'From');
    if ((ost.labelIds || []).includes('SENT') || adresEmail(od) === mojEmail) return;      // już odpisała
    // końcówka treści (podpis) - pozwala ustalić, kto pisze, gdy w nagłówku jest tylko adres
    let podpis = '';
    const masowy = !!naglowek(ost, 'List-Unsubscribe');
    if (!masowy && pelnych++ < 12) try {
      const pelna = await api(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${ost.id}?format=full`);
      const tresc = bezCytatu(tekstCzesci(pelna.payload)).replace(/\n{2,}/g, '\n').trim();
      podpis = tresc.slice(-500);
    } catch (e) { /* bez podpisu */ }
    wynik[nr] = ({ watek: t.id, od: nazwaNadawcy(od), podpis, odEmail: adresEmail(od), temat: naglowek(ost, 'Subject') || '(bez tematu)',
      data: naglowek(ost, 'Date'), fragment: (ost.snippet || '').slice(0, 300), nieprzeczytany: (ost.labelIds || []).includes('UNREAD'),
      wazny: (ost.labelIds || []).includes('IMPORTANT'), masowy, wiadomosci: msgs.length });
  };
  const watki = lista.threads || [];
  for (let i = 0; i < watki.length; i += 4) await Promise.all(watki.slice(i, i + 4).map((t, j) => jeden(t, i + j)));   // po 4 naraz - szybciej, a w limicie Gmaila
  return wynik.filter(Boolean);
}
function tekstCzesci(p) {
  if (!p) return '';
  if (p.mimeType === 'text/plain' && p.body && p.body.data) return Buffer.from(p.body.data, 'base64url').toString('utf8');
  if (p.parts) { for (const c of p.parts) { const t = tekstCzesci(c); if (t) return t; } }
  if (p.mimeType === 'text/html' && p.body && p.body.data)
    return Buffer.from(p.body.data, 'base64url').toString('utf8').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
  return '';
}
// usuwa cytowaną historię ("W dniu ... napisał:" i linie z ">")
function bezCytatu(t) {
  const linie = String(t).replace(/\r/g, '').split('\n'); const out = [];
  for (const l of linie) { if (/^(W dniu|On .+wrote:|-----Original|Od: .+|From: .+)/.test(l.trim()) && out.length > 2) break; if (!l.startsWith('>')) out.push(l); }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
async function watek(api, id) {
  const w = await api(`https://gmail.googleapis.com/gmail/v1/users/me/threads/${id}?format=full`);
  const msgs = (w.messages || []).slice(-4).map(m => ({
    id: m.id, od: naglowek(m, 'From'), do: naglowek(m, 'To'), dw: naglowek(m, 'Cc'), temat: naglowek(m, 'Subject'), data: naglowek(m, 'Date'),
    idWiadomosci: naglowek(m, 'Message-ID') || naglowek(m, 'Message-Id'), referencje: naglowek(m, 'References'),
    wyslana: (m.labelIds || []).includes('SENT'), tekst: bezCytatu(tekstCzesci(m.payload)).slice(0, 3000)
  }));
  return { id, wiadomosci: msgs };
}
function zakodujNaglowek(t) { return /^[\x20-\x7e]*$/.test(t) ? t : '=?UTF-8?B?' + Buffer.from(t, 'utf8').toString('base64') + '?='; }
const escHtml = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const htmlNaTekst = h => String(h || '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|tr)>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\n{3,}/g, '\n\n').trim();
const b64linie = t => Buffer.from(t, 'utf8').toString('base64').replace(/.{76}/g, '$&\r\n');
// stopka = podpis ustawiony w Gmailu (HTML); dokładamy ją do maili wysyłanych przez asystentkę
function zbudujMail({ do: adresat, temat, tresc, odpowiedzNa, referencje, stopka }) {
  const linie = [`To: ${adresat}`, `Subject: ${zakodujNaglowek(temat)}`, 'MIME-Version: 1.0'];
  if (odpowiedzNa) { linie.push(`In-Reply-To: ${odpowiedzNa}`); linie.push(`References: ${[referencje, odpowiedzNa].filter(Boolean).join(' ')}`); }
  let cialo;
  if (stopka) {
    const g = 'kramm_' + Date.now().toString(36);
    const tekst = tresc + '\n\n' + htmlNaTekst(stopka);
    const html = `<div dir="ltr">${escHtml(tresc).replace(/\n/g, '<br>')}</div><br><div class="gmail_signature">${stopka}</div>`;
    linie.push(`Content-Type: multipart/alternative; boundary="${g}"`);
    cialo = [`--${g}`, 'Content-Type: text/plain; charset="UTF-8"', 'Content-Transfer-Encoding: base64', '', b64linie(tekst),
      `--${g}`, 'Content-Type: text/html; charset="UTF-8"', 'Content-Transfer-Encoding: base64', '', b64linie(html), `--${g}--`].join('\r\n');
  } else {
    linie.push('Content-Type: text/plain; charset="UTF-8"', 'Content-Transfer-Encoding: base64');
    cialo = b64linie(tresc);
  }
  return Buffer.from(linie.join('\r\n') + '\r\n\r\n' + cialo, 'utf8').toString('base64url');
}
async function stopkaGmail(api) {
  try {
    const j = await api('https://gmail.googleapis.com/gmail/v1/users/me/settings/sendAs');
    const a = (j.sendAs || []).find(x => x.isDefault) || (j.sendAs || []).find(x => x.isPrimary);
    return (a && a.signature) || '';
  } catch (e) { return ''; }
}
async function wyslijMail(api, szkic) {
  const stopka = await stopkaGmail(api);
  return api('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', { method: 'POST', body: JSON.stringify({ raw: zbudujMail({ ...szkic, stopka }), threadId: szkic.watek || undefined }) });
}

// ---------- Arkusze z leadami (wybrane przez agentkę) ----------
async function szukajArkuszy(api, fraza) {
  const f = String(fraza || '').replace(/'/g, "\\'").trim();
  const q = encodeURIComponent(`mimeType='application/vnd.google-apps.spreadsheet' and trashed=false${f ? ` and name contains '${f}'` : ''}`);
  const j = await api(`https://www.googleapis.com/drive/v3/files?q=${q}&orderBy=modifiedTime desc&pageSize=10&includeItemsFromAllDrives=true&supportsAllDrives=true&corpora=allDrives&fields=files(id,name,modifiedTime)`);
  return (j.files || []).map(x => ({ id: x.id, nazwa: x.name, zmieniony: x.modifiedTime }));
}
async function odczytajArkusz(api, id) {
  const meta = await api(`https://sheets.googleapis.com/v4/spreadsheets/${id}?fields=properties.title,sheets.properties.title`);
  const zakladka = meta.sheets && meta.sheets[0] ? meta.sheets[0].properties.title : 'Arkusz1';
  const j = await api(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${encodeURIComponent(`'${zakladka}'!A1:Z`)}`);
  const w = j.values || [];
  return { nazwa: meta.properties.title, naglowek: w[0] || [], wiersze: w.slice(1).filter(r => r.some(c => String(c).trim())) };
}

// ---------- Arkusz z Notatki KRAMM ("Rozmowy - imię") ----------
async function arkuszNotatki(api, znaneId) {
  if (znaneId) return znaneId;
  const q = encodeURIComponent("name contains 'Rozmowy - ' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false");
  const l = await api(`https://www.googleapis.com/drive/v3/files?q=${q}&orderBy=createdTime desc&fields=files(id,name)`);
  return l.files && l.files.length ? l.files[0].id : null;
}
// ostatnie rozmowy (najnowsze na końcu)
async function rozmowy(api, idArkusza, ile = 40) {
  if (!idArkusza) return [];
  const j = await api(`https://sheets.googleapis.com/v4/spreadsheets/${idArkusza}/values/Rozmowy!A2:I`);
  const nag = ['data', 'godzina', 'numer', 'kto', 'sprawa', 'akcja', 'tytul', 'termin', 'status'];
  return (j.values || []).slice(-ile).map(w => Object.fromEntries(nag.map((n, i) => [n, (w[i] || '').toString().replace(/^'/, '')])));
}

module.exports = { CLIENT_ID, ZAKRESY, BladPolaczenia, wymienKod, tokenDostepu, klient, wydarzenia, dodajWydarzenie,
  watkiDoOdpowiedzi, watek, wyslijMail, zbudujMail, stopkaGmail, szukajArkuszy, odczytajArkusz, arkuszNotatki, rozmowy, adresEmail, nazwaNadawcy, bezCytatu };
