import admin from 'firebase-admin';
admin.initializeApp({ projectId: "dummy-project-id" });
const db = admin.firestore();
async function run() {
  try {
    const snap = await db.collection('users').limit(1).get();
    console.log("Success fetching users:", snap.size);
  } catch(e) {
    console.error("Error fetching users:", e);
  }
}
run();
