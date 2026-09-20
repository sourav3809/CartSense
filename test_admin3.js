import fs from 'fs';
import dotenv from 'dotenv';
dotenv.config();
import admin from 'firebase-admin';
const firebaseConfig = JSON.parse(fs.readFileSync('firebase-applet-config.json', 'utf8'));

if (process.env.FIREBASE_PRIVATE_KEY) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    }),
  });
  console.log('Init with cert');
} else {
  admin.initializeApp({ projectId: firebaseConfig.projectId });
  console.log('Init with default');
}

const db = admin.firestore();
async function run() {
  try {
    const snap = await db.collection('users').limit(1).get();
    console.log("Success! Docs:", snap.size);
  } catch(e) {
    console.error("Error:", e.message);
  }
}
run();
