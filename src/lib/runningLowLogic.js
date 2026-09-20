/**
 * Authoritative Canonical Running Low Calculation Logic
 * Shared across Home, Running Low, Nudge Engine, and Order flows.
 */

export function parseItemDate(dateVal) {
  if (!dateVal) return null;
  if (dateVal.toDate && typeof dateVal.toDate === 'function') {
    return dateVal.toDate();
  }
  const d = new Date(dateVal);
  return isNaN(d.getTime()) ? null : d;
}

export function computeItemDaysRemaining(item, now = new Date()) {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);

  const lastOrderedAt = parseItemDate(item.last_ordered_at);
  const createdAt = parseItemDate(item.created_at);
  const baseDate = lastOrderedAt || createdAt;

  const consumptionDays = typeof item.consumption_days === 'number' && !isNaN(item.consumption_days)
    ? item.consumption_days
    : 14;

  if (!baseDate) {
    // If no order or created timestamp exists, consider due today (0 days remaining)
    return 0;
  }

  const dueDate = new Date(baseDate.getTime() + consumptionDays * 86400000);
  dueDate.setHours(0, 0, 0, 0);
  return Math.floor((dueDate.getTime() - today.getTime()) / 86400000);
}

export function isItemDismissedForCycle(item) {
  const dismissedAt = parseItemDate(item.dismissed_at);
  if (!dismissedAt) return false;

  const lastOrderedAt = parseItemDate(item.last_ordered_at);
  if (!lastOrderedAt) return true;

  return dismissedAt.getTime() >= lastOrderedAt.getTime();
}

/**
 * Calculates authoritative running low items list
 * @param {Object} params
 * @param {Array} params.householdItems - User's household inventory items
 * @param {Array} params.todayCaptures - Today's captured low stock items
 * @param {Date} params.now - Current date reference
 */
export function calculateRunningLowItems({ householdItems = [], todayCaptures = [], now = new Date() }) {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const todayStr = today.toDateString();

  // Normalize today's captures
  const validCaptures = (todayCaptures || []).filter(c => {
    if (!c) return false;
    const capDate = parseItemDate(c.captured_at);
    return capDate ? capDate.toDateString() === todayStr : true;
  });

  const captureMap = new Map();
  validCaptures.forEach(c => {
    if (c.item_name) {
      captureMap.set(c.item_name.trim().toLowerCase(), c);
    }
  });

  const processedNames = new Set();
  const lowItems = [];

  (householdItems || []).forEach(item => {
    if (!item || !item.item_name) return;
    const nameKey = item.item_name.trim().toLowerCase();

    // Check if dismissed in current cycle
    if (isItemDismissedForCycle(item)) {
      return;
    }

    const naturalDaysRemaining = computeItemDaysRemaining(item, today);
    const isCaptured = captureMap.has(nameKey);

    // If days_remaining <= 3 OR captured today => Running Low
    // (Overdue items with days_remaining <= 0 are included)
    if (naturalDaysRemaining <= 3 || isCaptured) {
      const days_remaining = isCaptured ? Math.min(naturalDaysRemaining, 0) : naturalDaysRemaining;
      lowItems.push({
        ...item,
        days_remaining,
        is_captured_today: isCaptured
      });
      processedNames.add(nameKey);
    }
  });

  // Include captures that aren't existing household items
  validCaptures.forEach(cap => {
    if (!cap.item_name) return;
    const nameKey = cap.item_name.trim().toLowerCase();
    if (!processedNames.has(nameKey)) {
      lowItems.push({
        id: cap.id ? (String(cap.id).startsWith('cap-') ? cap.id : `cap-${cap.id}`) : `cap-${nameKey}`,
        item_name: cap.item_name,
        days_remaining: 0,
        confidence_level: 'low',
        is_kirana: false,
        is_critical: false,
        is_captured_today: true,
        quantity: cap.quantity || ''
      });
      processedNames.add(nameKey);
    }
  });

  // Sort canonical order: Critical first, then ascending by days_remaining (most overdue first)
  lowItems.sort((a, b) => {
    const critA = a.is_critical === true ? 1 : 0;
    const critB = b.is_critical === true ? 1 : 0;
    if (critB !== critA) return critB - critA;
    return a.days_remaining - b.days_remaining;
  });

  return lowItems;
}
