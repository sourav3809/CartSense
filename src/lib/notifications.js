import { trackEvent } from './analytics';

export function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding)
    .replace(/-/g, '+')
    .replace(/_/g, '/');

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export function isPushSupported() {
  return typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window;
}

export function getNotificationPermission() {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }
  return Notification.permission;
}

export function validateDestinationRoute(route) {
  if (!route || typeof route !== 'string') return '/';

  const cleanRoute = route.trim();
  const lower = cleanRoute.toLowerCase();

  const validExactRoutes = ['/', '/running-low', '/prices', '/settings', '/history', '/insights'];
  if (validExactRoutes.includes(lower)) {
    return lower;
  }

  if (lower.startsWith('/order/')) {
    const parts = cleanRoute.split('/');
    if (parts.length >= 3) {
      const platform = parts[2].trim();
      const validPlatforms = ['blinkit', 'zepto', 'instamart', 'swiggy', 'bigbasket'];
      if (platform && (validPlatforms.includes(platform.toLowerCase()) || platform.length > 0)) {
        return `/order/${encodeURIComponent(platform.toLowerCase())}`;
      }
    }
  }

  return '/';
}

export async function fetchVapidPublicKey() {
  try {
    const res = await fetch('/api/vapid-public-key');
    if (res.ok) {
      const data = await res.json();
      return data.publicKey || null;
    }
  } catch (err) {
    console.warn('[Notifications] Failed to fetch VAPID key:', err);
  }
  return null;
}

export async function registerPushSubscription(userId) {
  if (!isPushSupported()) {
    return { success: false, reason: 'unsupported' };
  }
  if (!userId) {
    return { success: false, reason: 'no_user_id' };
  }

  try {
    let permission = Notification.permission;
    if (permission === 'default') {
      permission = await Notification.requestPermission();
    }

    if (permission !== 'granted') {
      trackEvent('subscription_permission_revoked');
      return { success: false, permission };
    }

    const registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();

    const vapidPublicKey = await fetchVapidPublicKey();
    if (!vapidPublicKey) {
      console.warn('[Notifications] No VAPID public key returned from backend.');
      return { success: false, reason: 'no_vapid_key' };
    }

    const applicationServerKey = urlBase64ToUint8Array(vapidPublicKey);

    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey
      });
      console.log('[Notifications] New push subscription created');
    } else {
      console.log('[Notifications] Reusing existing push subscription');
    }

    await fetch(`/api/users/${userId}/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription })
    });

    trackEvent('subscription_refreshed');
    return { success: true, subscription };
  } catch (err) {
    console.error('[Notifications] Push subscription error:', err);
    trackEvent('subscription_refresh_failed', { error: err.message });
    return { success: false, error: err.message };
  }
}

async function attemptSubscriptionWithRetry(userId, registration) {
  const trySubscribe = async () => {
    const vapidPublicKey = await fetchVapidPublicKey();
    if (!vapidPublicKey) throw new Error('no_vapid_key');

    const applicationServerKey = urlBase64ToUint8Array(vapidPublicKey);
    const newSub = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey
    });

    const subRes = await fetch(`/api/users/${userId}/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription: newSub })
    });
    if (!subRes.ok) throw new Error('failed_to_save_subscription');

    return newSub;
  };

  try {
    const sub = await trySubscribe();
    return { success: true, subscription: sub };
  } catch (err1) {
    console.warn('[Notifications] Subscription attempt 1 failed, retrying in 30s:', err1.message);
  }

  await new Promise((resolve) => setTimeout(resolve, 30000));

  if (getNotificationPermission() === 'denied') {
    trackEvent('subscription_permission_revoked');
    return { success: false, error: 'permission_denied' };
  }

  try {
    const sub2 = await trySubscribe();
    return { success: true, subscription: sub2 };
  } catch (err2) {
    console.error('[Notifications] Subscription attempt 2 failed:', err2.message);
    return { success: false, error: err2.message };
  }
}

export async function autoRefreshSubscription(userId) {
  if (!isPushSupported() || !userId) {
    return { status: 'unsupported' };
  }

  const permission = getNotificationPermission();
  if (permission === 'denied') {
    trackEvent('subscription_permission_revoked');
    return { status: 'permission_denied' };
  }
  if (permission !== 'granted') {
    return { status: 'not_granted' };
  }

  try {
    const registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();

    if (!subscription) {
      const res = await attemptSubscriptionWithRetry(userId, registration);
      if (res.success) {
        trackEvent('subscription_refreshed');
        return { status: 'refreshed', subscription: res.subscription };
      } else {
        trackEvent('subscription_refresh_failed', { error: res.error });
        return { status: 'needs_re-enable', error: res.error };
      }
    }

    const verifyRes = await fetch(`/api/users/${userId}/verify-subscription`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription })
    });

    if (verifyRes.ok) {
      const verifyData = await verifyRes.json();
      if (verifyData.status === 'valid') {
        trackEvent('subscription_verified');
        return { status: 'valid', subscription };
      }
    }

    console.log('[Notifications] Subscription expired/invalid according to backend. Refreshing...');
    try {
      await subscription.unsubscribe();
    } catch (unsubErr) {
      console.warn('[Notifications] Unsubscribe error:', unsubErr);
    }

    const refreshRes = await attemptSubscriptionWithRetry(userId, registration);
    if (refreshRes.success) {
      trackEvent('subscription_refreshed');
      return { status: 'refreshed', subscription: refreshRes.subscription };
    } else {
      trackEvent('subscription_refresh_failed', { error: refreshRes.error });
      return { status: 'needs_re-enable', error: refreshRes.error };
    }
  } catch (err) {
    console.error('[Notifications] Auto-refresh error:', err);
    trackEvent('subscription_refresh_failed', { error: err.message });
    return { status: 'needs_re-enable', error: err.message };
  }
}

export function setupSWNotificationListeners(navigate) {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return () => {};

  const handleMessage = (event) => {
    if (!event.data) return;

    if (event.data.type === 'NAVIGATE' && event.data.url) {
      const validRoute = validateDestinationRoute(event.data.url);
      console.log('[Notifications SW] Navigating to validated route:', validRoute);
      if (navigate) {
        navigate(validRoute);
      }
    }

    if (event.data.type === 'ANALYTICS_EVENT' && event.data.eventName) {
      trackEvent(event.data.eventName, event.data.params || {});
    }
  };

  navigator.serviceWorker.addEventListener('message', handleMessage);
  return () => {
    navigator.serviceWorker.removeEventListener('message', handleMessage);
  };
}
