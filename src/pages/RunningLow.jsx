import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronLeft, Trash2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { db } from '../lib/firebase';
import { collection, getDocs, doc, deleteDoc, updateDoc, serverTimestamp, addDoc } from 'firebase/firestore';
import NavBar from '../components/NavBar';
import { calculateRunningLowItems } from '../lib/runningLowLogic';

export default function RunningLow() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [deleteConfirmId, setDeleteConfirmId] = useState(null);
  const navigate = useNavigate();
  const userId = localStorage.getItem('userId');

  const fetchItems = async () => {
    if (!userId) return;
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayStr = today.toDateString();

      // 1. Fetch household items & daily captures
      const [itemsSnap, capturesSnap] = await Promise.all([
        getDocs(collection(db, 'users', userId, 'household_items')),
        getDocs(collection(db, 'users', userId, 'daily_captures'))
      ]);

      const allItems = itemsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      const todayCaptures = capturesSnap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(c => {
          if (!c.captured_at) return true;
          const d = c.captured_at.toDate ? c.captured_at.toDate() : new Date(c.captured_at);
          return d.toDateString() === todayStr;
        });

      // Canonical Running Low calculation
      const results = calculateRunningLowItems({
        householdItems: allItems,
        todayCaptures,
        now: today
      });

      setItems(results);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchItems();
    if (userId) {
      // Log open via server endpoint
      fetch(`/api/users/${userId}/nudge/open`, { method: 'POST' }).catch(() => {});
    }

    const handleNetworkRestored = () => {
      fetchItems();
    };

    window.addEventListener('network-restored', handleNetworkRestored);
    return () => window.removeEventListener('network-restored', handleNetworkRestored);
  }, [userId]);

  const handleDeleteClick = (itemId) => {
    setDeleteConfirmId(itemId);
  };

  const handleConfirmDelete = async () => {
    if (!deleteConfirmId) return;
    try {
      if (deleteConfirmId.startsWith('cap-')) {
        const captureId = deleteConfirmId.replace('cap-', '');
        setItems(prev => prev.filter(i => i.id !== deleteConfirmId));
        await deleteDoc(doc(db, 'users', userId, 'daily_captures', captureId));
      } else {
        const itemToDelete = items.find(i => i.id === deleteConfirmId);
        setItems(prev => prev.filter(i => i.id !== deleteConfirmId));

        // Mark dismissed in household item
        await updateDoc(doc(db, 'users', userId, 'household_items', deleteConfirmId), {
          dismissed_at: serverTimestamp()
        });
        
        if (itemToDelete) {
          const today = new Date();
          const firstDayOfYear = new Date(today.getFullYear(), 0, 1);
          const pastDaysOfYear = (today - firstDayOfYear) / 86400000;
          const weekNum = Math.ceil((pastDaysOfYear + firstDayOfYear.getDay() + 1) / 7);
          const cycle_week = `${today.getFullYear()}-W${weekNum}`;

          await addDoc(collection(db, 'users', userId, 'edit_log'), {
            item_name: itemToDelete.item_name,
            action: 'dismissed',
            cycle_week,
            logged_at: serverTimestamp()
          });

          // Call authoritative backend action endpoint to record dismissal & handle suppression
          const actionId = `rec_act_${userId}_${deleteConfirmId}_dismissed_${Date.now()}`;
          fetch(`/api/users/${userId}/recommendations/${deleteConfirmId}/action`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'dismissed',
              action_id: actionId
            })
          }).catch(e => console.warn('[RunningLow] Dismissal action warning:', e));
        }
      }
    } catch (err) {
      console.error(err);
    } finally {
      setDeleteConfirmId(null);
    }
  };

  const onlineItems = items.filter(i => !i.is_kirana);
  const kiranaItems = items.filter(i => i.is_kirana);

  const handleComparePrices = () => {
    const itemNames = onlineItems.map(i => i.item_name);
    navigate('/prices', { state: { items: itemNames } });
  };

  const renderItemRow = (item) => (
    <div key={item.id} className="flex items-center justify-between py-3 border-b border-[#f3f4f6] last:border-0 group">
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <span className="text-[15px] font-medium text-ink">{item.item_name}</span>
          {item.quantity_per_order && <span className="text-[11px] text-muted font-medium">({item.quantity_per_order})</span>}
          {item.is_kirana && <span className="text-[8px] bg-amber-50 text-amber-600 px-1.5 py-0.5 rounded font-bold uppercase tracking-wider">Kirana</span>}
        </div>
        {item.brand_preference && <p className="text-[10px] text-muted mt-0.5">{item.brand_preference}</p>}
      </div>
      <div className="flex items-center gap-3">
        <div className="text-right">
          <div className={`text-xs font-bold ${
            item.days_remaining <= 0 
              ? 'text-[#dc2626]' 
              : item.days_remaining <= 1 
                ? 'text-[#dc2626]' 
                : item.days_remaining <= 3 
                  ? 'text-[#d97706]' 
                  : 'text-[#166534]'
          }`}>
            {item.days_remaining <= 0 ? 'Due today' : `~${item.days_remaining} ${item.days_remaining === 1 ? 'day' : 'days'} left`}
          </div>
          <span className={`badge pill-${item.confidence_level || 'low'} mt-1`}>
            {item.confidence_level || 'low'}
          </span>
        </div>
        <button 
          onClick={() => handleDeleteClick(item.id)}
          className="p-2 text-gray-300 hover:text-red-500 transition-colors"
          title="Remove from list"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </div>
  );

  if (loading) return <div className="p-6 text-center text-brand font-bold">Loading list...</div>;

  return (
    <div className="pb-24 bg-surface min-h-screen">
      <header className="px-5 py-4 flex items-center gap-4 border-b border-border bg-white">
        <Link to="/" className="p-1 -ml-1 text-muted">
          <ChevronLeft className="w-6 h-6" />
        </Link>
        <h1 className="text-lg font-bold text-ink">Running low ({items.length})</h1>
      </header>

      <main className="p-5 space-y-6">
        {/* Online Items */}
        {onlineItems.length > 0 && (
          <section>
            <h3 className="text-[11px] font-bold text-muted uppercase tracking-widest mb-3">Online items</h3>
            <div className="card divide-y divide-[#f3f4f6]">
              {onlineItems.map(renderItemRow)}
            </div>
            
            <button 
              onClick={handleComparePrices}
              className="btn-primary w-full mt-6"
            >
              Compare prices →
            </button>
          </section>
        )}

        {/* Kirana Items */}
        {kiranaItems.length > 0 && (
          <section>
            <div className="flex items-center gap-3 mb-3">
              <h3 className="text-[11px] font-bold text-muted uppercase tracking-widest">Kirana items</h3>
              <div className="h-px flex-1 bg-border opacity-50"></div>
            </div>
            <div className="card divide-y divide-[#f3f4f6]">
              {kiranaItems.map(renderItemRow)}
            </div>
          </section>
        )}

        {items.length === 0 && (
          <div className="text-center py-12">
            <p className="text-gray-400 text-sm">Your list is empty.</p>
            <Link to="/" className="text-brand text-sm font-bold mt-2 block">Go back home</Link>
          </div>
        )}
      </main>

      {/* Delete Confirmation Modal */}
      <AnimatePresence>
        {deleteConfirmId && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-2xl p-6 w-full max-w-sm space-y-4 shadow-xl"
            >
              <h3 className="text-lg font-bold text-ink">Remove item?</h3>
              <p className="text-sm text-muted">
                This item won't be suggested again until its next cycle.
              </p>
              <div className="flex gap-3 pt-2">
                <button 
                  onClick={() => setDeleteConfirmId(null)}
                  className="flex-1 py-2.5 rounded-lg border border-border font-medium text-ink hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button 
                  onClick={handleConfirmDelete}
                  className="flex-1 py-2.5 rounded-lg bg-red-600 font-medium text-white hover:bg-red-700 transition-colors"
                >
                  Remove
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <NavBar />
    </div>
  );
}
