import admin from 'firebase-admin';
admin.initializeApp();
const db = admin.firestore();
async function test() {
  try {
    const snap = await db.collection('users').limit(1).get();
    console.log('Users:', snap.size);
  } catch (e) {
    console.error('Error:', e);
  }
}
test();
