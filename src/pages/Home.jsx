import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Settings, Plus, X, Sparkles, LineChart, Bell, Clock } from 'lucide-react';
import { db } from '../lib/firebase';
import { collection, getDocs, addDoc, serverTimestamp, doc, deleteDoc } from 'firebase/firestore';

import { motion, AnimatePresence } from 'motion/react';
import RunningLowCard from '../components/RunningLowCard';
import BottomSheet from '../components/BottomSheet';
import NavBar from '../components/NavBar';
import { trackEvent } from '../lib/analytics';
import { calculateRunningLowItems } from '../lib/runningLowLogic';

export default function Home() {
  const [allItems, setAllItems] = useState([]);
  const [runningLow, setRunningLow] = useState([]);
  const [recommendations, setRecommendations] = useState([]);
  const [captures, setCaptures] = useState([]);
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [nudge, setNudge] = useState(null);
  const [toast, setToast] = useState(null);
  const [snoozingNudge, setSnoozingNudge] = useState(false);
  
  const pendingRequestsRef = useRef(new Set());
  const exposureTrackedRef = useRef(new Set());
  const userId = localStorage.getItem('userId');

  const fetchData = async () => {
    if (!userId) return;
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayStr = today.toDateString();

      // 1. Fetch household items & today captures
      const [itemsSnap, capturesSnap] = await Promise.all([
        getDocs(collection(db, 'users', userId, 'household_items')),
        getDocs(collection(db, 'users', userId, 'daily_captures'))
      ]);

      const items = itemsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      setAllItems(items);

      const todayCaptures = capturesSnap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(c => {
          if (!c.captured_at) return true;
          const d = c.captured_at.toDate ? c.captured_at.toDate() : new Date(c.captured_at);
          return d.toDateString() === todayStr;
        });
      setCaptures(todayCaptures);

      // Canonical Running Low calculation
      const low = calculateRunningLowItems({
        householdItems: items,
        todayCaptures,
        now: today
      });
      setRunningLow(low);

      // 2. Fetch and calculate recommendation items
      try {
        const statsSnap = await getDocs(collection(db, 'users', userId, 'recommendation_stats'));
        const statsMap = {};
        statsSnap.forEach(doc => { statsMap[doc.id] = doc.data(); });
        
        let recs = items.filter(item => {
          if (item.suppressed || item.is_kirana) return false;
          
          const dismissedAt = item.dismissed_at ? (item.dismissed_at.toDate ? item.dismissed_at.toDate() : new Date(item.dismissed_at)) : null;
          const lastOrderedAt = item.last_ordered_at ? (item.last_ordered_at.toDate ? item.last_ordered_at.toDate() : new Date(item.last_ordered_at)) : null;
          const isDismissed = dismissedAt && (!lastOrderedAt || dismissedAt.getTime() >= lastOrderedAt.getTime());
          if (isDismissed) return false;

          const base = lastOrderedAt || (item.created_at ? (item.created_at.toDate ? item.created_at.toDate() : new Date(item.created_at)) : null);
          if (!base) return false;

          const consumptionDays = typeof item.consumption_days === 'number' ? item.consumption_days : 14;
          const dueDate = new Date(base.getTime() + consumptionDays * 86400000);
          dueDate.setHours(0, 0, 0, 0);

          const days_since_due = Math.floor((today.getTime() - dueDate.getTime()) / 86400000);
          const days_remaining = Math.floor((dueDate.getTime() - today.getTime()) / 86400000);

          // Overdue recommendation: due date passed (days_since_due >= 1) and not already in running low <= 3
          return days_since_due >= 1;
        }).map(item => {
          const stats = statsMap[item.id] || {};
          const base = item.last_ordered_at
            ? (item.last_ordered_at.toDate ? item.last_ordered_at.toDate() : new Date(item.last_ordered_at))
            : (item.created_at ? (item.created_at.toDate ? item.created_at.toDate() : new Date(item.created_at)) : today);

          const consumptionDays = typeof item.consumption_days === 'number' ? item.consumption_days : 14;
          const dueDate = new Date(base.getTime() + consumptionDays * 86400000);
          const days_since_due = Math.max(1, Math.floor((today.getTime() - dueDate.getTime()) / 86400000));

          return {
            ...item,
            days_since_due,
            accept_count: stats.accepted || 0,
            dismissal_count: stats.dismissed || 0,
            shown_count: stats.shown || 0
          };
        });
        
        // Sort by acceptance rate then days overdue
        recs.sort((a, b) => {
          const rateA = a.shown_count > 0 ? (a.accept_count / a.shown_count) : 0;
          const rateB = b.shown_count > 0 ? (b.accept_count / b.shown_count) : 0;
          if (rateB !== rateA) return rateB - rateA;
          return b.days_since_due - a.days_since_due;
        });
        
        const topRecs = recs.slice(0, 2);
        setRecommendations(topRecs);

        // Deduplicated authoritative exposure tracking via server endpoint
        if (topRecs.length > 0) {
          const exposureKey = `${topRecs.map(r => r.id).sort().join('_')}_${todayStr}`;
          if (!exposureTrackedRef.current.has(exposureKey)) {
            exposureTrackedRef.current.add(exposureKey);
            fetch(`/api/users/${userId}/recommendations/exposure`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                exposure_id: exposureKey,
                item_ids: topRecs.map(r => r.id)
              })
            }).catch(e => console.debug('[Home] Exposure notification:', e));
          }
        }
      } catch(e) {
        console.warn("Failed to compute recommendations", e);
      }

      // 3. Fetch AI Nudge
      try {
        const nudgeRes = await fetch(`/api/users/${userId}/nudge`);
        if (nudgeRes.ok) {
          const nudgeData = await nudgeRes.json();
          setNudge(nudgeData);
        }
      } catch (nudgeErr) {
        console.warn("Failed to fetch nudge:", nudgeErr);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();

    const handleNetworkRestored = () => {
      fetchData();
    };

    window.addEventListener('network-restored', handleNetworkRestored);
    return () => {
      window.removeEventListener('network-restored', handleNetworkRestored);
    };
  }, [userId]);

  // Deep Link: Automatically open Quick Add when action=quick-add is in URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('action') === 'quick-add') {
      setIsSheetOpen(true);
      const newUrl = window.location.pathname;
      window.history.replaceState({}, document.title, newUrl);
    }
  }, []);

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    if (window.toastTimeout) clearTimeout(window.toastTimeout);
    window.toastTimeout = setTimeout(() => {
      setToast(null);
    }, 2000);
  };

  const handleAddCapture = async (data) => {
    const rawName = data && data.item_name ? data.item_name.trim() : '';
    if (!rawName) return;

    const requestKey = rawName.toLowerCase();

    if (pendingRequestsRef.current.has(requestKey)) {
      return;
    }

    const isDuplicate = captures.some(
      c => (c.item_name || '').toLowerCase() === requestKey
    );
    if (isDuplicate) {
      showToast(`"${rawName}" is already captured today`, 'error');
      return;
    }

    pendingRequestsRef.current.add(requestKey);

    const tempId = Date.now().toString();
    const cleanData = {
      item_name: rawName,
      quantity: data.quantity ? data.quantity.trim() : null,
      source: data.source || 'manual'
    };
    const newCapture = { id: tempId, ...cleanData, captured_at: { toDate: () => new Date() } };
    const previousCaptures = [...captures];
    
    // Optimistic update
    const updatedCaptures = [...captures, newCapture];
    setCaptures(updatedCaptures);
    const low = calculateRunningLowItems({
      householdItems: allItems,
      todayCaptures: updatedCaptures,
      now: new Date()
    });
    setRunningLow(low);
    
    setIsSheetOpen(false);
    showToast(`Added "${cleanData.item_name}"`, 'success');
    trackEvent('Item captured', { item_name: cleanData.item_name, quantity: cleanData.quantity });

    try {
      if (!navigator.onLine) {
        throw new Error("You're offline. Item couldn't be saved.");
      }

      const docRef = await addDoc(collection(db, 'users', userId, 'daily_captures'), {
        ...cleanData,
        captured_at: serverTimestamp(),
        added_to_order: false
      });

      setCaptures(prev => {
        const finalized = prev.map(c => c.id === tempId ? { ...c, id: docRef.id } : c);
        const syncLow = calculateRunningLowItems({
          householdItems: allItems,
          todayCaptures: finalized,
          now: new Date()
        });
        setRunningLow(syncLow);
        return finalized;
      });
    } catch (err) {
      console.error('[Capture Error]', err);
      setCaptures(previousCaptures);
      const rollbackLow = calculateRunningLowItems({
        householdItems: allItems,
        todayCaptures: previousCaptures,
        now: new Date()
      });
      setRunningLow(rollbackLow);

      const errMsg = !navigator.onLine ? "You're offline. Item couldn't be saved." : "Couldn't save item.";
      showToast(errMsg, 'error');
    } finally {
      pendingRequestsRef.current.delete(requestKey);
    }
  };

  const handleRemoveCapture = async (captureId) => {
    const updatedCaptures = captures.filter(c => c.id !== captureId);
    setCaptures(updatedCaptures);
    const low = calculateRunningLowItems({
      householdItems: allItems,
      todayCaptures: updatedCaptures,
      now: new Date()
    });
    setRunningLow(low);

    try {
      await deleteDoc(doc(db, 'users', userId, 'daily_captures', captureId));
      
      const nudgeRes = await fetch(`/api/users/${userId}/nudge`);
      if (nudgeRes.ok) {
        const nudgeData = await nudgeRes.json();
        setNudge(nudgeData);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleRecommendationAction = async (item, action) => {
    try {
      if (action === 'added') {
        await handleAddCapture({ item_name: item.item_name, quantity: null, source: 'recommendation' });
      }

      // Call authoritative backend action endpoint (handles stats, suppression, and edit_log idempotently)
      const actionId = `rec_act_${userId}_${item.id}_${action}_${Date.now()}`;
      fetch(`/api/users/${userId}/recommendations/${item.id}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          action_id: actionId
        })
      }).catch(err => console.debug('[Home] Backend action sync:', err));

      // Remove from active recommendations
      setRecommendations(prev => prev.filter(r => r.id !== item.id));
      showToast(action === 'added' ? `Added "${item.item_name}" to list` : `Skipped "${item.item_name}"`);
    } catch (err) {
      console.error('[Recommendation Action]', err);
    }
  };

  const handleSnoozeNudge = async () => {
    if (snoozingNudge) return;
    setSnoozingNudge(true);
    try {
      const res = await fetch(`/api/users/${userId}/nudge/remind-later`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hours: 3 })
      });
      if (res.ok) {
        setNudge(null);
        showToast('Nudge snoozed for 3 hours');
      }
    } catch (err) {
      console.warn('Failed to snooze nudge:', err);
    } finally {
      setSnoozingNudge(false);
    }
  };

  if (loading) return <div className="p-6 text-center text-brand font-bold">Loading CartSense...</div>;

  return (
    <div className="pb-24 bg-surface min-h-screen">
      {/* Top Bar */}
      <header className="px-5 py-4 flex items-center justify-between border-b border-border bg-white">
        <h1 className="text-[20px] font-extrabold text-brand tracking-tight">CartSense</h1>
        <div className="flex items-center gap-2">
          <Link
            to="/insights"
            className="w-8 h-8 flex items-center justify-center rounded-full bg-surface text-ink hover:bg-gray-100 transition-colors"
            title="Smart Insights"
            id="home-insights-link"
          >
            <LineChart className="w-4 h-4 text-brand" />
          </Link>
          <Link
            to="/settings"
            className="w-8 h-8 flex items-center justify-center rounded-full bg-surface text-ink hover:bg-gray-100 transition-colors"
            title="Settings"
            id="home-settings-link"
          >
            <Settings className="w-4 h-4" />
          </Link>
        </div>
      </header>

      <main className="p-5 space-y-4">
        {/* AI Nudge Banner */}
        {nudge && nudge.show && nudge.nudgeText && (
          <div className={`p-4 rounded-2xl border-l-4 shadow-sm flex flex-col gap-2 transition-all duration-300 ${
            nudge.condition === 3 
              ? 'bg-rose-50 border-rose-500 text-rose-900' 
              : nudge.condition === 2 
                ? 'bg-amber-50 border-amber-500 text-amber-900' 
                : 'bg-green-50 border-green-500 text-green-900 bg-white/50'
          }`}>
            <div className="flex gap-3 items-start">
              <div className={`p-1.5 rounded-lg flex-shrink-0 ${
                nudge.condition === 3 
                  ? 'bg-rose-100 text-rose-600' 
                  : nudge.condition === 2 
                    ? 'bg-amber-100 text-amber-600' 
                    : 'bg-green-100 text-green-600'
              }`}>
                <Sparkles className="w-4 h-4 animate-pulse" />
              </div>
              <div className="flex-1 min-w-0">
                <span className="text-[10px] font-extrabold uppercase tracking-widest block mb-0.5 opacity-60">
                  {nudge.condition === 3 
                    ? 'Urgent Stock Alert' 
                    : nudge.condition === 2 
                      ? 'Optimal Purchase Window' 
                      : 'Pantry Healthy'}
                </span>
                <p className="text-[13px] leading-relaxed font-medium">
                  {nudge.nudgeText}
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button
                onClick={handleSnoozeNudge}
                disabled={snoozingNudge}
                className="text-[11px] font-bold text-muted hover:text-ink px-2 py-1 rounded bg-black/5 flex items-center gap-1 transition-colors"
              >
                <Clock className="w-3 h-3" />
                Remind me later
              </button>
            </div>
          </div>
        )}

        {/* Running Low Card */}
        <RunningLowCard items={runningLow} />

        {/* Recommendations */}
        {recommendations.length > 0 && (
          <div className="space-y-3">
            {recommendations.map(item => (
              <div key={item.id} className="card bg-white border border-border rounded-[12px] p-4">
                <p className="text-[13px] text-ink leading-relaxed mb-4">
                  You might be running low on <span className="font-bold">{item.item_name}</span> — last ordered <span className="font-bold">{item.days_since_due} days ago.</span>
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleRecommendationAction(item, 'added')}
                    className="btn-primary flex-1 h-[44px] rounded-[8px]"
                  >
                    Add to list
                  </button>
                  <button
                    onClick={() => handleRecommendationAction(item, 'dismissed')}
                    className="btn-secondary flex-1 h-[44px] rounded-[8px] border border-border"
                  >
                    Skip
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Today's Captures */}
        <div className="mt-6">
          <h3 className="text-[14px] font-semibold text-muted mb-3">Today's captures</h3>
          <div className="flex flex-wrap gap-2">
            {captures.length > 0 ? (
              captures.map(cap => (
                <div key={cap.id} className="chip flex items-center gap-1.5">
                  {cap.item_name}
                  <button 
                    onClick={() => handleRemoveCapture(cap.id)}
                    className="text-muted hover:text-red-500 transition-colors"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))
            ) : (
              <p className="text-[13px] text-muted italic">Nothing captured yet today.</p>
            )}
          </div>
        </div>
      </main>

      {/* FAB */}
      <button
        onClick={() => setIsSheetOpen(true)}
        className="fixed bottom-20 right-5 w-14 h-14 bg-brand text-white rounded-full shadow-[0_4px_12px_rgba(127,119,221,0.4)] flex items-center justify-center z-30 active:scale-95 transition-transform"
      >
        <Plus className="w-7 h-7" />
      </button>

      <BottomSheet
        isOpen={isSheetOpen}
        onClose={() => setIsSheetOpen(false)}
        onSubmit={handleAddCapture}
      />

      <NavBar />

      {/* Reactive Success/Error Toast Overlay */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 50, scale: 0.9, x: '-50%' }}
            animate={{ opacity: 1, y: 0, scale: 1, x: '-50%' }}
            exit={{ opacity: 0, y: 20, scale: 0.95, x: '-50%' }}
            className={`fixed bottom-24 left-1/2 px-5 py-3 rounded-full text-xs font-bold z-50 shadow-[0_4px_20px_rgba(0,0,0,0.15)] flex items-center gap-2 whitespace-nowrap border ${
              toast.type === 'error' 
                ? 'bg-rose-50 text-rose-700 border-rose-200' 
                : 'bg-ink text-white border-transparent'
            }`}
          >
            <span>{toast.message}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
