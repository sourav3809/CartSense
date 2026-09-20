import { useState, useEffect } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { ChevronLeft, Copy, CheckCircle, ShoppingCart, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

import NavBar from '../components/NavBar';
import { db, auth } from '../lib/firebase';
import { collection, getDocs, addDoc, updateDoc, deleteDoc, doc, serverTimestamp } from 'firebase/firestore';
import { getItemDefaultQuantityConfig } from './Onboarding';

export default function OrderChecklist() {
  const { platform } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [checkedItems, setCheckedItems] = useState(new Set());
  const [toast, setToast] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [quantitiesMap, setQuantitiesMap] = useState({});
  const [idempotencyKey, setIdempotencyKey] = useState(null);
  
  const userId = localStorage.getItem('userId');
  const items = location.state?.items || [];
  const platformData = location.state?.platformData || { items: [] };

  useEffect(() => {
    // Generate idempotency key for this order session
    if (!idempotencyKey) {
      setIdempotencyKey(`order_${userId || 'guest'}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`);
    }
  }, [userId, idempotencyKey]);

  useEffect(() => {
    const fetchQuantities = async () => {
      if (!userId) return;
      try {
        const snap = await getDocs(collection(db, 'users', userId, 'household_items'));
        const qMap = {};
        snap.docs.forEach(doc => {
          const data = doc.data();
          if (data.item_name && data.quantity_per_order) {
            qMap[data.item_name] = data.quantity_per_order;
          }
        });
        setQuantitiesMap(qMap);
      } catch (err) {
        console.error('Failed to fetch quantities:', err);
      }
    };
    fetchQuantities();
  }, [userId]);

  const getStandardQty = (itemName) => {
    if (quantitiesMap[itemName]) return quantitiesMap[itemName];
    const qConfig = getItemDefaultQuantityConfig(itemName);
    return ['ml', 'gm'].includes(qConfig.unit)
      ? `${qConfig.value}${qConfig.unit}`
      : `${qConfig.value} ${qConfig.unit}`;
  };

  // Filter items to only include those that were passed
  const orderItems = platformData.items.filter(i => items.includes(i.name));

  const totalItems = orderItems.length;
  const checkedCount = checkedItems.size;
  const currentTotal = orderItems
    .filter(i => checkedItems.has(i.name))
    .reduce((sum, i) => sum + (i.price || 0), 0);
  
  const progress = totalItems > 0 ? (checkedCount / totalItems) * 100 : 0;

  const toggleItem = (name) => {
    const newChecked = new Set(checkedItems);
    if (newChecked.has(name)) {
      newChecked.delete(name);
    } else {
      newChecked.add(name);
    }
    setCheckedItems(newChecked);
  };

  const handleCopy = () => {
    const text = orderItems
      .map(i => `${i.name} — Qty: ${getStandardQty(i.name)} — ₹${i.price !== null ? i.price.toFixed(2) : 'N/A'}`)
      .join('\n');
    
    navigator.clipboard.writeText(text).then(() => {
      setToast('Copied to clipboard');
      setTimeout(() => setToast(null), 2000);
    });
  };

  const handleConfirmOrder = async () => {
    if (checkedCount === 0 || submitting) return;
    setSubmitting(true);
    try {
      const finalItems = orderItems
        .filter(i => checkedItems.has(i.name))
        .map(i => ({
          item_name: i.name,
          price: i.price,
          quantity: getStandardQty(i.name)
        }));

      // 1. Direct client-side Firestore write for high resilience & instant persistence
      if (userId && auth.currentUser) {
        try {
          // Log order history
          await addDoc(collection(db, 'users', userId, 'order_history'), {
            items: finalItems,
            platform: platform || 'grocery_store',
            estimated_value: currentTotal,
            ordered_at: serverTimestamp(),
            idempotency_key: idempotencyKey
          });

          // Fetch items to update clocks & order cycles
          const [itemsSnap, capturesSnap] = await Promise.all([
            getDocs(collection(db, 'users', userId, 'household_items')),
            getDocs(collection(db, 'users', userId, 'daily_captures'))
          ]);

          const orderedNames = new Set(finalItems.map(i => (i.item_name || '').toLowerCase().trim()));

          // Reset clocks for household items
          for (const itemDoc of itemsSnap.docs) {
            const data = itemDoc.data();
            const name = (data.item_name || '').toLowerCase().trim();
            if (orderedNames.has(name)) {
              const currentCycles = (data.order_cycles || 0) + 1;
              const confidence = currentCycles >= 7 ? 'high' : (currentCycles >= 3 ? 'medium' : 'low');
              await updateDoc(doc(db, 'users', userId, 'household_items', itemDoc.id), {
                last_ordered_at: serverTimestamp(),
                order_cycles: currentCycles,
                confidence_level: confidence,
                suppressed: false
              });
            }
          }

          // Clear ordered daily captures
          for (const capDoc of capturesSnap.docs) {
            const capData = capDoc.data();
            const capName = (capData.item_name || '').toLowerCase().trim();
            if (orderedNames.has(capName)) {
              await deleteDoc(doc(db, 'users', userId, 'daily_captures', capDoc.id));
            }
          }
        } catch (fErr) {
          console.debug('[OrderChecklist] Direct client order sync:', fErr);
        }
      }

      // 2. Call backend confirmation endpoint
      fetch(`/api/users/${userId}/orders/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: finalItems,
          platform: platform || 'grocery_store',
          estimated_value: currentTotal,
          idempotency_key: idempotencyKey
        })
      }).catch(e => console.debug('[OrderChecklist] Backend confirmation notification:', e));

      setToast('Order logged. Clocks reset.');
      setTimeout(() => navigate('/history'), 1500);
    } catch (err) {
      console.error('[OrderChecklist] Confirmation failed:', err);
      setToast('Failed to confirm order. Please try again.');
      setTimeout(() => setToast(null), 3000);
      setSubmitting(false);
    }
  };

  if (orderItems.length === 0) {
    return (
      <div className="pb-24 bg-surface min-h-screen">
        <header className="px-5 py-4 flex items-center gap-4 border-b border-border bg-white">
          <button onClick={() => navigate(-1)} className="p-1 -ml-1 text-muted">
            <ChevronLeft className="w-6 h-6" />
          </button>
          <h1 className="text-lg font-bold text-ink capitalize">Order from {platform}</h1>
        </header>
        <main className="p-10 text-center space-y-4">
          <ShoppingCart className="w-12 h-12 text-gray-300 mx-auto" />
          <p className="text-muted">Nothing to order</p>
          <button onClick={() => navigate('/running-low')} className="btn-primary w-full">
            Back to Running Low
          </button>
        </main>
        <NavBar />
      </div>
    );
  }

  return (
    <div className="pb-32 bg-surface min-h-screen">
      <header className="px-5 py-4 border-b border-border bg-white sticky top-0 z-20">
        <div className="flex items-center gap-4 mb-4">
          <button onClick={() => navigate(-1)} className="p-1 -ml-1 text-muted">
            <ChevronLeft className="w-6 h-6" />
          </button>
          <div className="flex-1">
            <h1 className="text-lg font-bold text-ink capitalize">Order from {platform}</h1>
            <p className="text-xs text-muted font-medium">{totalItems} items in list</p>
          </div>
        </div>

        {/* Sticky Progress & Total */}
        <div className="space-y-3">
          <div className="flex justify-between items-end">
            <div className="space-y-1">
              <p className="text-[10px] font-bold text-muted uppercase tracking-wider">Progress</p>
              <p className="text-sm font-bold text-ink">{checkedCount} / {totalItems} items added</p>
            </div>
            <div className="text-right">
              <p className="text-[10px] font-bold text-muted uppercase tracking-wider">Total</p>
              <p className="text-xl font-bold text-brand">₹{currentTotal.toFixed(2)}</p>
            </div>
          </div>
          <div className="h-2 w-full bg-gray-100 rounded-full overflow-hidden">
            <motion.div 
              initial={{ width: 0 }}
              animate={{ width: `${progress}%` }}
              className="h-full bg-brand"
            />
          </div>
        </div>
      </header>

      <main className="p-5 space-y-4">
        <div className="card p-0 divide-y divide-border">
          {orderItems.map((item, idx) => (
            <div 
              key={idx} 
              onClick={() => toggleItem(item.name)}
              className={`flex items-center gap-4 p-4 transition-colors cursor-pointer ${checkedItems.has(item.name) ? 'bg-brand/5' : 'bg-white'}`}
            >
              <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all ${
                checkedItems.has(item.name) ? 'bg-brand border-brand' : 'border-gray-200'
              }`}>
                {checkedItems.has(item.name) && <CheckCircle className="w-4 h-4 text-white" />}
              </div>
              <div className="flex-1">
                <p className={`text-sm font-bold transition-all ${checkedItems.has(item.name) ? 'text-brand' : 'text-ink'}`}>
                  {item.name}
                </p>
                <p className="text-xs text-muted">Qty: {getStandardQty(item.name)}</p>
              </div>
              <div className="text-right">
                <p className="text-sm font-mono font-bold text-ink">
                  {item.price !== null ? `₹${item.price.toFixed(2)}` : '—'}
                </p>
              </div>
            </div>
          ))}
        </div>

        <div className="space-y-3 pt-4">
          <button 
            onClick={handleCopy}
            className="w-full h-[44px] rounded-[8px] border border-border bg-white flex items-center justify-center gap-2 text-sm font-bold text-ink active:bg-gray-50"
          >
            <Copy className="w-4 h-4" />
            Copy to clipboard
          </button>
          
          <button 
            disabled={checkedCount === 0 || submitting}
            onClick={handleConfirmOrder}
            className="btn-primary w-full disabled:opacity-50 disabled:grayscale flex items-center justify-center gap-2"
          >
            {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
            {submitting ? 'Confirming order & updating learning...' : 'Confirm order placed'}
          </button>
        </div>
      </main>

      {/* Toast Notification */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ y: 20, opacity: 0, x: '-50%' }}
            animate={{ y: 0, opacity: 1, x: '-50%' }}
            exit={{ y: 20, opacity: 0, x: '-50%' }}
            className="fixed bottom-24 left-1/2 bg-ink text-white px-4 py-2 rounded-full text-xs font-bold z-50 shadow-lg"
          >
            {toast}
          </motion.div>
        )}
      </AnimatePresence>

      <NavBar />
    </div>
  );
}
