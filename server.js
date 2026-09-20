import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import admin from 'firebase-admin';
import bcrypt from 'bcryptjs';
import cors from 'cors';
import fs from 'fs';
import webpush from 'web-push';

import { evaluateUserNudge, snoozeUserNudge } from './server/services/nudgeService.js';
import { startNudgeScheduler, getActiveVapidPublicKey } from './services/nudgeScheduler.js';
import {
  handleRecommendationExposure,
  handleRecommendationAction,
  processOrderConfirmationLearning
} from './server/services/learningService.js';
import { calculateRunningLowItems } from './server/services/runningLowService.js';
import { comparePricesAcrossPlatforms } from './server/services/priceComparisonService.js';
import { trackPersistentEvent, computeUserAnalyticsSummary } from './server/services/analyticsService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const configPath = path.join(__dirname, 'firebase-applet-config.json');
const firebaseConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));

// Initialize Firebase Admin
let adminApp;
if (process.env.FIREBASE_PRIVATE_KEY && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PROJECT_ID) {
  try {
    adminApp = admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      }),
    });
    console.log('Successfully initialized Firebase Admin using service account credential.');
  } catch (err) {
    console.error('Failed to initialize Firebase Admin with service account. Falling back to default:', err);
    adminApp = admin.initializeApp({
      projectId: firebaseConfig.projectId,
    });
  }
} else {
  console.log('Firebase Private Key or Service Account email not set in environment variables. Falling back to default project ID initialisation.');
  adminApp = admin.initializeApp({
    projectId: firebaseConfig.projectId,
  });
}

const db = admin.firestore();

async function startServer() {
  const app = express();
  const PORT = process.env.PORT || 3000;

  app.use(cors());
  app.use(express.json());

  // Health check
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
  });

  // =========================================================================
  // 1. Authoritative Order Confirmation & Cadence Learning
  // =========================================================================
  const handleOrderConfirmation = async (req, res) => {
    try {
      const userId = req.params.id || req.params.userId;
      const { items, platform, estimated_value, estimatedValue, idempotency_key, idempotencyKey } = req.body;

      if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'Order must contain at least one item' });
      }

      const result = await processOrderConfirmationLearning({
        userId,
        items,
        platform: platform || 'grocery_store',
        estimatedValue: estimated_value !== undefined ? estimated_value : (estimatedValue || 0),
        idempotencyKey: idempotency_key || idempotencyKey || null,
        db,
        now: new Date()
      });

      // Track order confirmation analytics event
      await trackPersistentEvent(userId, 'Order Confirmed', {
        platform: platform || 'grocery_store',
        items_count: items.length,
        estimated_value: estimated_value || estimatedValue || 0,
        deduplicated: result.deduplicated || false
      }, db);

      return res.json(result);
    } catch (err) {
      console.error('[API] Order confirmation error:', err.message || err);
      return res.status(500).json({ error: err.message || 'Failed to process order' });
    }
  };

  app.post('/api/users/:id/orders/confirm', handleOrderConfirmation);
  app.post('/api/users/:id/orders', handleOrderConfirmation);

  // =========================================================================
  // 2. Authoritative Recommendation Learning & Exposure
  // =========================================================================
  app.post('/api/users/:id/recommendations/exposure', async (req, res) => {
    try {
      const userId = req.params.id;
      const { exposure_id, exposureId, item_ids, itemIds } = req.body;
      const id = exposure_id || exposureId;
      const items = item_ids || itemIds || [];

      const result = await handleRecommendationExposure(userId, id, items, db);
      return res.json(result);
    } catch (err) {
      if (!err.message?.includes('PERMISSION_DENIED')) {
        console.warn('[API] Recommendation exposure notice:', err.message || err);
      }
      return res.json({ success: true, clientHandled: true });
    }
  });

  app.post('/api/users/:id/recommendations/:itemId/action', async (req, res) => {
    try {
      const userId = req.params.id;
      const itemId = req.params.itemId;
      const { action, action_id, actionId } = req.body;

      if (!action || !['added', 'dismissed', 'removed'].includes(action)) {
        return res.status(400).json({ error: 'Valid action (added, dismissed, removed) is required' });
      }

      const result = await handleRecommendationAction(userId, itemId, action, action_id || actionId, db);
      
      // Track analytics
      await trackPersistentEvent(userId, `Recommendation ${action === 'added' ? 'Accepted' : 'Dismissed'}`, {
        itemId,
        action
      }, db);

      return res.json(result);
    } catch (err) {
      if (!err.message?.includes('PERMISSION_DENIED')) {
        console.warn('[API] Recommendation action notice:', err.message || err);
      }
      return res.json({ success: true, clientHandled: true });
    }
  });

  // =========================================================================
  // 3. Authoritative Running Low List Endpoint
  // =========================================================================
  app.get('/api/users/:id/running-low', async (req, res) => {
    try {
      const userId = req.params.id;
      const [itemsSnap, capturesSnap] = await Promise.all([
        db.collection('users').doc(userId).collection('household_items').get(),
        db.collection('users').doc(userId).collection('daily_captures').get()
      ]);

      const householdItems = itemsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      const todayCaptures = capturesSnap.docs.map(d => ({ id: d.id, ...d.data() }));

      const lowItems = calculateRunningLowItems({
        householdItems,
        todayCaptures,
        now: new Date()
      });

      return res.json({ items: lowItems, count: lowItems.length });
    } catch (err) {
      console.error('[API] Running low endpoint error:', err.message || err);
      return res.status(500).json({ error: err.message });
    }
  });

  // =========================================================================
  // 4. Smart Nudge Engine, Open Log & Remind Later
  // =========================================================================
  app.get('/api/users/:id/nudge', async (req, res) => {
    try {
      const userId = req.params.id;
      const result = await evaluateUserNudge(userId);
      return res.json(result);
    } catch (error) {
      console.warn('Nudge evaluation endpoint warning:', error.message || error);
      return res.json({
        show: false,
        condition: 1,
        threshold: 4,
        lowItemsCount: 0,
        nudgeText: ''
      });
    }
  });

  app.post('/api/users/:id/nudge/open', async (req, res) => {
    try {
      const userId = req.params.id;
      const snap = await db.collection('users').doc(userId).collection('nudge_log')
        .orderBy('sent_at', 'desc')
        .limit(20)
        .get();

      const latestUnopened = snap.docs.find(doc => !doc.data().opened_at);
      if (latestUnopened) {
        await latestUnopened.ref.update({
          opened_at: admin.firestore.FieldValue.serverTimestamp()
        });
      }

      await trackPersistentEvent(userId, 'Notification Opened', {}, db);
      return res.json({ success: true });
    } catch (err) {
      if (!err.message?.includes('PERMISSION_DENIED')) {
        console.warn('Note on nudge open endpoint:', err.message || err);
      }
      return res.json({ success: true, clientHandled: true });
    }
  });

  app.post('/api/users/:id/nudge/remind-later', async (req, res) => {
    try {
      const userId = req.params.id;
      const { hours } = req.body;
      const result = await snoozeUserNudge(userId, typeof hours === 'number' ? hours : 3, db);
      
      await trackPersistentEvent(userId, 'Notification Dismissed', { action: 'remind_later', hours: hours || 3 }, db);
      return res.json(result);
    } catch (err) {
      console.warn('Error in nudge remind-later endpoint:', err.message || err);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // VAPID & Push Subscription Routes
  app.get('/api/vapid-public-key', (req, res) => {
    const key = process.env.VAPID_PUBLIC_KEY || process.env.VITE_VAPID_PUBLIC_KEY || getActiveVapidPublicKey();
    res.json({ publicKey: key || '' });
  });

  app.post('/api/users/:id/subscribe', async (req, res) => {
    try {
      const userId = req.params.id;
      const { subscription } = req.body;
      if (subscription) {
        await db.collection('users').doc(userId).set({
          push_subscription: subscription
        }, { merge: true });
      }
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // =========================================================================
  // 5. Multi-Platform Price Comparison (Blinkit, Zepto, Instamart) + Cache
  // =========================================================================
  app.post('/api/users/:id/prices', async (req, res) => {
    try {
      const { items, forceRefresh, location } = req.body;
      const userId = req.params.id;

      // Fetch user profile to get location preferences if available
      let userProfile = location || {};
      try {
        const userDoc = await db.collection('users').doc(userId).get();
        if (userDoc.exists) {
          userProfile = { ...userDoc.data(), ...userProfile };
        }
      } catch (uErr) {
        console.warn(`[API] Could not fetch user location profile for ${userId}:`, uErr.message);
      }

      const comparison = await comparePricesAcrossPlatforms({
        items,
        userProfile,
        forceRefresh: forceRefresh === true,
        db
      });

      // Track analytics
      await trackPersistentEvent(userId, 'Price Comparison Executed', {
        items_count: items?.length || 0,
        recommended_platform: comparison.recommendedPlatform,
        is_force_refresh: forceRefresh === true
      }, db);

      return res.json(comparison);
    } catch (error) {
      console.error('Price comparison endpoint error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // =========================================================================
  // 6. Persistent Analytics Endpoint
  // =========================================================================
  app.post('/api/users/:id/events', async (req, res) => {
    try {
      const userId = req.params.id;
      const { eventName, properties } = req.body;
      const result = await trackPersistentEvent(userId, eventName, properties, db);
      return res.json(result);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/users/:id/insights', async (req, res) => {
    try {
      const userId = req.params.id;
      const summary = await computeUserAnalyticsSummary(userId, db);
      const cadenceSnap = await db.collection('users').doc(userId).collection('cadence').doc('profile').get();
      const cadence = cadenceSnap.exists ? cadenceSnap.data() : null;

      return res.json({
        summary,
        cadence
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // Vite Middleware
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
    startNudgeScheduler();
  });
}

startServer();
