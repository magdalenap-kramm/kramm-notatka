// Podgląd ostatniego briefu w Firestore: node narzedzia/pokaz-brief.js
const admin = require('../funkcje/node_modules/firebase-admin');
admin.initializeApp({ projectId: 'calm-metric-514918-h8' });
(async () => {
  const db = admin.firestore();
  for (const a of (await db.collection('agentki').get()).docs) {
    const d = a.data();
    console.log('AGENTKA', a.id, 'ostatniBrief', d.ostatniBrief, 'polaczenie', d.polaczenie, 'zakres', (d.zakres || '').split(' ').length);
    const b = await db.collection('agentki').doc(a.id).collection('briefy').orderBy(admin.firestore.FieldPath.documentId(), 'desc').limit(1).get();
    b.forEach(x => { const v = x.data(); console.log(x.id, JSON.stringify({ liczbaMaili: v.liczbaMaili, maile: v.maile, kontakty: v.kontakty, braki: v.braki, blad: v.blad, czas: v.czas, klucze: Object.keys(v) }).slice(0, 1500)); });
  }
})().catch(e => console.log('BLAD', e.message));
