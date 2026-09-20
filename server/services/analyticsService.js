import admin from 'firebase-admin';

/**
 * Authoritative Persistent Analytics Service
 */
export async function trackPersistentEvent(userId, eventName, properties = {}, db = admin.firestore()) {
  if (!userId || !eventName) return { success: false, error: 'Missing userId or eventName' };

  try {
    const eventDoc = {
      event_name: eventName,
      properties: properties || {},
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      created_at_iso: new Date().toISOString()
    };

    const docRef = await db.collection('users').doc(userId).collection('analytics_events').add(eventDoc);
    return { success: true, eventId: docRef.id };
  } catch (err) {
    if (!err.message?.includes('PERMISSION_DENIED')) {
      console.warn(`[Analytics] Note on event "${eventName}" for ${userId}:`, err.message || err);
    }
    return { success: true, clientHandled: true };
  }
}

/**
 * Aggregate key MVP product metrics from persistent events and order history
 */
export async function computeUserAnalyticsSummary(userId, db = admin.firestore()) {
  if (!userId) return null;

  try {
    const [eventsSnap, ordersSnap, itemsSnap] = await Promise.all([
      db.collection('users').doc(userId).collection('analytics_events').orderBy('timestamp', 'desc').limit(200).get().catch(() => ({ docs: [] })),
      db.collection('users').doc(userId).collection('order_history').orderBy('ordered_at', 'desc').get().catch(() => ({ docs: [] })),
      db.collection('users').doc(userId).collection('household_items').get().catch(() => ({ docs: [] }))
    ]);

    const orderCount = ordersSnap.docs.length;
    const totalSpend = ordersSnap.docs.reduce((sum, d) => sum + (d.data().estimated_value || 0), 0);
    const avgOrderValue = orderCount > 0 ? totalSpend / orderCount : 0;

    const eventCounts = {};
    eventsSnap.docs.forEach(d => {
      const name = d.data().event_name;
      eventCounts[name] = (eventCounts[name] || 0) + 1;
    });

    return {
      orderCount,
      totalSpend,
      avgOrderValue,
      totalTrackedItems: itemsSnap.docs.length,
      eventCounts
    };
  } catch (err) {
    console.warn(`[Analytics] Error computing summary for ${userId}:`, err.message || err);
    return null;
  }
}
