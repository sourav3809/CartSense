import fs from 'fs';
import admin from 'firebase-admin';
const firebaseConfig = JSON.parse(fs.readFileSync('firebase-applet-config.json', 'utf8'));
admin.initializeApp({ projectId: firebaseConfig.projectId });
const db = admin.firestore();
async function run() {
  try {
    console.log("Checking project:", firebaseConfig.projectId);
    const snap = await db.collection('users').doc('12345').collection('household_items').get();
    console.log("Success! Docs:", snap.size);
  } catch(e) {
    console.error("Error:", e.message);
  }
}
run();
