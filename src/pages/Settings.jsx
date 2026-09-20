import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronLeft, LogOut, Plus, X, Trash2, Bell, CheckCircle2, AlertCircle } from 'lucide-react';
import { db, auth } from '../lib/firebase';
import { collection, getDocs, getDoc, doc, updateDoc, deleteDoc, addDoc, serverTimestamp } from 'firebase/firestore';
import { signOut } from 'firebase/auth';
import NavBar from '../components/NavBar';
import { getItemDefaultQuantityConfig } from './Onboarding';
import { getNotificationPermission, registerPushSubscription, isPushSupported, autoRefreshSubscription } from '../lib/notifications';
import { trackEvent } from '../lib/analytics';

function parseQuantityStr(quantityStr) {
  if (!quantityStr) return { value: '', unit: '' };
  const numMatch = quantityStr.match(/^([0-9.]+)\s*(.*)$/);
  if (numMatch) {
    return { value: numMatch[1], unit: numMatch[2] };
  }
  return { value: quantityStr, unit: '' };
}

const CONSUMPTION_OPTIONS = [
  { label: '1–2 days', value: 2 },
  { label: '3–5 days', value: 4 },
  { label: '1 week', value: 7 },
  { label: '2 weeks', value: 14 },
  { label: 'Monthly', value: 30 }
];

export default function Settings() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingItem, setEditingItem] = useState(null);
  const [newItemName, setNewItemName] = useState('');
  const [notifPermission, setNotifPermission] = useState(getNotificationPermission());
  const [needReEnable, setNeedReEnable] = useState(false);
  const [subscribingNotif, setSubscribingNotif] = useState(false);
  const [testPushSending, setTestPushSending] = useState(false);
  const [notifNotice, setNotifNotice] = useState(null);
  const [userTimezone, setUserTimezone] = useState('Asia/Kolkata');
  const [updatingTimezone, setUpdatingTimezone] = useState(false);
  const [tzFeedback, setTzFeedback] = useState(null);
  const navigate = useNavigate();
  const userId = localStorage.getItem('userId');
  const userName = localStorage.getItem('userName');

  const handleEnableNotifications = async () => {
    setSubscribingNotif(true);
    setNotifNotice(null);
    try {
      const res = await registerPushSubscription(userId);
      setNotifPermission(getNotificationPermission());
      if (res.success) {
        setNeedReEnable(false);
        setNotifNotice({ type: 'success', text: 'Notifications enabled successfully!' });
      } else if (res.permission === 'denied' || getNotificationPermission() === 'denied') {
        setNotifNotice({
          type: 'error',
          text: 'Permission is blocked in your browser settings. Tap the lock/settings icon near the address bar to allow Notifications.'
        });
      } else {
        setNeedReEnable(true);
        setNotifNotice({ type: 'error', text: res.reason || res.error || 'Failed to enable notifications.' });
      }
    } catch (err) {
      setNotifNotice({ type: 'error', text: err.message });
    } finally {
      setSubscribingNotif(false);
    }
  };

  const handleRetrySubscription = async () => {
    trackEvent('subscription_retry_clicked');
    setSubscribingNotif(true);
    setNotifNotice(null);
    try {
      const res = await autoRefreshSubscription(userId);
      setNotifPermission(getNotificationPermission());
      if (res.status === 'valid' || res.status === 'refreshed') {
        setNeedReEnable(false);
        setNotifNotice({ type: 'success', text: 'Notifications re-enabled successfully!' });
      } else if (res.status === 'permission_denied' || getNotificationPermission() === 'denied') {
        setNotifNotice({
          type: 'error',
          text: 'Browser notification permission has been disabled. Tap the lock icon near address bar to allow Notifications.'
        });
      } else {
        setNeedReEnable(true);
        setNotifNotice({ type: 'error', text: 'Notifications need to be re-enabled.' });
      }
    } catch (err) {
      setNotifNotice({ type: 'error', text: err.message });
    } finally {
      setSubscribingNotif(false);
    }
  };

  const handleSendTestPush = async () => {
    if (!userId) return;
    setTestPushSending(true);
    setNotifNotice(null);
    try {
      const userDoc = await getDoc(doc(db, 'users', userId));
      if (!userDoc.exists() || !userDoc.data().push_subscription) {
        setNotifNotice({ type: 'error', text: 'No push subscription found. Enable notifications first.' });
        return;
      }
      const res = await fetch(`/api/test-push`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription: userDoc.data().push_subscription, userId })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setNotifNotice({ type: 'success', text: 'Test notification sent! Check your system notification tray.' });
      } else {
        setNotifNotice({ type: 'error', text: data.error || 'Failed to send test push.' });
      }
    } catch (err) {
      setNotifNotice({ type: 'error', text: err.message });
    } finally {
      setTestPushSending(false);
    }
  };

  useEffect(() => {
    const handleNetworkRestored = () => {
      fetchItems();
    };
    window.addEventListener('network-restored', handleNetworkRestored);
    return () => window.removeEventListener('network-restored', handleNetworkRestored);
  }, [userId]);

  const fetchItems = async () => {
    if (!userId) return;
    try {
      const [itemsSnap, userSnap] = await Promise.all([
        getDocs(collection(db, 'users', userId, 'household_items')),
        getDoc(doc(db, 'users', userId))
      ]);
      const itemsList = itemsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      setItems(itemsList);
      if (userSnap.exists()) {
        const uData = userSnap.data();
        if (uData.timezone) {
          setUserTimezone(uData.timezone);
        }
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateCurrentTimezone = async () => {
    if (!userId) return;
    setUpdatingTimezone(true);
    setTzFeedback(null);
    try {
      const detected = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata';
      await updateDoc(doc(db, 'users', userId), { timezone: detected });
      setUserTimezone(detected);
      setTzFeedback('Timezone updated successfully');
      setTimeout(() => setTzFeedback(null), 3000);
    } catch (err) {
      console.error('Failed to update timezone:', err);
      setTzFeedback('Failed to update timezone');
      setTimeout(() => setTzFeedback(null), 3000);
    } finally {
      setUpdatingTimezone(false);
    }
  };

  useEffect(() => {
    fetchItems();
  }, [userId]);

  const handleLogout = async () => {
    await signOut(auth);
    localStorage.clear();
    navigate('/auth');
  };

  const handleAddItem = async (e) => {
    e.preventDefault();
    if (!newItemName.trim()) return;
    try {
      const qConfig = getItemDefaultQuantityConfig(newItemName.trim());
      const quantityStr = ['ml', 'gm'].includes(qConfig.unit)
        ? `${qConfig.value}${qConfig.unit}`
        : `${qConfig.value} ${qConfig.unit}`;

      const newItem = {
        item_name: newItemName.trim(),
        consumption_days: 7,
        is_critical: false,
        is_kirana: false,
        quantity_per_order: quantityStr,
        confidence_level: 'low',
        last_ordered_at: serverTimestamp(),
        created_at: serverTimestamp()
      };
      const docRef = await addDoc(collection(db, 'users', userId, 'household_items'), newItem);
      const added = { id: docRef.id, ...newItem };
      setItems([...items, added]);
      setEditingItem(added);
      setNewItemName('');
    } catch (err) {
      console.error(err);
    }
  };

  const handleUpdateItem = async (e) => {
    e.preventDefault();
    try {
      const itemRef = doc(db, 'users', userId, 'household_items', editingItem.id);
      const updates = {
        item_name: editingItem.item_name,
        consumption_days: editingItem.consumption_days,
        is_critical: editingItem.is_critical,
        is_kirana: editingItem.is_kirana,
        quantity_per_order: editingItem.quantity_per_order || ''
      };
      await updateDoc(itemRef, updates);
      setItems(items.map(i => i.id === editingItem.id ? { ...i, ...updates } : i));
      setEditingItem(null);
    } catch (err) {
      console.error(err);
    }
  };

  const [deleteConfirmId, setDeleteConfirmId] = useState(null);

  const handleDeleteItemClick = (itemId) => {
    setDeleteConfirmId(itemId);
  };

  const handleConfirmDeleteItem = async () => {
    if (!deleteConfirmId) return;
    try {
      await deleteDoc(doc(db, 'users', userId, 'household_items', deleteConfirmId));
      setItems(items.filter(i => i.id !== deleteConfirmId));
      setEditingItem(null);
    } catch (err) {
      console.error(err);
    } finally {
      setDeleteConfirmId(null);
    }
  };

  const getConsumptionLabel = (days) => {
    const opt = CONSUMPTION_OPTIONS.find(o => o.value === days);
    return opt ? opt.label : `${days} days`;
  };

  return (
    <div className="pb-24 bg-surface min-h-screen">
      <header className="px-5 py-4 flex items-center gap-4 border-b border-border bg-white">
        <Link to="/" className="p-1 -ml-1 text-muted">
          <ChevronLeft className="w-6 h-6" />
        </Link>
        <h1 className="text-lg font-bold text-ink">Settings</h1>
      </header>

      <main className="p-5 space-y-6">
        {/* User Info & Logout */}
        <div className="card flex items-center justify-between">
          <div>
            <p className="text-xs text-muted uppercase tracking-wider font-bold mb-1">Logged in as</p>
            <p className="text-lg font-bold text-ink">{userName || 'User'}</p>
          </div>
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 px-4 py-2 rounded-[8px] border border-red-500 text-red-500 bg-white font-bold text-sm hover:border-brand hover:text-brand transition-all"
          >
            <LogOut className="w-4 h-4" />
            Logout
          </button>
        </div>

        {/* Preferences / Timezone Section */}
        <section className="space-y-3">
          <h3 className="text-[11px] font-bold text-muted uppercase tracking-widest">Preferences</h3>
          <div className="card p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-bold text-ink">Timezone</p>
                <p className="text-[12px] text-muted font-medium mt-0.5">{userTimezone}</p>
              </div>
              <button
                type="button"
                onClick={handleUpdateCurrentTimezone}
                disabled={updatingTimezone}
                className="px-3 py-1.5 rounded-[8px] border border-border text-ink bg-white font-medium text-xs hover:bg-gray-50 transition-all disabled:opacity-50"
              >
                {updatingTimezone ? 'Detecting...' : 'Update to Current'}
              </button>
            </div>
            {tzFeedback && (
              <p className="text-[11px] font-medium text-emerald-600">{tzFeedback}</p>
            )}
            <p className="text-[11px] text-muted leading-relaxed">
              Smart nudges evaluate at 8:00 PM in your local timezone.
            </p>
          </div>
        </section>

        {/* Notifications & Recovery Section */}
        <section className="space-y-3">
          <h3 className="text-[11px] font-bold text-muted uppercase tracking-widest">Notifications</h3>
          <div className="card p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-full bg-brand/10 flex items-center justify-center text-brand">
                  <Bell className="w-4 h-4" />
                </div>
                <div>
                  <p className="text-sm font-bold text-ink">Smart Nudges</p>
                  <p className="text-[11px] text-muted">Stock check reminders</p>
                </div>
              </div>

              {!isPushSupported() ? (
                <span className="flex items-center gap-1 text-[11px] font-bold text-gray-500 bg-gray-100 px-2 py-1 rounded-full">
                  Unsupported
                </span>
              ) : notifPermission === 'granted' && !needReEnable ? (
                <span className="flex items-center gap-1 text-[11px] font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded-full">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Enabled
                </span>
              ) : (
                <span className="flex items-center gap-1 text-[11px] font-bold text-amber-600 bg-amber-50 px-2 py-1 rounded-full">
                  <AlertCircle className="w-3.5 h-3.5" /> Disabled
                </span>
              )}
            </div>

            {/* Unsupported Browser State */}
            {!isPushSupported() && (
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                <p className="text-xs text-gray-600 leading-snug">
                  Push notifications aren't supported on this browser.
                </p>
              </div>
            )}

            {/* Browser Permission Revoked / Denied */}
            {isPushSupported() && notifPermission === 'denied' && (
              <div className="bg-red-50/70 border border-red-200/70 rounded-lg p-3 space-y-2">
                <p className="text-xs text-red-800 leading-snug font-medium">
                  Browser notification permission has been disabled.
                </p>
                <button
                  type="button"
                  onClick={handleEnableNotifications}
                  disabled={subscribingNotif}
                  className="w-full py-2 bg-brand text-white font-bold text-xs rounded-md shadow-sm hover:bg-brand/90 transition-all disabled:opacity-50"
                >
                  Enable Notifications
                </button>
              </div>
            )}

            {/* Notifications need re-enabling */}
            {isPushSupported() && notifPermission === 'granted' && needReEnable && (
              <div className="bg-amber-50/80 border border-amber-200 rounded-lg p-3 space-y-2">
                <p className="text-xs text-amber-800 font-medium leading-snug">
                  Notifications need to be re-enabled.
                </p>
                <button
                  type="button"
                  onClick={handleRetrySubscription}
                  disabled={subscribingNotif}
                  className="w-full py-2 bg-amber-600 text-white font-bold text-xs rounded-md shadow-sm hover:bg-amber-700 transition-all disabled:opacity-50"
                >
                  {subscribingNotif ? 'Retrying...' : 'Retry'}
                </button>
              </div>
            )}

            {/* Default State: Prompt to Enable */}
            {isPushSupported() && notifPermission === 'default' && (
              <div className="bg-amber-50/60 border border-amber-200/60 rounded-lg p-3 space-y-2">
                <p className="text-xs text-amber-800 leading-snug">
                  Enable notifications to receive reminders when household items are probably running low.
                </p>
                <button
                  type="button"
                  onClick={handleEnableNotifications}
                  disabled={subscribingNotif}
                  className="w-full py-2 bg-brand text-white font-bold text-xs rounded-md shadow-sm hover:bg-brand/90 transition-all disabled:opacity-50"
                >
                  {subscribingNotif ? 'Enabling...' : 'Enable Notifications'}
                </button>
              </div>
            )}

            {/* Test Notification Action: Only shown if enabled and supported */}
            {isPushSupported() && notifPermission === 'granted' && !needReEnable && (
              <div className="pt-1 flex gap-2">
                <button
                  type="button"
                  onClick={handleSendTestPush}
                  disabled={testPushSending}
                  className="flex-1 py-2 border border-brand/30 text-brand font-bold text-xs rounded-md hover:bg-brand/5 transition-all disabled:opacity-50"
                >
                  {testPushSending ? 'Sending...' : 'Send Test Notification'}
                </button>
              </div>
            )}

            {/* Notice banner */}
            {notifNotice && (
              <div className={`p-2.5 rounded-md text-xs font-medium ${notifNotice.type === 'success' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-red-50 text-red-800 border border-red-200'}`}>
                {notifNotice.text}
              </div>
            )}
          </div>
        </section>

        {/* Household Items List */}
        <section className="space-y-3">
          <h3 className="text-[11px] font-bold text-muted uppercase tracking-widest">Household Items</h3>
          
          <div className="card p-0 divide-y divide-[#f3f4f6] max-h-[400px] overflow-y-auto">
            {items.map(item => (
              <button
                key={item.id}
                onClick={() => setEditingItem(item)}
                className="w-full text-left p-4 flex items-center justify-between hover:bg-gray-50 transition-colors"
              >
                <div>
                  <p className="font-bold text-ink">{item.item_name}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-[10px] text-muted">~{getConsumptionLabel(item.consumption_days)}{item.quantity_per_order ? ` (${item.quantity_per_order})` : ''}</span>
                    {item.is_critical && <span className="badge bg-red-50 text-red-500 text-[9px]">Critical</span>}
                    {item.is_kirana && <span className="badge bg-amber-50 text-amber-500 text-[9px]">Kirana</span>}
                  </div>
                </div>
                <ChevronLeft className="w-4 h-4 text-gray-300 rotate-180" />
              </button>
            ))}
            {items.length === 0 && !loading && (
              <p className="p-4 text-sm text-muted text-center">No items added yet.</p>
            )}
          </div>

          {/* Add Custom Item */}
          <form onSubmit={handleAddItem} className="flex gap-2">
            <input
              type="text"
              placeholder="Add custom item..."
              className="input-field flex-1"
              value={newItemName}
              onChange={(e) => setNewItemName(e.target.value)}
            />
            <button type="submit" className="btn-primary px-4">
              <Plus className="w-5 h-5" />
            </button>
          </form>
        </section>
      </main>

      {/* Edit Modal */}
      {editingItem && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-6">
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-white rounded-lg w-full max-w-[320px] p-6 shadow-2xl relative"
          >
            <button
              onClick={() => setEditingItem(null)}
              className="absolute top-4 right-4 text-muted"
            >
              <X className="w-5 h-5" />
            </button>

            <h2 className="text-lg font-bold text-ink mb-6">Edit Item</h2>

            <form onSubmit={handleUpdateItem} className="space-y-5">
              <div>
                <label className="block text-xs font-bold text-muted uppercase tracking-wider mb-1.5">Item Name</label>
                <input
                  type="text"
                  required
                  className="input-field"
                  value={editingItem.item_name}
                  onChange={(e) => setEditingItem({ ...editingItem, item_name: e.target.value })}
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-muted uppercase tracking-wider mb-2">Quantity per Order</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    required
                    placeholder="e.g. 500"
                    className="input-field max-w-[100px]"
                    value={parseQuantityStr(editingItem.quantity_per_order).value}
                    onChange={(e) => {
                      const parsed = parseQuantityStr(editingItem.quantity_per_order);
                      const unit = parsed.unit || getItemDefaultQuantityConfig(editingItem.item_name).unit;
                      const newValue = e.target.value;
                      const combined = ['ml', 'gm'].includes(unit) ? `${newValue}${unit}` : `${newValue} ${unit}`;
                      setEditingItem({ ...editingItem, quantity_per_order: combined });
                    }}
                  />
                  <select
                    className="input-field flex-1 appearance-none cursor-pointer pr-8 bg-no-repeat bg-[right_10px_center] text-sm"
                    value={parseQuantityStr(editingItem.quantity_per_order).unit || getItemDefaultQuantityConfig(editingItem.item_name).unit}
                    onChange={(e) => {
                      const parsed = parseQuantityStr(editingItem.quantity_per_order);
                      const value = parsed.value || getItemDefaultQuantityConfig(editingItem.item_name).value;
                      const newUnit = e.target.value;
                      const combined = ['ml', 'gm'].includes(newUnit) ? `${value}${newUnit}` : `${value} ${newUnit}`;
                      setEditingItem({ ...editingItem, quantity_per_order: combined });
                    }}
                  >
                    {getItemDefaultQuantityConfig(editingItem.item_name).units.map(unit => (
                      <option key={unit} value={unit}>{unit}</option>
                    ))}
                  </select>
                </div>
                {/* Quick Selection Chips */}
                <div className="flex flex-wrap gap-1.5 pt-2">
                  {getItemDefaultQuantityConfig(editingItem.item_name).quick.map(v => {
                    const parsedCurrent = parseQuantityStr(editingItem.quantity_per_order);
                    const numericPart = parseFloat(v);
                    const unitPart = v.replace(/[0-9.]/g, '').trim();
                    const isSelected = (parsedCurrent.value === String(numericPart)) && (parsedCurrent.unit === unitPart);
                    
                    return (
                      <button
                        key={v}
                        type="button"
                        onClick={() => {
                          const combined = ['ml', 'gm'].includes(unitPart) ? `${numericPart}${unitPart}` : `${numericPart} ${unitPart}`;
                          setEditingItem({ ...editingItem, quantity_per_order: combined });
                        }}
                        className={`px-2 py-1 rounded-md text-[9px] font-semibold transition-all ${isSelected ? 'bg-brand/10 text-brand border border-brand/20' : 'bg-gray-50 text-gray-500 hover:bg-gray-100 border border-transparent'}`}
                      >
                        {v}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-muted uppercase tracking-wider mb-2">Consumption Pattern</label>
                <div className="flex flex-wrap gap-2">
                  {CONSUMPTION_OPTIONS.map(opt => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setEditingItem({ ...editingItem, consumption_days: opt.value })}
                      className={`px-3 py-1.5 rounded-full text-[10px] font-bold border transition-all ${editingItem.consumption_days === opt.value ? 'bg-brand text-white border-brand' : 'bg-white text-muted border-border'}`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    className="w-4 h-4 rounded border-border text-brand focus:ring-brand"
                    checked={editingItem.is_critical}
                    onChange={(e) => setEditingItem({ ...editingItem, is_critical: e.target.checked })}
                  />
                  <span className="text-xs font-medium text-ink">Critical?</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    className="w-4 h-4 rounded border-border text-brand focus:ring-brand"
                    checked={editingItem.is_kirana}
                    onChange={(e) => setEditingItem({ ...editingItem, is_kirana: e.target.checked })}
                  />
                  <span className="text-xs font-medium text-ink">Kirana?</span>
                </label>
              </div>

              <div className="pt-2 space-y-3">
                <button type="submit" className="btn-primary w-full">
                  Save Changes
                </button>
                <button
                  type="button"
                  onClick={() => handleDeleteItemClick(editingItem.id)}
                  className="w-full py-2 rounded-sm border border-red-200 text-red-500 font-bold text-[13px] hover:bg-red-50 transition-colors"
                >
                  Delete Item
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}

      <AnimatePresence>
        {deleteConfirmId && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-6">
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white rounded-xl w-full max-w-[320px] p-6 shadow-2xl text-center"
            >
              <h3 className="text-base font-bold text-ink mb-2">Delete Item?</h3>
              <p className="text-xs text-muted mb-6">
                Are you sure you want to delete this item? This action cannot be undone.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setDeleteConfirmId(null)}
                  className="flex-1 py-2.5 rounded-lg border border-border text-ink font-bold text-xs hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirmDeleteItem}
                  className="flex-1 py-2.5 rounded-lg bg-red-500 hover:bg-red-600 text-white font-bold text-xs transition-colors"
                >
                  Delete
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
