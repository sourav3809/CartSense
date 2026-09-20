import admin from 'firebase-admin';
import { normaliseString, parseQuantity } from './priceMatching.js';

export const PRICE_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes standard TTL

export function generateLocationKey(location) {
  if (!location) return 'default_loc';
  if (typeof location === 'string') {
    return normaliseString(location).replace(/\s+/g, '_') || 'default_loc';
  }
  if (typeof location === 'object') {
    if (location.latitude && location.longitude) {
      const lat = parseFloat(location.latitude).toFixed(2);
      const lon = parseFloat(location.longitude).toFixed(2);
      const city = location.city ? normaliseString(location.city).replace(/\s+/g, '_') : 'coords';
      return `${city}_${lat}_${lon}`;
    }
    if (location.city) {
      return normaliseString(location.city).replace(/\s+/g, '_');
    }
  }
  return 'default_loc';
}

export function generatePriceCacheKey(platform, itemName, quantity = '', location = null) {
  const normPlatform = (platform || 'unknown').toLowerCase().trim();
  const normItem = normaliseString(itemName).replace(/\s+/g, '_') || 'item';
  
  const parsedQty = parseQuantity(quantity);
  const qtyStr = parsedQty ? `${parsedQty.type}_${parsedQty.value}` : (normaliseString(quantity).replace(/\s+/g, '_') || 'noqty');
  const locStr = generateLocationKey(location);

  const rawKey = `${normPlatform}__${normItem}__${qtyStr}__${locStr}`;
  // Sanitize for Firestore doc ID (no slashes, length limit)
  return rawKey.replace(/[/\\]/g, '_').substring(0, 500);
}

/**
 * Reads from Firestore price_cache
 */
export async function getPriceFromPersistentCache(db, platform, itemName, quantity, location, maxAgeMs = PRICE_CACHE_TTL_MS) {
  if (!db) return null;
  const key = generatePriceCacheKey(platform, itemName, quantity, location);
  
  try {
    const docSnap = await db.collection('price_cache').doc(key).get();
    if (!docSnap.exists) return null;

    const data = docSnap.data();
    const fetchedAt = data.fetched_at ? (data.fetched_at.toDate ? data.fetched_at.toDate() : new Date(data.fetched_at)) : null;
    if (!fetchedAt || isNaN(fetchedAt.getTime())) return null;

    const age = Date.now() - fetchedAt.getTime();
    const isStale = age > maxAgeMs;

    return {
      data,
      fetchedAt,
      age,
      isStale,
      isFresh: !isStale
    };
  } catch (err) {
    console.warn(`[PriceCache] Error reading cache for ${key}:`, err.message || err);
    return null;
  }
}

/**
 * Writes fresh price result to Firestore price_cache
 */
export async function savePriceToPersistentCache(db, platform, itemName, quantity, location, formattedProduct) {
  if (!db || !formattedProduct) return;
  const key = generatePriceCacheKey(platform, itemName, quantity, location);

  try {
    const cacheDoc = {
      platform,
      item_name: itemName,
      requested_quantity: quantity || '',
      location_key: generateLocationKey(location),
      found: formattedProduct.found !== false && formattedProduct.price !== null,
      price: formattedProduct.price,
      original_price: formattedProduct.original_price || null,
      product_name: formattedProduct.product_name || itemName,
      product_image: formattedProduct.product_image || formattedProduct.image || null,
      brand: formattedProduct.brand || null,
      unit: formattedProduct.unit || null,
      product_url: formattedProduct.product_url || null,
      matched_quantity: formattedProduct.matched_quantity || null,
      match_score: formattedProduct.match_score || 0,
      quantityMatched: formattedProduct.quantityMatched || false,
      available: formattedProduct.available !== undefined ? formattedProduct.available : true,
      fetched_at: admin.firestore.FieldValue.serverTimestamp()
    };

    await db.collection('price_cache').doc(key).set(cacheDoc, { merge: true });
  } catch (err) {
    console.warn(`[PriceCache] Error writing cache for ${key}:`, err.message || err);
  }
}
