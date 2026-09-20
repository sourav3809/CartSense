import cron from 'node-cron';
import webpush from 'web-push';
import { processAllUsersNudges } from './nudgeService.js';
import { processAllUsersLearning } from './learningService.js';

let publicKey = process.env.VAPID_PUBLIC_KEY || process.env.VITE_VAPID_PUBLIC_KEY;
let privateKey = process.env.VAPID_PRIVATE_KEY;

if (!publicKey || !privateKey) {
  try {
    const keys = webpush.generateVAPIDKeys();
    publicKey = keys.publicKey;
    privateKey = keys.privateKey;
    console.log('[Scheduler] Auto-generated runtime VAPID keys for Web Push session.');
  } catch (genErr) {
    console.warn('[Scheduler] Error generating VAPID keys:', genErr.message || genErr);
  }
}

if (publicKey && privateKey) {
  try {
    webpush.setVapidDetails(
      'mailto:support@cartsense.com',
      publicKey,
      privateKey
    );
    console.log('[Scheduler] VAPID details set successfully for Web Push.');
  } catch (err) {
    console.warn('[Scheduler] Error setting VAPID details:', err.message || err);
  }
}

export function getActiveVapidPublicKey() {
  return publicKey;
}

export function startNudgeScheduler() {
  console.log('[Scheduler] Registering Cron Infrastructure...');

  // 1. Hourly Nudge Cron ('0 * * * *')
  // Runs hourly at the top of the hour (0 * * * *) so nudges fire at 8:00 PM in each user's local timezone.
  // A single daily server-time cron cannot accommodate users in varying timezones.
  cron.schedule('0 * * * *', async () => {
    console.log('[Scheduler] Running hourly timezone-aware Nudge evaluation job...');
    try {
      await processAllUsersNudges();
    } catch (err) {
      console.warn('[Scheduler] Hourly Nudge cron warning:', err.message || err);
    }
  });

  // 2. Weekly Sunday 12 AM Learning cron ('0 0 * * 0')
  cron.schedule('0 0 * * 0', async () => {
    console.log('[Scheduler] Running Weekly Sunday 12:00 AM Learning engine job...');
    try {
      await processAllUsersLearning();
    } catch (err) {
      console.warn('[Scheduler] Weekly Learning cron warning:', err.message || err);
    }
  });

  console.log('[Scheduler] Cron infrastructure initialized (Daily 6 PM Nudge & Weekly Sunday 12 AM Learning).');
}
