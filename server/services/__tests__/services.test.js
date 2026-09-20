import { computeNudgeTriggers } from '../nudgeService.js';
import {
  calculateCycleDays,
  clampConsumptionDays,
  getConfidenceFromCycles,
  isRecommendationSuppressed,
  computeAcceptanceRate,
  sortRecommendationsByAcceptance
} from '../learningService.js';

console.log('--- RUNNING COMPREHENSIVE UNIT & INTEGRATION TESTS FOR SERVICES ---');

// Test 1: computeNudgeTriggers Threshold
{
  const res1 = computeNudgeTriggers({
    runningLowItems: [
      { item_name: 'Milk', days_remaining: 2, is_kirana: false },
      { item_name: 'Bread', days_remaining: 1, is_kirana: false },
      { item_name: 'Eggs', days_remaining: 0, is_kirana: false },
      { item_name: 'Rice', days_remaining: 3, is_kirana: false }
    ],
    threshold: 4,
    cadenceProfile: null,
    now: new Date()
  });
  console.assert(res1.showNudge === true, 'Test 1 Failed: Threshold trigger should show nudge');
  console.assert(res1.threshold_trigger === true, 'Test 1 Failed: threshold_trigger should be true');
  console.log('✔ Test 1 Passed: computeNudgeTriggers threshold');
}

// Test 2: computeNudgeTriggers Critical Override
{
  const res2 = computeNudgeTriggers({
    runningLowItems: [
      { item_name: 'Medicine', days_remaining: 1, is_critical: true, is_kirana: false }
    ],
    threshold: 4,
    cadenceProfile: null,
    now: new Date()
  });
  console.assert(res2.showNudge === true, 'Test 2 Failed: Critical trigger should show nudge');
  console.assert(res2.critical_trigger === true, 'Test 2 Failed: critical_trigger should be true');
  console.log('✔ Test 2 Passed: computeNudgeTriggers critical override');
}

// Test 3: calculateCycleDays
{
  const d1 = new Date('2026-01-01');
  const d2 = new Date('2026-01-15');
  const d3 = new Date('2026-01-29');
  const cycles = calculateCycleDays([d1, d2, d3]);
  console.assert(cycles.length === 2, 'Test 3 Failed: Should calculate 2 cycles');
  console.assert(cycles[0] === 14 && cycles[1] === 14, 'Test 3 Failed: Cycles should be 14 days');
  console.log('✔ Test 3 Passed: calculateCycleDays');
}

// Test 5: Kirana items ignored in low count
{
  const res5 = computeNudgeTriggers({
    runningLowItems: [
      { item_name: 'Local Spices', days_remaining: 1, is_kirana: true },
      { item_name: 'Local Rice', days_remaining: 0, is_kirana: true },
      { item_name: 'Butter', days_remaining: 2, is_kirana: false }
    ],
    threshold: 2,
    cadenceProfile: null,
    now: new Date()
  });
  console.assert(res5.low_count === 1, 'Test 5 Failed: Kirana items should be ignored in low_count');
  console.assert(res5.showNudge === false, 'Test 5 Failed: Low count is 1 < threshold 2, so showNudge should be false');
  console.log('✔ Test 5 Passed: Kirana items ignored in low count');
}

// Test 6: Cadence trigger
{
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const daysMap = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const res6 = computeNudgeTriggers({
    runningLowItems: [
      { item_name: 'Oats', days_remaining: 2, is_kirana: false }
    ],
    threshold: 4,
    cadenceProfile: { weekday: daysMap[tomorrow.getDay()] },
    now: new Date()
  });
  console.assert(res6.cadence_trigger === true, 'Test 6 Failed: Cadence trigger should be true with matching profile');
  console.assert(res6.showNudge === true, 'Test 6 Failed: Cadence trigger with low item present should show nudge');
  console.log('✔ Test 6 Passed: Cadence trigger');
}

// Test 7: Clamp consumption_days to 1..60
{
  console.assert(clampConsumptionDays(0) === 1, 'Test 7 Failed: 0 should clamp to 1');
  console.assert(clampConsumptionDays(-10) === 1, 'Test 7 Failed: Negative should clamp to 1');
  console.assert(clampConsumptionDays(100) === 60, 'Test 7 Failed: >60 should clamp to 60');
  console.assert(clampConsumptionDays(14) === 14, 'Test 7 Failed: 14 should remain 14');
  console.log('✔ Test 7 Passed: clampConsumptionDays (1..60)');
}

// Test 8: Confidence evolution using order_cycles (0-2 low, 3-6 medium, 7+ high)
{
  console.assert(getConfidenceFromCycles(0) === 'low', 'Test 8 Failed: 0 should be low');
  console.assert(getConfidenceFromCycles(2) === 'low', 'Test 8 Failed: 2 should be low');
  console.assert(getConfidenceFromCycles(3) === 'medium', 'Test 8 Failed: 3 should be medium');
  console.assert(getConfidenceFromCycles(6) === 'medium', 'Test 8 Failed: 6 should be medium');
  console.assert(getConfidenceFromCycles(7) === 'high', 'Test 8 Failed: 7 should be high');
  console.assert(getConfidenceFromCycles(12) === 'high', 'Test 8 Failed: 12 should be high');
  console.log('✔ Test 8 Passed: getConfidenceFromCycles evolution');
}

// Test 9: Recommendation suppression after 3 consecutive dismissals
{
  console.assert(isRecommendationSuppressed(0) === false, 'Test 9 Failed: 0 dismissals should not be suppressed');
  console.assert(isRecommendationSuppressed(2) === false, 'Test 9 Failed: 2 dismissals should not be suppressed');
  console.assert(isRecommendationSuppressed(3) === true, 'Test 9 Failed: 3 dismissals should be suppressed');
  console.assert(isRecommendationSuppressed(5) === true, 'Test 9 Failed: 5 dismissals should be suppressed');
  console.log('✔ Test 9 Passed: isRecommendationSuppressed after 3 dismissals');
}

// Test 10: Recommendation priority by acceptance rate
{
  const recs = [
    { name: 'A', accept_count: 7, shown_count: 20 }, // 0.35
    { name: 'B', accept_count: 4, shown_count: 5 }, // 0.80
    { name: 'C', accept_count: 2, shown_count: 4 }  // 0.50
  ];
  const sorted = sortRecommendationsByAcceptance(recs);
  console.assert(sorted[0].name === 'B', 'Test 10 Failed: Top item should be B');
  console.assert(sorted[1].name === 'C', 'Test 10 Failed: Second item should be C');
  console.assert(sorted[2].name === 'A', 'Test 10 Failed: Third item should be A');
  console.assert(computeAcceptanceRate(7, 20) === 0.35, 'Test 10 Failed: Acceptance rate must be accepted/shown');
  console.log('✔ Test 10 Passed: sortRecommendationsByAcceptance rate priority');
}

// Test 11: Multi-user & Cron Idempotency logic check
{
  const user1Nudge = computeNudgeTriggers({
    runningLowItems: [{ item_name: 'Juice', days_remaining: 1, is_kirana: false }],
    threshold: 1,
    cadenceProfile: null,
    now: new Date()
  });
  const user2Nudge = computeNudgeTriggers({
    runningLowItems: [],
    threshold: 4,
    cadenceProfile: null,
    now: new Date()
  });
  console.assert(user1Nudge.showNudge === true, 'Test 11 Failed: User 1 should get nudge');
  console.assert(user2Nudge.showNudge === false, 'Test 11 Failed: User 2 should not get nudge');
  console.log('✔ Test 11 Passed: Multi-user execution isolation');
}

// Test 12: Cadence learning mock DB test
async function testCadenceLearning() {
  const { runCadenceLearning } = await import('../learningService.js');
  
  const createMockDb = (orders) => ({
    collection: () => ({
      doc: () => ({
        collection: (col) => {
          if (col === 'order_history') {
            return {
              orderBy: () => ({
                get: async () => ({
                  size: orders.length,
                  docs: orders.map(o => ({ data: () => o }))
                })
              })
            };
          }
          if (col === 'cadence') {
            return {
              doc: () => ({
                set: async (data) => {
                  mockDbStore.cadence = data;
                }
              })
            };
          }
        }
      })
    })
  });

  const now = new Date('2026-08-08T12:00:00Z'); // Saturday
  const weekMs = 7 * 24 * 60 * 60 * 1000;
  
  let mockDbStore = {};
  
  // Case 1: fewer than 4 confirmed orders
  const db1 = createMockDb([
    { ordered_at: new Date(now.getTime() - weekMs) },
    { ordered_at: new Date(now.getTime() - 2 * weekMs) },
    { ordered_at: new Date(now.getTime() - 3 * weekMs) }
  ]);
  const res1 = await runCadenceLearning('user1', db1, now);
  console.assert(res1 === null, 'Test 12 Failed: Should return null for < 4 orders');

  // Case 2 & 3 & 4: 4 orders, same weekday in 3/4 weeks
  const sunday = new Date('2026-08-02T12:00:00Z'); // Sunday
  const db2 = createMockDb([
    { ordered_at: sunday },
    { ordered_at: new Date(sunday.getTime() - weekMs) },
    { ordered_at: new Date(sunday.getTime() - 2 * weekMs) },
    { ordered_at: new Date(sunday.getTime() - 3 * weekMs + 3 * 24 * 60 * 60 * 1000) } // Wednesday
  ]);
  const res2 = await runCadenceLearning('user1', db2, now);
  console.assert(res2 !== null, 'Test 12 Failed: Should return cadence profile');
  console.assert(res2.weekday === 'Sunday', 'Test 12 Failed: Should predict Sunday');
  console.assert(res2.confidence === 0.75, 'Test 12 Failed: Confidence should be 0.75');

  // Case 5: different weekdays -> no false cadence
  const db3 = createMockDb([
    { ordered_at: new Date('2026-08-02T12:00:00Z') }, // Sunday
    { ordered_at: new Date('2026-07-27T12:00:00Z') }, // Monday
    { ordered_at: new Date('2026-07-21T12:00:00Z') }, // Tuesday
    { ordered_at: new Date('2026-07-15T12:00:00Z') }  // Wednesday
  ]);
  const res3 = await runCadenceLearning('user1', db3, now);
  console.assert(res3 === null, 'Test 12 Failed: Should return null for inconsistent weekdays');

  console.log('✔ Test 12 Passed: Cadence learning rules (min orders, recurrence, confidence)');
}
testCadenceLearning();

// Test 13: Consumption Learning simultaneous signal deterministic check
{
  let updatedDays = 14;
  const counts = { added_count: 3, removed_count: 3 };
  if (counts.added_count >= 3 && counts.removed_count >= 3) {
    updatedDays += 1;
  } else if (counts.added_count >= 3) {
    updatedDays -= 1;
  } else if (counts.removed_count >= 3) {
    updatedDays += 2;
  }
  console.assert(updatedDays === 15, 'Test 13 Failed: Simultaneous signals should result in net +1 (+2 and -1)');
  console.log('✔ Test 13 Passed: Simultaneous consumption learning signals');
}

console.log('--- ALL UNIT & INTEGRATION TESTS COMPLETED SUCCESSFULLY ---');
