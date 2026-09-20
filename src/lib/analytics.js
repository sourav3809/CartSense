import { db, auth } from './firebase';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';

/**
 * Persistent Analytics client for CartSense
 */
export const trackEvent = async (eventName, params = {}) => {
  const userId = auth.currentUser?.uid || localStorage.getItem('userId');
  console.log(`[Analytics] Event: "${eventName}"`, params);

  if (userId) {
    if (auth.currentUser) {
      try {
        await addDoc(collection(db, 'users', userId, 'analytics_events'), {
          event_name: eventName,
          properties: params || {},
          timestamp: serverTimestamp(),
          created_at_iso: new Date().toISOString()
        });
      } catch (e) {
        // graceful fallback
      }
    }

    fetch(`/api/users/${userId}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventName,
        properties: params
      })
    }).catch(err => {
      console.debug('[Analytics] Server event log:', err?.message || err);
    });
  }
};
