import axios from 'axios';
import admin from 'firebase-admin';
import {
  findBestMatchingProduct,
  formatMatchedProduct,
  normaliseString
} from './priceMatching.js';
import {
  getPriceFromPersistentCache,
  savePriceToPersistentCache,
  generateLocationKey,
  PRICE_CACHE_TTL_MS
} from './priceCacheService.js';

// In-flight promise cache to deduplicate simultaneous requests
const activeProviderRequests = {};

export const CITY_COORDINATES = {
  'delhi': { latitude: 28.6448, longitude: 77.2167 },
  'new delhi': { latitude: 28.6139, longitude: 77.2090 },
  'gurgaon': { latitude: 28.4595, longitude: 77.0266 },
  'gurugram': { latitude: 28.4595, longitude: 77.0266 },
  'noida': { latitude: 28.5355, longitude: 77.3910 },
  'bengaluru': { latitude: 12.9716, longitude: 77.5946 },
  'bangalore': { latitude: 12.9716, longitude: 77.5946 },
  'mumbai': { latitude: 19.0760, longitude: 72.8777 },
  'hyderabad': { latitude: 17.3850, longitude: 78.4867 },
  'kolkata': { latitude: 22.5726, longitude: 88.3639 },
  'pune': { latitude: 18.5204, longitude: 73.8567 },
  'chennai': { latitude: 13.0827, longitude: 80.2707 },
  'ahmedabad': { latitude: 23.0225, longitude: 72.5714 }
};

export function resolveUserLocation(userProfile = {}) {
  if (userProfile.latitude && userProfile.longitude) {
    return {
      latitude: parseFloat(userProfile.latitude),
      longitude: parseFloat(userProfile.longitude),
      city: userProfile.city || 'custom'
    };
  }

  if (userProfile.city) {
    const normCity = userProfile.city.toLowerCase().trim();
    if (CITY_COORDINATES[normCity]) {
      return {
        ...CITY_COORDINATES[normCity],
        city: userProfile.city
      };
    }
  }

  // Fallback to default
  return {
    latitude: 28.6448,
    longitude: 77.2167,
    city: userProfile.city || 'Delhi'
  };
}

export async function fetchSingleItemFromProvider(platform, itemName, location = null) {
  const actorId = process.env[`APIFY_${platform.toUpperCase()}_ACTOR_ID`];
  const apiToken = process.env.APIFY_API_TOKEN;

  if (!actorId || !apiToken) {
    console.warn(`[PriceComparison] Apify actor configuration missing for ${platform}`);
    return null;
  }

  const coords = resolveUserLocation(location);

  let input;
  if (platform === 'blinkit') {
    input = {
      latitude: coords.latitude,
      longitude: coords.longitude,
      results_wanted: 3,
      search_query: itemName,
      setGeolocation: true,
      search_url: '',
      proxyConfiguration: {
        useApifyProxy: true,
        apifyProxyGroups: ['RESIDENTIAL']
      }
    };
  } else if (platform === 'zepto') {
    input = {
      max_pages: 1,
      query: itemName,
      results_wanted: 3,
      startUrl: '',
      latitude: coords.latitude,
      longitude: coords.longitude,
      proxyConfiguration: {
        useApifyProxy: false
      }
    };
  } else if (platform === 'instamart') {
    input = {
      query: itemName,
      search_query: itemName,
      latitude: coords.latitude,
      longitude: coords.longitude,
      results_wanted: 3,
      max_items: 3,
      proxyConfiguration: {
        useApifyProxy: true
      }
    };
  } else {
    return null;
  }

  try {
    const response = await axios.post(
      `https://api.apify.com/v2/acts/${actorId}/run-sync-get-dataset-items?token=${apiToken}`,
      input,
      { timeout: 25000 }
    );

    const scrapedItems = Array.isArray(response.data) ? response.data : [];
    return scrapedItems;
  } catch (err) {
    console.error(`[PriceComparison] Provider fetch failed for ${platform} - "${itemName}":`, err.message);
    return null;
  }
}

/**
 * Authoritative Multi-Platform Price Comparison (Blinkit, Zepto, Instamart)
 */
export async function comparePricesAcrossPlatforms({
  items = [],
  userProfile = {},
  forceRefresh = false,
  db = admin.firestore()
}) {
  const parsedItems = (items || []).map(it => {
    if (typeof it === 'string') {
      return { item_name: it, quantity: '' };
    } else if (it && typeof it === 'object') {
      return {
        item_name: it.item_name || it.name || '',
        quantity: it.quantity || ''
      };
    }
    return null;
  }).filter(it => it && it.item_name);

  const location = resolveUserLocation(userProfile);
  const platforms = ['blinkit', 'zepto', 'instamart'];
  const platformResults = {};

  const platformPromises = platforms.map(async (platform) => {
    try {
      const itemsList = new Array(parsedItems.length);
      const misses = [];
      let anyFreshFetch = false;
      let oldestCacheTimestamp = null;
      const staleFallbacks = [];

      // 1. Read persistent cache in Firestore
      const cacheChecks = parsedItems.map(async (parsedItem, idx) => {
        if (forceRefresh === true) {
          anyFreshFetch = true;
          misses.push({ index: idx, parsedItem });
          return;
        }

        try {
          const cacheResult = await getPriceFromPersistentCache(
            db,
            platform,
            parsedItem.item_name,
            parsedItem.quantity,
            location,
            PRICE_CACHE_TTL_MS
          );

          if (cacheResult && cacheResult.isFresh) {
            const data = cacheResult.data;
            const fetchedDate = cacheResult.fetchedAt;
            if (fetchedDate && (!oldestCacheTimestamp || fetchedDate < oldestCacheTimestamp)) {
              oldestCacheTimestamp = fetchedDate;
            }

            itemsList[idx] = {
              name: parsedItem.item_name,
              found: data.found !== undefined ? data.found : (data.price !== null),
              price: data.price,
              original_price: data.original_price || null,
              product_name: data.product_name || parsedItem.item_name,
              product_image: data.product_image || null,
              image: data.product_image || null,
              brand: data.brand || null,
              unit: data.unit || null,
              'quantity/unit': data.unit || null,
              product_url: data.product_url || null,
              matched_quantity: data.matched_quantity || null,
              match_score: data.match_score || 0,
              quantityMatched: data.quantityMatched || false,
              available: data.available !== undefined ? data.available : (data.price !== null),
              isFromCache: true
            };
            return;
          } else if (cacheResult && cacheResult.isStale) {
            staleFallbacks.push({ index: idx, data: cacheResult.data });
          }
        } catch (cacheErr) {
          console.warn(`[PriceComparison] Cache read error for ${platform} - ${parsedItem.item_name}:`, cacheErr.message || cacheErr);
        }

        anyFreshFetch = true;
        misses.push({ index: idx, parsedItem });
      });

      await Promise.all(cacheChecks);

      // 2. Fetch misses concurrently
      if (misses.length > 0) {
        const fetchPromises = misses.map(async (miss) => {
          const { index, parsedItem } = miss;
          const locKey = generateLocationKey(location);
          const reqKey = `${platform}__${normaliseString(parsedItem.item_name)}__${normaliseString(parsedItem.quantity)}__${locKey}`;

          try {
            let rawItems;
            if (activeProviderRequests[reqKey]) {
              rawItems = await activeProviderRequests[reqKey];
            } else {
              activeProviderRequests[reqKey] = fetchSingleItemFromProvider(platform, parsedItem.item_name, location);
              try {
                rawItems = await activeProviderRequests[reqKey];
              } finally {
                delete activeProviderRequests[reqKey];
              }
            }

            if (rawItems && rawItems.length > 0) {
              const bestMatch = findBestMatchingProduct(rawItems, parsedItem.item_name, parsedItem.quantity, platform);
              const formatted = formatMatchedProduct(bestMatch, parsedItem, platform);
              itemsList[index] = formatted;

              // Save to persistent Firestore cache
              await savePriceToPersistentCache(db, platform, parsedItem.item_name, parsedItem.quantity, location, formatted);
            } else {
              // Check if stale fallback available
              const staleItem = staleFallbacks.find(s => s.index === index);
              if (staleItem) {
                itemsList[index] = {
                  ...staleItem.data,
                  name: parsedItem.item_name,
                  isStale: true
                };
              } else {
                itemsList[index] = formatMatchedProduct(null, parsedItem, platform);
              }
            }
          } catch (fetchErr) {
            console.warn(`[PriceComparison] Fetch error for ${platform} - ${parsedItem.item_name}:`, fetchErr.message || fetchErr);
            const staleItem = staleFallbacks.find(s => s.index === index);
            if (staleItem) {
              itemsList[index] = {
                ...staleItem.data,
                name: parsedItem.item_name,
                isStale: true
              };
            } else {
              itemsList[index] = formatMatchedProduct(null, parsedItem, platform);
            }
          }
        });

        await Promise.all(fetchPromises);
      }

      // Ensure every index has a response
      for (let i = 0; i < itemsList.length; i++) {
        if (!itemsList[i]) {
          itemsList[i] = formatMatchedProduct(null, parsedItems[i], platform);
        }
      }

      const isFromCache = !anyFreshFetch && oldestCacheTimestamp !== null;
      const lastUpdated = isFromCache ? oldestCacheTimestamp.toISOString() : new Date().toISOString();

      platformResults[platform] = {
        itemsList,
        isFromCache,
        lastUpdated
      };
    } catch (platformErr) {
      console.error(`[PriceComparison] Platform error for ${platform}:`, platformErr.message || platformErr);
      platformResults[platform] = {
        itemsList: parsedItems.map(parsedItem => formatMatchedProduct(null, parsedItem, platform)),
        isFromCache: false,
        lastUpdated: new Date().toISOString(),
        error: 'Service unavailable'
      };
    }
  });

  await Promise.all(platformPromises);

  // 3. Aggregate results and compute complete vs partial baskets
  const platformSummaries = {};
  const itemsRequested = parsedItems.length;

  for (const platform of platforms) {
    const platformData = platformResults[platform] || {};
    const platformItems = platformData.itemsList || [];

    const availableItems = platformItems.filter(i => i.found && i.price !== null && i.available !== false);
    const missingItems = platformItems.filter(i => !i.found || i.price === null || i.available === false);

    const itemsFound = availableItems.length;
    const itemsMissing = missingItems.length;

    const totalMatchedPrice = itemsFound === 0
      ? null
      : availableItems.reduce((sum, i) => sum + (i.price || 0), 0);

    const allItemsAvailable = itemsFound === itemsRequested && itemsRequested > 0;
    const partialMatch = itemsFound > 0 && itemsFound < itemsRequested;

    platformSummaries[platform] = {
      itemsRequested,
      itemsFound,
      itemsMissing,
      totalMatchedPrice,
      allItemsAvailable,
      partialMatch,
      availableItems,
      missingItems,
      items: platformItems,
      isFromCache: platformData.isFromCache || false,
      lastUpdated: platformData.lastUpdated || new Date().toISOString(),
      error: platformData.error || undefined
    };
  }

  // 4. Determine Recommended Platform
  const validPlatforms = platforms.filter(p => !platformSummaries[p].error && platformSummaries[p].itemsFound > 0);
  const completePlatforms = validPlatforms.filter(p => platformSummaries[p].allItemsAvailable);

  let recommendedPlatform = null;

  if (completePlatforms.length > 0) {
    // Choose cheapest complete basket
    completePlatforms.sort((a, b) => (platformSummaries[a].totalMatchedPrice || Infinity) - (platformSummaries[b].totalMatchedPrice || Infinity));
    recommendedPlatform = completePlatforms[0];
    
    platforms.forEach(p => {
      if (p === recommendedPlatform) {
        platformSummaries[p].recommended = true;
        platformSummaries[p].recommendationReason = 'Cheapest complete basket';
      } else if (platformSummaries[p].allItemsAvailable) {
        platformSummaries[p].recommended = false;
        platformSummaries[p].recommendationReason = 'Complete basket';
      } else if (platformSummaries[p].itemsFound > 0) {
        platformSummaries[p].recommended = false;
        platformSummaries[p].recommendationReason = 'Partial basket';
      } else if (platformSummaries[p].error) {
        platformSummaries[p].recommended = false;
        platformSummaries[p].recommendationReason = 'Service unavailable';
      } else {
        platformSummaries[p].recommended = false;
        platformSummaries[p].recommendationReason = 'No requested items found';
      }
    });
  } else if (validPlatforms.length > 0) {
    // Choose cheapest partial basket (sort by most items found desc, then totalMatchedPrice asc)
    validPlatforms.sort((a, b) => {
      const countDiff = platformSummaries[b].itemsFound - platformSummaries[a].itemsFound;
      if (countDiff !== 0) return countDiff;
      return (platformSummaries[a].totalMatchedPrice || Infinity) - (platformSummaries[b].totalMatchedPrice || Infinity);
    });

    recommendedPlatform = validPlatforms[0];

    platforms.forEach(p => {
      if (p === recommendedPlatform) {
        platformSummaries[p].recommended = true;
        platformSummaries[p].recommendationReason = 'Cheapest partial basket';
      } else if (platformSummaries[p].itemsFound > 0) {
        platformSummaries[p].recommended = false;
        platformSummaries[p].recommendationReason = 'Partial basket';
      } else if (platformSummaries[p].error) {
        platformSummaries[p].recommended = false;
        platformSummaries[p].recommendationReason = 'Service unavailable';
      } else {
        platformSummaries[p].recommended = false;
        platformSummaries[p].recommendationReason = 'No requested items found';
      }
    });
  } else {
    // All 0 items or all errored
    platforms.forEach(p => {
      platformSummaries[p].recommended = false;
      platformSummaries[p].recommendationReason = platformSummaries[p].error ? 'Service unavailable' : 'No requested items found';
    });
  }

  let availabilityMessage = '';
  const totalFoundAcrossAll = platforms.reduce((sum, p) => sum + platformSummaries[p].itemsFound, 0);
  if (totalFoundAcrossAll === 0 && itemsRequested > 0) {
    availabilityMessage = 'None of the requested products are currently available across supported grocery platforms.';
  }

  return {
    platforms: platformSummaries,
    recommendedPlatform,
    availabilityMessage,
    location: {
      city: location.city,
      latitude: location.latitude,
      longitude: location.longitude
    },
    cached_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + PRICE_CACHE_TTL_MS).toISOString()
  };
}
