import admin from 'firebase-admin';
import fs from 'fs';
const firebaseConfig = JSON.parse(fs.readFileSync('firebase-applet-config.json', 'utf8'));
admin.initializeApp({ projectId: firebaseConfig.projectId });
const db = admin.firestore();
async function test() {
  try {
    await db.collection('users').doc('user1').collection('household_items').get();
    console.log('Items OK');
    await db.collection('users').doc('user1').collection('recommendation_stats').get();
    console.log('Stats OK');
    await db.collection('users').doc('user1').collection('recommendation_stats').doc('item1').set({ shown: admin.firestore.FieldValue.increment(1) }, { merge: true });
    console.log('Set OK');
  } catch (e) {
    console.error('Error:', e);
  }
}
test();
