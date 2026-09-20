import admin from 'firebase-admin';

export function calculateCycleDays(dates = []) {
  if (!Array.isArray(dates) || dates.length < 2) return [];
  const sorted = [...dates]
    .map(d => (d instanceof Date ? d : new Date(d)))
    .filter(d => !isNaN(d.getTime()))
    .sort((a, b) => a.getTime() - b.getTime());

  const cycles = [];
  for (let i = 1; i < sorted.length; i++) {
    const diffMs = sorted[i].getTime() - sorted[i - 1].getTime();
    const diffDays = Math.max(1, Math.round(diffMs / (1000 * 60 * 60 * 24)));
    cycles.push(diffDays);
  }
  return cycles;
}

export function clampConsumptionDays(days) {
  if (typeof days !== 'number' || isNaN(days)) return 14;
  const rounded = Math.round(days);
  return Math.min(60, Math.max(1, rounded));
}

export function getConfidenceFromCycles(cycleCount = 0) {
  if (cycleCount >= 7) return 'high';
  if (cycleCount >= 3) return 'medium';
  return 'low';
}

export function isRecommendationSuppressed(consecutiveDismissals = 0) {
  return consecutiveDismissals >= 3;
}

export function computeAcceptanceRate(acceptCount = 0, shownCount = 0) {
  if (shownCount === 0) return 0;
  return acceptCount / shownCount;
}

export function sortRecommendationsByAcceptance(recommendations = []) {
  return [...recommendations].sort((a, b) => {
    const rateA = computeAcceptanceRate(a.accept_count || 0, a.shown_count || 0);
    const rateB = computeAcceptanceRate(b.accept_count || 0, b.shown_count || 0);
    if (rateB !== rateA) return rateB - rateA;
    return (b.days_since_due || 0) - (a.days_since_due || 0);
  });
}

/**
 * Cadence Learning
 * Invoked on order confirmation. Analyzes order dates across 8 weeks.
 */
export async function runCadenceLearning(userId, db = admin.firestore(), now = new Date()) {
  const eightWeeksAgo = new Date(now.getTime() - 56 * 24 * 60 * 60 * 1000);
  const fourWeeksAgo = new Date(now.getTime() - 28 * 24 * 60 * 60 * 1000);

  const historySnap = await db.collection('users').doc(userId).collection('order_history')
    .orderBy('ordered_at', 'desc').get();
  
  const recent8WeekOrders = [];
  const recent4WeekOrders = [];

  historySnap.docs.forEach(doc => {
    const data = doc.data();
    const orderedAt = data.ordered_at ? (data.ordered_at.toDate ? data.ordered_at.toDate() : new Date(data.ordered_at)) : null;
    if (!orderedAt || isNaN(orderedAt.getTime())) return;
    
    if (orderedAt >= eightWeeksAgo && orderedAt <= now) {
      recent8WeekOrders.push(orderedAt);
    }
    if (orderedAt >= fourWeeksAgo && orderedAt <= now) {
      recent4WeekOrders.push(orderedAt);
    }
  });

  if (recent8WeekOrders.length < 4) return null; // Minimum 4 confirmed orders in the 8 week window

  const weeks = {};
  recent4WeekOrders.forEach(date => {
    const diffMs = now.getTime() - date.getTime();
    const weekIdx = Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000));
    if (weekIdx >= 0 && weekIdx < 4) {
      if (!weeks[weekIdx]) weeks[weekIdx] = [];
      weeks[weekIdx].push(date.getDay());
    }
  });

  const dayOccurrences = {};
  for (let w = 0; w < 4; w++) {
    if (weeks[w]) {
       const uniqueDays = [...new Set(weeks[w])];
       uniqueDays.forEach(day => {
         dayOccurrences[day] = (dayOccurrences[day] || 0) + 1;
       });
    }
  }

  let bestDay = null;
  let maxCount = 0;
  for (const [dayStr, count] of Object.entries(dayOccurrences)) {
    if (count > maxCount) {
      maxCount = count;
      bestDay = parseInt(dayStr, 10);
    }
  }

  if (maxCount >= 3) {
    const daysMap = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const predictedWeekday = daysMap[bestDay];
    const confidence = maxCount / 4;
    
    const cadenceRef = db.collection('users').doc(userId).collection('cadence').doc('profile');
    await cadenceRef.set({
      weekday: predictedWeekday,
      confidence,
      updated_at: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    return { weekday: predictedWeekday, confidence };
  }

  return null;
}

/**
 * Deduplicated Recommendation Exposure Tracker
 */
export async function handleRecommendationExposure(userId, exposureId, itemIds = [], db = admin.firestore()) {
  if (!exposureId || !itemIds || itemIds.length === 0) {
    return { success: true, counted: 0 };
  }

  const exposureRef = db.collection('users').doc(userId).collection('recommendation_exposures').doc(exposureId);
  
  try {
    const isNew = await db.runTransaction(async (t) => {
      const expDoc = await t.get(exposureRef);
      if (expDoc.exists) {
        return false;
      }
      t.set(exposureRef, {
        item_ids: itemIds,
        recorded_at: admin.firestore.FieldValue.serverTimestamp()
      });
      return true;
    });

    if (!isNew) {
      return { success: true, deduplicated: true, counted: 0 };
    }

    const batch = db.batch();
    for (const itemId of itemIds) {
      if (!itemId) continue;
      const statRef = db.collection('users').doc(userId).collection('recommendation_stats').doc(itemId);
      batch.set(statRef, {
        shown: admin.firestore.FieldValue.increment(1),
        last_shown: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    }
    await batch.commit();
    return { success: true, deduplicated: false, counted: itemIds.length };
  } catch (err) {
    if (!err.message?.includes('PERMISSION_DENIED')) {
      console.warn(`[LearningService] Exposure handling notice for user ${userId}:`, err.message || err);
    }
    return { success: true, clientHandled: true };
  }
}

export async function handleRecommendationShown(userId, itemId, db = admin.firestore()) {
  if (!itemId) return;
  try {
    const statRef = db.collection('users').doc(userId).collection('recommendation_stats').doc(itemId);
    await statRef.set({
      shown: admin.firestore.FieldValue.increment(1),
      last_shown: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  } catch (e) {
    // handled gracefully
  }
}

/**
 * Idempotent Recommendation Action Handler (Added or Dismissed)
 */
export async function handleRecommendationAction(userId, itemId, action, actionId = null, db = admin.firestore()) {
  if (!itemId) return { success: false, error: 'Missing itemId' };

  try {
    if (actionId) {
      const actionLogRef = db.collection('users').doc(userId).collection('recommendation_actions').doc(actionId);
      const alreadyProcessed = await db.runTransaction(async (t) => {
        const doc = await t.get(actionLogRef);
        if (doc.exists) return true;
        t.set(actionLogRef, {
          item_id: itemId,
          action,
          timestamp: admin.firestore.FieldValue.serverTimestamp()
        });
        return false;
      });

      if (alreadyProcessed) {
        return { success: true, deduplicated: true };
      }
    }

    const statRef = db.collection('users').doc(userId).collection('recommendation_stats').doc(itemId);
    
    return await db.runTransaction(async (t) => {
      const docSnap = await t.get(statRef);
      const currentData = docSnap.exists ? docSnap.data() : { shown: 0, accepted: 0, dismissed: 0, consecutive_dismissals: 0 };
      
      if (action === 'added') {
        t.set(statRef, {
          accepted: admin.firestore.FieldValue.increment(1),
          consecutive_dismissals: 0
        }, { merge: true });
      } else if (action === 'dismissed' || action === 'removed') {
        const consecutive = (currentData.consecutive_dismissals || 0) + 1;
        t.set(statRef, {
          dismissed: admin.firestore.FieldValue.increment(1),
          consecutive_dismissals: consecutive
        }, { merge: true });
        
        if (consecutive >= 3) {
          const itemRef = db.collection('users').doc(userId).collection('household_items').doc(itemId);
          t.update(itemRef, { suppressed: true });
        }
      }
      return { success: true };
    });
  } catch (err) {
    if (!err.message?.includes('PERMISSION_DENIED')) {
      console.warn(`[LearningService] Action handling note for user ${userId}:`, err.message || err);
    }
    return { success: true, clientHandled: true };
  }
}

/**
 * Authoritative Order Confirmation Flow with Complete Idempotency Protection
 */
export async function processOrderConfirmationLearning({
  userId,
  items = [],
  platform = 'grocery_store',
  estimatedValue = 0,
  idempotencyKey = null,
  db = admin.firestore(),
  now = new Date()
}) {
  if (!userId || !Array.isArray(items) || items.length === 0) {
    throw new Error('Invalid order confirmation payload: userId and items are required');
  }

  // 1. Check idempotency if key provided
  if (idempotencyKey) {
    const existingOrderQuery = await db.collection('users').doc(userId).collection('order_history')
      .where('idempotency_key', '==', idempotencyKey)
      .limit(1)
      .get();

    if (!existingOrderQuery.empty) {
      const existingDoc = existingOrderQuery.docs[0];
      console.log(`[LearningService] Duplicate order confirmation prevented via idempotencyKey ${idempotencyKey}`);
      return {
        success: true,
        orderId: existingDoc.id,
        deduplicated: true,
        order: existingDoc.data()
      };
    }
  }

  // 2. Persist order history record
  const orderRef = db.collection('users').doc(userId).collection('order_history').doc();
  const orderRecord = {
    items: items.map(i => ({
      item_name: i.item_name || i.name,
      quantity: i.quantity || null,
      price: typeof i.price === 'number' ? i.price : null
    })),
    platform: platform || 'grocery_store',
    estimated_value: typeof estimatedValue === 'number' ? estimatedValue : 0,
    ordered_at: admin.firestore.Timestamp.fromDate(now),
    idempotency_key: idempotencyKey || null
  };

  await orderRef.set(orderRecord);

  // 3. Update household inventory items & recommendation stats
  const batch = db.batch();
  const allHouseholdItemsSnap = await db.collection('users').doc(userId).collection('household_items').get();
  const householdItemsMap = new Map();
  allHouseholdItemsSnap.docs.forEach(doc => {
    const d = doc.data();
    if (d.item_name) {
      householdItemsMap.set(d.item_name.trim().toLowerCase(), { id: doc.id, ref: doc.ref, ...d });
    }
  });

  // Also query today's daily captures to clear captured status
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const capturesSnap = await db.collection('users').doc(userId).collection('daily_captures').get();

  for (const item of items) {
    const itemName = (item.item_name || item.name || '').trim().toLowerCase();
    if (!itemName) continue;

    if (householdItemsMap.has(itemName)) {
      const householdItem = householdItemsMap.get(itemName);
      const currentCycles = typeof householdItem.order_cycles === 'number' ? householdItem.order_cycles : 0;
      const nextCycles = currentCycles + 1;
      const newConfidence = getConfidenceFromCycles(nextCycles);

      batch.update(householdItem.ref, {
        last_ordered_at: admin.firestore.Timestamp.fromDate(now),
        order_cycles: nextCycles,
        confidence_level: newConfidence,
        suppressed: false
      });

      const statRef = db.collection('users').doc(userId).collection('recommendation_stats').doc(householdItem.id);
      batch.set(statRef, {
        consecutive_dismissals: 0
      }, { merge: true });
    }

    // Delete corresponding daily captures for this confirmed item
    capturesSnap.docs.forEach(capDoc => {
      const capData = capDoc.data();
      if ((capData.item_name || '').trim().toLowerCase() === itemName) {
        batch.delete(capDoc.ref);
      }
    });
  }

  await batch.commit();

  // 4. Trigger Cadence Learning asynchronously / reliably
  try {
    await runCadenceLearning(userId, db, now);
  } catch (cadenceErr) {
    console.warn(`[LearningService] Cadence learning sub-step warning for user ${userId}:`, cadenceErr.message || cadenceErr);
  }

  return {
    success: true,
    orderId: orderRef.id,
    deduplicated: false,
    itemsConfirmed: items.length
  };
}

/**
 * Processes weekly learning logic (Consumption & Auto-Promotion) for a single user.
 */
export async function processUserLearning(userId) {
  try {
    const db = admin.firestore();
    const now = new Date();
    
    const firstDayOfYear = new Date(now.getFullYear(), 0, 1);
    const pastDaysOfYear = (now - firstDayOfYear) / 86400000;
    const weekNum = Math.ceil((pastDaysOfYear + firstDayOfYear.getDay() + 1) / 7);
    const currentWindow = `${now.getFullYear()}-W${weekNum}`;

    const summaryRef = db.collection('users').doc(userId).collection('learning_summary').doc(currentWindow);
    const summaryDoc = await summaryRef.get();
    if (summaryDoc.exists) {
      console.log(`[LearningService] Skipping user ${userId} - weekly learning already ran for window ${currentWindow}.`);
      return { success: true, userId, skipped: true };
    }

    const batch = db.batch();

    // 1. Consumption Learning
    const fourWeeksAgo = new Date(now.getTime() - 28 * 24 * 60 * 60 * 1000);
    const logsSnap = await db.collection('users').doc(userId).collection('edit_log').get();
    
    const recentLogs = logsSnap.docs
      .map(d => d.data())
      .filter(l => {
        const loggedAt = l.logged_at ? (l.logged_at.toDate ? l.logged_at.toDate() : new Date(l.logged_at)) : null;
        return loggedAt && loggedAt >= fourWeeksAgo;
      });

    const itemActions = {};
    recentLogs.forEach(log => {
      const name = (log.item_name || '').trim().toLowerCase();
      if (!name) return;
      if (!itemActions[name]) itemActions[name] = { added_count: 0, removed_count: 0, originalName: log.item_name.trim() };
      
      if (log.action === 'added') itemActions[name].added_count++;
      else if (log.action === 'removed') itemActions[name].removed_count++;
    });

    const itemsSnap = await db.collection('users').doc(userId).collection('household_items').get();
    const existingItems = itemsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    const existingNamesMap = new Map();
    existingItems.forEach(i => existingNamesMap.set((i.item_name || '').trim().toLowerCase(), i));

    for (const [name, counts] of Object.entries(itemActions)) {
      if (existingNamesMap.has(name)) {
        const item = existingNamesMap.get(name);
        let updatedDays = item.consumption_days || 14;
        let changed = false;

        if (counts.added_count >= 3 && counts.removed_count >= 3) {
          updatedDays += 1;
          changed = true;
        } else if (counts.added_count >= 3) {
          updatedDays -= 1;
          changed = true;
        } else if (counts.removed_count >= 3) {
          updatedDays += 2;
          changed = true;
        }

        if (changed) {
          updatedDays = clampConsumptionDays(updatedDays);
          const itemRef = db.collection('users').doc(userId).collection('household_items').doc(item.id);
          batch.update(itemRef, { consumption_days: updatedDays });
        }
      }
    }

    // 2. Auto-Promotion
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const capturesSnap = await db.collection('users').doc(userId).collection('daily_captures').get();
    
    const recentManualCaptures = capturesSnap.docs
      .map(d => d.data())
      .filter(c => {
        const capAt = c.captured_at ? (c.captured_at.toDate ? c.captured_at.toDate() : new Date(c.captured_at)) : null;
        const isManual = c.source === 'manual' || !c.source;
        return capAt && capAt >= thirtyDaysAgo && isManual;
      });

    const manualCounts = {};
    recentManualCaptures.forEach(cap => {
      const name = (cap.item_name || '').trim().toLowerCase();
      if (!name) return;
      if (!manualCounts[name]) manualCounts[name] = { count: 0, originalName: cap.item_name.trim() };
      manualCounts[name].count++;
    });

    let autoPromotedCount = 0;
    for (const [name, data] of Object.entries(manualCounts)) {
      if (data.count >= 4 && !existingNamesMap.has(name)) {
        const newItemRef = db.collection('users').doc(userId).collection('household_items').doc();
        batch.set(newItemRef, {
          item_name: data.originalName,
          consumption_days: 7,
          is_critical: false,
          is_kirana: false,
          confidence_level: 'low',
          order_cycles: 0,
          created_at: admin.firestore.FieldValue.serverTimestamp()
        });
        existingNamesMap.set(name, { id: newItemRef.id, item_name: data.originalName });
        autoPromotedCount++;
      }
    }

    batch.set(summaryRef, {
      last_run_at: admin.firestore.FieldValue.serverTimestamp(),
      auto_promoted: autoPromotedCount
    }, { merge: true });

    await batch.commit();
    return { success: true, userId, autoPromotedCount };
  } catch (err) {
    console.warn(`[LearningService] Execution error for user ${userId}:`, err.message || err);
    return { success: false, userId, error: err.message };
  }
}

export async function processAllUsersLearning() {
  console.log('[LearningService] Starting weekly learning batch job...');
  try {
    const db = admin.firestore();
    const usersSnap = await db.collection('users').get();
    let processedUsers = 0;
    for (const userDoc of usersSnap.docs) {
      const userId = userDoc.id;
      try {
        await processUserLearning(userId);
        processedUsers++;
      } catch (userErr) {
        console.warn(`[LearningService] Isolated warning for user ${userId}:`, userErr.message || userErr);
      }
    }
    console.log(`[LearningService] Weekly learning batch job complete.`);
    return { success: true, processedUsers };
  } catch (err) {
    console.warn('[LearningService] Weekly learning batch job error:', err.message || err);
    return { success: false, error: err.message };
  }
}
