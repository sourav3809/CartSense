/**
 * Product Matching & Normalization Engine for CartSense
 * Handles exact/fuzzy name matching, brand adherence, category exclusion,
 * quantity normalization, and in-stock prioritization across Blinkit, Zepto, and Instamart.
 */

export const KNOWN_BRANDS = [
  'harvest gold',
  'amul',
  'mother dairy',
  'britannia',
  'aashirvaad',
  'the baker\'s dozen',
  'the bakers dozen',
  'nestle',
  'lays',
  'haldiram',
  'safal',
  'id fresh',
  'id',
  'nandini',
  'fortune',
  'saffola',
  'tata sampann',
  'tata tea',
  'epigamia',
  'country delight',
  'milton',
  'dabur'
];

export const CATEGORY_RULES = [
  {
    name: 'bread',
    trigger: ['bread'],
    exclusions: ['garlic bread', 'bun', 'pav', 'breadstick', 'toast', 'rusk']
  },
  {
    name: 'milk',
    trigger: ['milk'],
    exclusions: ['powder', 'chocolate', 'cheese', 'condensed', 'shake', 'almond milk', 'soya milk', 'paneer']
  },
  {
    name: 'potato',
    trigger: ['potato', 'aloo'],
    exclusions: ['chips', 'chip', 'masala', 'fries', 'french fries', 'namkeen', 'bhujia']
  },
  {
    name: 'butter',
    trigger: ['butter'],
    exclusions: ['peanut butter', 'cookie', 'biscuit', 'cake', 'buttermilk']
  },
  {
    name: 'egg',
    trigger: ['egg', 'eggs'],
    exclusions: ['eggless', 'roll', 'curry', 'mayo', 'mayonnaise']
  }
];

export function normaliseString(str) {
  if (!str) return '';
  return str
    .toLowerCase()
    .replace(/[.,/#!$%^&*;:{}=\-_`~()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Normalizes an item name handling common Hindi transliterations,
 * pack sizes, brand prefixes, and special characters cleanly.
 */
export function normalizeItemName(str) {
  if (!str) return '';
  let cleaned = normaliseString(str);

  const transliterations = {
    'doodh': 'milk',
    'dudh': 'milk',
    'aloo': 'potato',
    'alu': 'potato',
    'dahi': 'curd',
    'atta': 'flour',
    'chawal': 'rice',
    'cheeni': 'sugar',
    'pyaaz': 'onion'
  };

  const words = cleaned.split(' ');
  const normalizedWords = words.map(w => transliterations[w] || w);
  return normalizedWords.join(' ').trim();
}

export function tokeniseString(str) {
  const norm = normaliseString(str);
  return norm.split(/\s+/).filter(Boolean);
}

export function parseQuantity(str) {
  if (!str) return null;
  const normalized = str.toLowerCase().trim();

  // Look for weight, volume, or count patterns
  const numberRegex = /(\d+(?:\.\d+)?)\s*(kg|kilo|kilogram|kilograms|gms|gm|g|grams|ml|millilitre|millilitres|milliliter|milliliters|l|ltr|ltrs|liter|liters|litre|litres|pcs|pieces|pack|pouch|pk|units?|tablets?|capsules?)\b/gi;
  const matches = [...normalized.matchAll(numberRegex)];
  if (matches.length === 0) return null;

  // 1. Weight or Volume
  for (const match of matches) {
    const val = parseFloat(match[1]);
    const unit = (match[2] || '').toLowerCase().trim();
    if (['kg', 'kilo', 'kilogram', 'kilograms'].includes(unit)) {
      return { value: val * 1000, type: 'weight', standardUnit: 'g' };
    }
    if (['g', 'gm', 'gms', 'grams'].includes(unit)) {
      return { value: val, type: 'weight', standardUnit: 'g' };
    }
    if (['l', 'ltr', 'ltrs', 'liter', 'liters', 'litre', 'litres'].includes(unit)) {
      return { value: val * 1000, type: 'volume', standardUnit: 'ml' };
    }
    if (['ml', 'millilitre', 'millilitres', 'milliliter', 'milliliters'].includes(unit)) {
      return { value: val, type: 'volume', standardUnit: 'ml' };
    }
  }

  // 2. Count
  for (const match of matches) {
    const val = parseFloat(match[1]);
    const unit = (match[2] || '').toLowerCase().trim();
    if (['pcs', 'pieces', 'pack', 'pouch', 'pk', 'unit', 'units'].includes(unit)) {
      return { value: val, type: 'count', standardUnit: 'pcs' };
    }
  }

  const firstVal = parseFloat(matches[0][1]);
  return { value: firstVal, type: 'unknown', standardUnit: 'unknown' };
}

export function quantitiesMatch(q1, q2) {
  if (!q1 || !q2) return false;
  if (q1.type !== q2.type) return false;
  return Math.abs(q1.value - q2.value) < 0.01 * q1.value;
}

export function getProductQuantity(product, platform) {
  if (!product) return null;
  if (platform === 'blinkit') {
    let q = parseQuantity(product.unit);
    if (q) return q;
    q = parseQuantity(product.product_name || product.name);
    if (q) return q;
  } else if (platform === 'zepto') {
    let q = parseQuantity(product.formatted_packsize);
    if (q) return q;
    if (product.weight_in_gms) {
      return { value: parseFloat(product.weight_in_gms), type: 'weight', standardUnit: 'g' };
    }
    if (product.packsize) {
      const uom = (product.unit_of_measure || '').toLowerCase();
      if (uom.includes('gram') || uom.includes('gm') || uom === 'g') {
        return { value: parseFloat(product.packsize), type: 'weight', standardUnit: 'g' };
      }
      if (uom.includes('litre') || uom.includes('liter') || uom.includes('ml') || uom === 'l') {
        return parseQuantity(`${product.packsize} ${product.unit_of_measure}`);
      }
    }
    q = parseQuantity(product.name || product.product_name);
    if (q) return q;
  } else { // instamart / other
    let q = parseQuantity(product.pack_size || product.quantity || product.unit || product.weight);
    if (q) return q;
    q = parseQuantity(product.name || product.product_name || product.title);
    if (q) return q;
  }
  return null;
}

export function detectBrand(name) {
  if (!name) return null;
  const norm = name.toLowerCase();
  for (const brand of KNOWN_BRANDS) {
    if (norm.includes(brand)) {
      return brand;
    }
  }
  return null;
}

export function isProductAvailable(prod, platform) {
  if (!prod) return false;
  if (platform === 'blinkit') {
    if (prod.in_stock === false || prod.available === false || prod.out_of_stock === true) {
      return false;
    }
    return true;
  } else if (platform === 'zepto') {
    if (prod.is_available === false || prod.out_of_stock === true || prod.available === false) {
      return false;
    }
    return true;
  } else { // instamart
    if (prod.in_stock === false || prod.out_of_stock === true || prod.available === false) {
      return false;
    }
    return true;
  }
}

export function computeMatchScore(name, requestedName, candidateBrand, qReq, parsedQty, categoryMatches) {
  const candNorm = normaliseString(name);
  const reqNorm = normaliseString(requestedName);

  if (candNorm === reqNorm) {
    return 1000;
  }

  const candTokens = tokeniseString(name);
  const reqTokens = tokeniseString(requestedName);

  if (reqTokens.length === 0) return 0;

  let overlapCount = 0;
  for (const token of reqTokens) {
    if (candTokens.includes(token)) {
      overlapCount++;
    } else if (candTokens.some(ct => ct.includes(token) || token.includes(ct))) {
      overlapCount += 0.5;
    }
  }

  const overlapRatio = overlapCount / reqTokens.length;
  let score = overlapRatio * 100;

  if (candNorm.includes(reqNorm)) {
    score += 50;
  }
  if (candNorm.startsWith(reqNorm)) {
    score += 30;
  }
  if (reqNorm.includes(candNorm)) {
    score += 20;
  }

  const reqBrand = detectBrand(requestedName);
  if (reqBrand) {
    const candBrandLower = (candidateBrand || '').toLowerCase();
    if (candBrandLower.includes(reqBrand) || candNorm.includes(reqBrand)) {
      score += 40;
    }
  }

  if (quantitiesMatch(qReq, parsedQty)) {
    score += 50;
  }
  if (categoryMatches) {
    score += 30;
  }

  return score;
}

export function findBestMatchingProduct(products, requestedName, requestedQuantity, platform) {
  if (!products || products.length === 0) return null;

  const qReq = parseQuantity(requestedQuantity);
  const reqBrand = detectBrand(requestedName);
  
  let reqCategory = null;
  for (const rule of CATEGORY_RULES) {
    const hasTrigger = rule.trigger.some(t => requestedName.toLowerCase().includes(t));
    const hasExclusion = rule.exclusions.some(e => requestedName.toLowerCase().includes(e));
    if (hasTrigger && !hasExclusion) {
      reqCategory = rule.name;
      break;
    }
  }

  const candidates = [];

  for (let idx = 0; idx < products.length; idx++) {
    const prod = products[idx];
    const name = platform === 'blinkit'
      ? (prod.product_name || prod.name)
      : platform === 'zepto'
        ? (prod.name || prod.product_name)
        : (prod.name || prod.product_name || prod.title);
    
    if (!name) continue;

    const price = platform === 'blinkit'
      ? prod.price
      : platform === 'zepto'
        ? prod.selling_price
        : (prod.price || prod.offer_price || prod.selling_price);

    const origPrice = platform === 'blinkit'
      ? prod.original_price
      : platform === 'zepto'
        ? prod.mrp
        : (prod.mrp || prod.original_price || prod.price);

    const parsedQty = getProductQuantity(prod, platform);
    const candNameLower = name.toLowerCase();

    // 1. Strict Brand Rejection: If user explicitly requested a brand, candidate must match it!
    if (reqBrand) {
      const candBrandLower = (prod.brand || '').toLowerCase();
      const hasBrand = candNameLower.includes(reqBrand) || candBrandLower.includes(reqBrand);
      if (!hasBrand) {
        continue;
      }
    }

    // 2. Category validation: Prevent Potato chips / french fries matching fresh potato, etc.
    if (reqCategory) {
      let candCategory = null;
      for (const rule of CATEGORY_RULES) {
        const hasTrigger = rule.trigger.some(t => candNameLower.includes(t));
        const hasExclusion = rule.exclusions.some(e => candNameLower.includes(e));
        if (hasTrigger && !hasExclusion) {
          candCategory = rule.name;
          break;
        }
      }
      if (candCategory !== reqCategory) {
        continue;
      }
    }

    // 3. Substring / Token Overlap
    const candNorm = normaliseString(name);
    const reqNorm = normaliseString(requestedName);
    const candTokens = tokeniseString(name);
    const reqTokens = tokeniseString(requestedName);

    if (reqTokens.length === 0) continue;

    let overlapCount = 0;
    for (const token of reqTokens) {
      if (candTokens.includes(token)) {
        overlapCount++;
      } else if (candTokens.some(ct => ct.includes(token) || token.includes(ct))) {
        overlapCount += 0.5;
      }
    }

    const overlapRatio = overlapCount / reqTokens.length;
    if (overlapRatio < 0.35 && !candNorm.includes(reqNorm)) {
      continue;
    }

    const available = isProductAvailable(prod, platform);
    const score = computeMatchScore(name, requestedName, prod.brand, qReq, parsedQty, reqCategory !== null);

    candidates.push({
      product: prod,
      name,
      price: typeof price === 'number' ? price : parseFloat(price) || null,
      original_price: typeof origPrice === 'number' ? origPrice : parseFloat(origPrice) || null,
      parsedQty,
      score,
      available,
      originalIndex: idx
    });
  }

  if (candidates.length === 0) return null;

  // Prefer in-stock candidates
  const inStockCandidates = candidates.filter(c => c.available);
  const pool = inStockCandidates.length > 0 ? inStockCandidates : candidates;

  let quantityMatches = [];
  if (qReq) {
    quantityMatches = pool.filter(c => quantitiesMatch(c.parsedQty, qReq));
  }

  if (quantityMatches.length > 0) {
    quantityMatches.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.price !== b.price) {
        if (a.price === null) return 1;
        if (b.price === null) return -1;
        return a.price - b.price;
      }
      return a.originalIndex - b.originalIndex;
    });
    return { ...quantityMatches[0], quantityMatched: true };
  }

  pool.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.price !== b.price) {
      if (a.price === null) return 1;
      if (b.price === null) return -1;
      return a.price - b.price;
    }
    return a.originalIndex - b.originalIndex;
  });

  return { ...pool[0], quantityMatched: false };
}

/**
 * Filter candidate products by availability and exclusion rules (category conflicts,
 * contrasting modifiers like toned vs full cream, brown vs white bread).
 */
export function filterCandidatesByExclusions(candidates = [], requestedName = '', platform = 'blinkit') {
  if (!Array.isArray(candidates)) return [];
  const reqLower = requestedName.toLowerCase().trim();
  const reqBrand = detectBrand(requestedName);

  return candidates.filter(prod => {
    // 1. Availability check: out-of-stock items must be rejected
    if (!isProductAvailable(prod, platform)) return false;

    const name = (platform === 'blinkit'
      ? (prod.product_name || prod.name)
      : platform === 'zepto'
        ? (prod.name || prod.product_name)
        : (prod.name || prod.product_name || prod.title) || '').toLowerCase();

    // 2. Strict brand constraint if brand is requested
    if (reqBrand) {
      const candBrand = (prod.brand || '').toLowerCase();
      if (!name.includes(reqBrand) && !candBrand.includes(reqBrand)) {
        return false;
      }
    }

    // 3. Contrast modifier hard constraints
    // Milk types
    if (reqLower.includes('toned') && !reqLower.includes('double toned')) {
      if (name.includes('full cream') || name.includes('gold') || name.includes('buffalo')) return false;
    }
    if (reqLower.includes('full cream') || reqLower.includes('whole milk')) {
      if (name.includes('toned') || name.includes('skimmed') || name.includes('cow milk')) return false;
    }

    // Bread types
    if (reqLower.includes('brown bread') || (reqLower.includes('brown') && reqLower.includes('bread'))) {
      if (name.includes('white bread') || name.includes('white sandwich')) return false;
    }
    if (reqLower.includes('white bread') || (reqLower.includes('white') && reqLower.includes('bread'))) {
      if (name.includes('brown bread') || name.includes('multigrain') || name.includes('atta bread')) return false;
    }

    // Category exclusions from CATEGORY_RULES
    for (const rule of CATEGORY_RULES) {
      const hasTrigger = rule.trigger.some(t => reqLower.includes(t));
      if (hasTrigger) {
        const hasExclusion = rule.exclusions.some(e => name.includes(e));
        if (hasExclusion && !rule.exclusions.some(e => reqLower.includes(e))) {
          return false;
        }
      }
    }

    return true;
  });
}

/**
 * Score, rank, and select best match from candidate pool.
 * Penalizes pack size mismatches, respects availability, and returns null when no candidate meets threshold.
 */
export function scoreAndSelectBestMatch(candidates, requestedName, requestedQuantity, platform = 'blinkit') {
  const filtered = filterCandidatesByExclusions(candidates, requestedName, platform);
  if (!filtered || filtered.length === 0) return null;
  return findBestMatchingProduct(filtered, requestedName, requestedQuantity, platform);
}

export function formatMatchedProduct(bestMatch, requestedItem, platform) {
  const reqName = typeof requestedItem === 'string' ? requestedItem : (requestedItem?.item_name || requestedItem?.name || '');
  if (!bestMatch) {
    return {
      name: reqName,
      found: false,
      price: null,
      original_price: null,
      product_name: null,
      brand: null,
      image: null,
      product_image: null,
      product_url: null,
      available: false,
      match_score: 0,
      quantityMatched: false
    };
  }

  const prod = bestMatch.product;
  const product_name = bestMatch.name;
  const brand = prod.brand || null;
  const unit = platform === 'blinkit' 
    ? (prod.unit || null) 
    : platform === 'zepto'
      ? (prod.formatted_packsize || (prod.packsize ? `${prod.packsize} ${prod.unit_of_measure || ''}` : null))
      : (prod.pack_size || prod.quantity || prod.unit || null);
  
  const available = bestMatch.available !== undefined ? bestMatch.available : isProductAvailable(prod, platform);
  const product_image = platform === 'blinkit'
    ? (prod.product_image || null)
    : platform === 'zepto'
      ? (prod.image_url || null)
      : (prod.image || prod.image_url || prod.product_image || null);

  const product_url = platform === 'blinkit' ? (prod.product_url || null) : (prod.product_url || prod.url || null);
  
  const matched_quantity = bestMatch.parsedQty 
    ? (bestMatch.parsedQty.type === 'weight' ? `${bestMatch.parsedQty.value}g` : bestMatch.parsedQty.type === 'volume' ? `${bestMatch.parsedQty.value}ml` : `${bestMatch.parsedQty.value}pcs`)
    : null;

  return {
    name: reqName,
    found: true,
    price: bestMatch.price,
    original_price: bestMatch.original_price,
    product_name,
    product_image,
    image: product_image,
    brand,
    unit,
    "quantity/unit": unit,
    product_url,
    matched_quantity,
    match_score: bestMatch.score,
    quantityMatched: bestMatch.quantityMatched,
    available
  };
}
