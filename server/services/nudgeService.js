import admin from 'firebase-admin';
import webpush from 'web-push';
import { GoogleGenAI } from '@google/genai';
import { calculateRunningLowItems } from './runningLowService.js';

let ai = null;
if (process.env.GEMINI_API_KEY) {
  try {
    ai = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        }
      }
    });
  } catch (err) {
    console.warn('Failed to initialize Gemini client in nudgeService:', err.message || err);
  }
}

export function computeNudgeTriggers({ runningLowItems = [], threshold = 4, cadenceProfile = null, now = new Date() }) {
  // Only consider non-kirana items for delivery nudges
  const onlineLowItems = runningLowItems.filter(item => {
    const days = typeof item.days_remaining === 'number' ? item.days_remaining : 0;
    const isKirana = item.is_kirana === true;
    return days <= 3 && !isKirana;
  });

  const low_count = onlineLowItems.length;
  const threshold_trigger = low_count >= threshold;

  const critical_trigger = onlineLowItems.some(item => {
    return item.is_critical === true && item.days_remaining <= 1;
  });

  let cadence_trigger = false;
  if (cadenceProfile && cadenceProfile.weekday && low_count > 0) {
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const daysMap = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const tomorrowWeekday = daysMap[tomorrow.getDay()];
    if (cadenceProfile.weekday === tomorrowWeekday) {
      cadence_trigger = true;
    }
  }

  const showNudge = threshold_trigger || critical_trigger || cadence_trigger;

  return {
    showNudge,
    threshold_trigger,
    critical_trigger,
    cadence_trigger,
    low_items: onlineLowItems,
    low_count
  };
}

export async function evaluateUserNudge(userId, isCron = false, now = new Date()) {
  try {
    const db = admin.firestore();

    const [userDoc, itemsSnap, capturesSnap, cadenceSnap] = await Promise.all([
      db.collection('users').doc(userId).get().catch(() => null),
      db.collection('users').doc(userId).collection('household_items').get().catch(() => ({ docs: [] })),
      db.collection('users').doc(userId).collection('daily_captures').get().catch(() => ({ docs: [] })),
      db.collection('users').doc(userId).collection('cadence').doc('profile').get().catch(() => null)
    ]);

    const userData = userDoc && userDoc.exists ? (userDoc.data() || {}) : {};
    const threshold = userData.nudge_threshold !== undefined ? userData.nudge_threshold : 4;
    const cadenceProfile = cadenceSnap && cadenceSnap.exists ? cadenceSnap.data() : null;

    // Check Remind Me Later / Snooze state
    if (userData.nudge_snoozed_until) {
      const snoozedUntil = userData.nudge_snoozed_until.toDate
        ? userData.nudge_snoozed_until.toDate()
        : new Date(userData.nudge_snoozed_until);

      if (snoozedUntil && snoozedUntil.getTime() > now.getTime()) {
        return {
          show: false,
          reason: 'snoozed',
          snoozedUntil: snoozedUntil.toISOString(),
          condition: 1,
          threshold,
          lowItemsCount: 0,
          nudgeText: ''
        };
      }
    }

    const householdItems = itemsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    const todayCaptures = capturesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    // Use authoritative Running Low calculation
    const runningLowItems = calculateRunningLowItems({
      householdItems,
      todayCaptures,
      now
    });

    const triggerEval = computeNudgeTriggers({
      runningLowItems,
      threshold,
      cadenceProfile,
      now
    });

    if (!triggerEval.showNudge) {
      return {
        show: false,
        condition: 1,
        threshold,
        lowItemsCount: triggerEval.low_count,
        nudgeText: ''
      };
    }

    // Check recent 20-hour suppression window
    try {
      const twentyHoursAgo = new Date(now.getTime() - 20 * 60 * 60 * 1000);
      const nudgeLogSnap = await db.collection('users').doc(userId).collection('nudge_log')
        .where('sent_at', '>=', twentyHoursAgo)
        .limit(1)
        .get();

      if (!nudgeLogSnap.empty) {
        return {
          show: false,
          reason: 'duplicate',
          condition: 1,
          threshold,
          lowItemsCount: triggerEval.low_count,
          nudgeText: ''
        };
      }
    } catch (logCheckErr) {
      console.warn(`[NudgeService] Duplicate check warning for ${userId}:`, logCheckErr.message || logCheckErr);
    }

    const triggerTypes = [];
    if (triggerEval.threshold_trigger) triggerTypes.push('threshold');
    if (triggerEval.critical_trigger) triggerTypes.push('critical');
    if (triggerEval.cadence_trigger) triggerTypes.push('cadence');

    const criticalItems = triggerEval.low_items
      .filter(item => item.is_critical === true && item.days_remaining <= 1)
      .map(item => item.item_name);

    let title = 'CartSense 🛒';
    let body = '';

    if (ai) {
      try {
        const prompt = `You are the AI Nudge Engine for CartSense, an intelligent household grocery stock manager.
Generate a short, friendly, personalized nudge for the user based on their inventory status.

Inventory Status:
- Trigger Type(s): ${triggerTypes.join(', ')}
- Low Item Count: ${triggerEval.low_count}
- Critical Item Names: ${criticalItems.join(', ') || 'None'}
- Cadence Trigger: ${triggerEval.cadence_trigger ? 'Yes' : 'No'}
- Running Low Items: ${triggerEval.low_items.map(i => `${i.item_name} (due in ${i.days_remaining} days)`).join(', ')}

Tone Guidelines:
- Tone must remain stock awareness, NOT ordering (do NOT urge them to buy, just make them aware).
- Keep concise, helpful, friendly (1-2 sentences, max 40 words).

Output JSON with 'title' and 'body'.`;

        const response = await ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: prompt,
          config: {
            responseMimeType: 'application/json',
            responseSchema: {
              type: 'OBJECT',
              properties: {
                title: { type: 'STRING' },
                body: { type: 'STRING' }
              },
              required: ['title', 'body']
            }
          }
        });

        if (response && response.text) {
          const parsed = JSON.parse(response.text.trim());
          if (parsed.title) title = parsed.title;
          if (parsed.body) body = parsed.body;
        }
      } catch (geminiErr) {
        console.warn(`[NudgeService] Gemini generation fallback for ${userId}:`, geminiErr.message || geminiErr);
      }
    }

    if (!body) {
      if (criticalItems.length > 0) {
        body = `Your stock check is ready — ${triggerEval.low_count} items are running low, including critical items like ${criticalItems.join(', ')}.`;
      } else {
        body = `Your stock check is ready — ${triggerEval.low_count} items are running low. Tap to review.`;
      }
    }

    let condition = 1;
    if (triggerEval.critical_trigger) {
      condition = 3;
    } else if (triggerEval.threshold_trigger || triggerEval.cadence_trigger) {
      condition = 2;
    }

    return {
      show: true,
      title,
      body,
      triggerType: triggerTypes.join(', '),
      lowCount: triggerEval.low_count,
      criticalItems,
      cadenceTrigger: triggerEval.cadence_trigger,
      condition,
      nudgeText: body,
      threshold,
      lowItemsCount: triggerEval.low_count
    };
  } catch (err) {
    console.warn(`[NudgeService] Execution error for ${userId}:`, err.message || err);
    return { show: false, condition: 1, threshold: 4, lowItemsCount: 0, nudgeText: '' };
  }
}

export async function sendNudgeNotification(userId, nudgeResult, pushSubscription) {
  if (!pushSubscription || !nudgeResult || !nudgeResult.show) return false;

  const payload = JSON.stringify({
    title: nudgeResult.title || 'CartSense 🛒',
    body: nudgeResult.body || 'Your stock check is ready. Tap to review.',
    icon: '/icon-192.svg',
    badge: '/icon-192.svg',
    tag: 'cartsense-nudge',
    data: { route: '/running-low', userId },
    actions: [
      { action: 'review_stock', title: 'Review Stock' },
      { action: 'remind_later', title: 'Remind Me Later' }
    ],
    timestamp: Date.now()
  });

  try {
    await webpush.sendNotification(pushSubscription, payload);
    console.log(`[NudgeService] Push notification sent to user ${userId}`);
    return true;
  } catch (err) {
    console.warn(`[NudgeService] Push delivery warning for user ${userId}:`, err.message || err);
    return false;
  }
}

/**
 * Race-Safe and Idempotent Nudge Processing for a Single User
 */
export async function processSingleUserNudge(userId, isCron = false, now = new Date()) {
  try {
    const db = admin.firestore();
    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists) return { userId, processed: false, reason: 'user_not_found' };

    const userData = userDoc.data() || {};
    const nudgeResult = await evaluateUserNudge(userId, isCron, now);

    if (!nudgeResult || !nudgeResult.show || !userData.push_subscription) {
      return { userId, processed: true, show: nudgeResult?.show || false };
    }

    // Atomic reservation to prevent race conditions during concurrent executions
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const reservationKey = `nudge_res_${todayStr}_${Math.floor(now.getHours() / 12)}`;
    const resRef = db.collection('users').doc(userId).collection('nudge_reservations').doc(reservationKey);

    const reserved = await db.runTransaction(async (t) => {
      const resDoc = await t.get(resRef);
      if (resDoc.exists && resDoc.data().status === 'sent') {
        return false;
      }
      t.set(resRef, {
        status: 'pending',
        reserved_at: admin.firestore.FieldValue.serverTimestamp()
      });
      return true;
    });

    if (!reserved) {
      return { userId, processed: true, show: false, reason: 'concurrent_duplicate_prevented' };
    }

    // Send push
    const sent = await sendNudgeNotification(userId, nudgeResult, userData.push_subscription);

    if (sent) {
      await Promise.all([
        db.collection('users').doc(userId).collection('nudge_log').add({
          condition_triggered: nudgeResult.triggerType,
          items_count: nudgeResult.lowCount,
          sent_at: admin.firestore.FieldValue.serverTimestamp(),
          opened_at: null,
          reservation_key: reservationKey
        }),
        resRef.set({
          status: 'sent',
          sent_at: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true })
      ]);
      return { userId, processed: true, show: true, sent: true };
    } else {
      // Mark reservation failed so future valid retries are not permanently blocked
      await resRef.set({
        status: 'failed',
        failed_at: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      return { userId, processed: true, show: true, sent: false };
    }
  } catch (err) {
    console.warn(`[NudgeService] Warning processing user ${userId}:`, err.message || err);
    return { userId, processed: false, error: err.message };
  }
}

/**
 * Filter users whose current local time is 8:00 PM (hour 20) in their configured timezone (default: Asia/Kolkata)
 */
export function getUsersDueForNudgeEvaluation(allUsersSnap, now = new Date()) {
  const docs = Array.isArray(allUsersSnap)
    ? allUsersSnap
    : (allUsersSnap && Array.isArray(allUsersSnap.docs) ? allUsersSnap.docs : []);

  return docs.filter(userDoc => {
    const data = typeof userDoc.data === 'function' ? userDoc.data() : (userDoc.data || userDoc);
    const tz = (data && data.timezone) ? data.timezone : 'Asia/Kolkata';
    try {
      const hourStr = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        hour: 'numeric',
        hourCycle: 'h23'
      }).format(now);
      const localHour = parseInt(hourStr, 10);
      return localHour === 20;
    } catch (err) {
      // Fallback to Asia/Kolkata on invalid timezone identifier
      try {
        const hourStr = new Intl.DateTimeFormat('en-US', {
          timeZone: 'Asia/Kolkata',
          hour: 'numeric',
          hourCycle: 'h23'
        }).format(now);
        return parseInt(hourStr, 10) === 20;
      } catch (e) {
        return false;
      }
    }
  });
}

export async function processAllUsersNudges(now = new Date()) {
  console.log('[NudgeService] Starting hourly timezone-aware nudge processing batch...');
  try {
    const db = admin.firestore();
    const usersSnap = await db.collection('users').get();
    const dueUsers = getUsersDueForNudgeEvaluation(usersSnap, now);
    
    let processedCount = 0;
    for (const userDoc of dueUsers) {
      const userId = userDoc.id;
      try {
        await processSingleUserNudge(userId, true, now);
        processedCount++;
      } catch (userErr) {
        console.warn(`[NudgeService] Single user nudge warning for ${userId}:`, userErr.message || userErr);
      }
    }
    console.log(`[NudgeService] Completed nudge batch processing. Evaluated ${dueUsers.length} users due at 8 PM local, processed ${processedCount}.`);
    return { success: true, processedCount, dueCount: dueUsers.length };
  } catch (err) {
    console.warn('[NudgeService] Nudge batch processing warning:', err.message || err);
    return { success: false, error: err.message };
  }
}

/**
 * Persist Remind Me Later / Snooze interval
 */
export async function snoozeUserNudge(userId, hours = 3, db = admin.firestore()) {
  const snoozeMs = Math.max(1, hours) * 60 * 60 * 1000;
  const snoozeUntil = new Date(Date.now() + snoozeMs);
  
  await db.collection('users').doc(userId).set({
    nudge_snoozed_until: admin.firestore.Timestamp.fromDate(snoozeUntil)
  }, { merge: true });

  return { success: true, snoozedUntil: snoozeUntil.toISOString() };
}
