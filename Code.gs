/**
 * KRAMM - Notatka po rozmowie
 * Skrypt podpięty do arkusza Google jednej agentki.
 * Odbiera wpis z aplikacji i dopisuje wiersz; dla alertu/zadania tworzy wydarzenie z przypomnieniem w Kalendarzu Google.
 *
 * Instalacja (raz na agentkę):
 * 1. Arkusz Google -> Rozszerzenia -> Apps Script -> wklej ten plik.
 * 2. Wdróż -> Nowe wdrożenie -> typ: Aplikacja internetowa
 *    Wykonaj jako: Ja | Kto ma dostęp: Każdy -> Wdróż -> zezwól na dostęp.
 * 3. Skopiuj adres URL wdrożenia i wklej go w aplikacji (Ustawienia).
 */

const ARKUSZ = 'Rozmowy';
const NAGLOWKI = ['Data', 'Godzina', 'Numer telefonu', 'Kto dzwonił', 'Sprawa', 'Akcja', 'Termin', 'Status'];
const SEKRET = ''; // opcjonalnie: wpisz hasło i to samo w aplikacji

function doPost(e) {
  try {
    const d = JSON.parse(e.postData.contents);
    if (SEKRET && d.sekret !== SEKRET) return odp({ ok: false, blad: 'Złe hasło' });

    const sh = arkusz_();
    const teraz = d.czas ? new Date(d.czas) : new Date();
    const tz = Session.getScriptTimeZone();
    const termin = d.termin ? new Date(d.termin) : null;
    const akcja = d.akcja || 'brak';

    let status = '';
    if (akcja !== 'brak' && termin) {
      const tytul = (akcja === 'alert' ? 'Oddzwonić: ' : 'Zadanie: ') + (d.kto || d.numer || '') + ' - ' + (d.sprawa || '');
      const opis = 'Numer: ' + (d.numer || '-') + '\nKto: ' + (d.kto || '-') + '\nSprawa: ' + (d.sprawa || '-');
      const ev = CalendarApp.getDefaultCalendar().createEvent(tytul, termin, new Date(termin.getTime() + 15 * 60000), { description: opis });
      ev.removeAllReminders();
      ev.addPopupReminder(10);
      ev.addPopupReminder(0);
      status = 'W kalendarzu';
    }

    sh.appendRow([
      Utilities.formatDate(teraz, tz, 'yyyy-MM-dd'),
      Utilities.formatDate(teraz, tz, 'HH:mm'),
      "'" + (d.numer || ''),
      d.kto || '',
      d.sprawa || '',
      akcja,
      termin ? Utilities.formatDate(termin, tz, 'yyyy-MM-dd HH:mm') : '',
      status
    ]);
    return odp({ ok: true });
  } catch (err) {
    return odp({ ok: false, blad: String(err) });
  }
}

function doGet() {
  return odp({ ok: true, info: 'KRAMM notatka po rozmowie - działa' });
}

function arkusz_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(ARKUSZ);
  if (!sh) {
    sh = ss.insertSheet(ARKUSZ);
    sh.appendRow(NAGLOWKI);
    sh.getRange(1, 1, 1, NAGLOWKI.length).setFontWeight('bold').setBackground('#2e3192').setFontColor('#ffffff');
    sh.setFrozenRows(1);
    sh.setColumnWidths(1, NAGLOWKI.length, 140);
    sh.setColumnWidth(5, 320);
  }
  return sh;
}

function odp(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
