// Podgląd ostatniego briefu w Firestore: node narzedzia/pokaz-brief.js
const admin = require('../funkcje/node_modules/firebase-admin');
admin.initializeApp({ projectId: 'calm-metric-514918-h8' });
(async () => {
  const db = admin.firestore();
  for (const a of (await db.collection('agentki').get()).docs) {
    const d = a.data();
    console.log('AGENTKA', a.id, 'ostatniBrief', d.ostatniBrief, 'polaczenie', d.polaczenie, 'zakres', (d.zakres || '').split(' ').length);
    const x = await db.collection('agentki').doc(a.id).collection('briefy').doc(d.ostatniBrief).get();
    [x].filter(y => y.exists).forEach(x => { const v = x.data(); console.log(x.id, JSON.stringify({ liczbaMaili: v.liczbaMaili, maile: v.maile, kontakty: v.kontakty, braki: v.braki, blad: v.blad, czas: v.czas, klucze: Object.keys(v) }).slice(0, 1500)); });
    if (process.env.SEKRET) {
      const dane = await require('../funkcje/brief.js').zbierzDane({ ...d, email: d.email || a.id }, process.env.SEKRET.trim());
      console.log('DANE maile', (dane.maile || []).length, 'rozmowy', (dane.rozmowy || []).length, 'arkusz', dane.arkusz, 'braki', JSON.stringify(dane.braki));
      (dane.maile || []).slice(0, 8).forEach(m => console.log(' -', m.od, '|', m.temat, '| masowy', m.masowy));
      (dane.rozmowy || []).slice(-5).forEach(r => console.log(' R', JSON.stringify(r).slice(0, 160)));
    }
  }
})().catch(e => console.log('BLAD', e.message));
