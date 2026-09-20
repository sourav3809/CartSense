import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, Calendar, ShieldCheck, Activity, DollarSign, ShoppingCart, TrendingUp } from 'lucide-react';
import { db } from '../lib/firebase';
import { collection, getDocs, doc, getDoc, query, orderBy } from 'firebase/firestore';
import NavBar from '../components/NavBar';

export default function Insights() {
  const [loading, setLoading] = useState(true);
  const [cadence, setCadence] = useState(null);
  const [items, setItems] = useState([]);
  const [orders, setOrders] = useState([]);
  const [analyticsSummary, setAnalyticsSummary] = useState(null);
  const userId = localStorage.getItem('userId');

  const fetchInsightsData = async () => {
    if (!userId) return;
    try {
      // 1. Fetch cadence profile & server analytics summary
      const [cadDoc, itemsSnap, ordersSnap, serverRes] = await Promise.all([
        getDoc(doc(db, 'users', userId, 'cadence', 'profile')).catch(() => null),
        getDocs(collection(db, 'users', userId, 'household_items')).catch(() => ({ docs: [] })),
        getDocs(query(collection(db, 'users', userId, 'order_history'), orderBy('ordered_at', 'desc'))).catch(() => ({ docs: [] })),
        fetch(`/api/users/${userId}/insights`).then(r => r.ok ? r.json() : null).catch(() => null)
      ]);

      if (cadDoc && cadDoc.exists()) {
        setCadence(cadDoc.data());
      }
      if (serverRes && serverRes.cadence && !cadence) {
        setCadence(serverRes.cadence);
      }
      if (serverRes && serverRes.summary) {
        setAnalyticsSummary(serverRes.summary);
      }

      const itemsList = itemsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      setItems(itemsList);

      const ordersList = ordersSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      setOrders(ordersList);
    } catch (err) {
      console.error('Error fetching insights:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchInsightsData();

    const handleNetworkRestored = () => {
      fetchInsightsData();
    };
    window.addEventListener('network-restored', handleNetworkRestored);
    return () => window.removeEventListener('network-restored', handleNetworkRestored);
  }, [userId]);

  const highConfidence = items.filter(i => i.confidence_level === 'high');
  const mediumConfidence = items.filter(i => i.confidence_level === 'medium');
  const lowConfidence = items.filter(i => !i.confidence_level || i.confidence_level === 'low');

  // Spend and Order Metrics Calculation
  const totalSpend = orders.reduce((sum, o) => sum + (Number(o.estimated_value) || 0), 0);
  const avgOrderValue = orders.length > 0 ? totalSpend / orders.length : 0;

  return (
    <div className="pb-24 bg-surface min-h-screen">
      <header className="px-5 py-4 flex items-center justify-between border-b border-border bg-white sticky top-0 z-20">
        <div className="flex items-center gap-4">
          <Link to="/" className="p-1 -ml-1 text-muted" id="insights-back-btn">
            <ChevronLeft className="w-6 h-6" />
          </Link>
          <h1 className="text-lg font-bold text-ink">Smart Insights</h1>
        </div>
      </header>

      <main className="p-5 space-y-5">
        {loading ? (
          <div className="py-16 text-center space-y-3">
            <div className="w-8 h-8 border-3 border-brand border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-xs font-semibold text-muted">Analyzing consumption patterns...</p>
          </div>
        ) : (
          <>
            {/* Cadence Learning Card */}
            <div className="card p-5 border border-brand/20 bg-gradient-to-br from-white to-green-50/30 space-y-3 shadow-sm">
              <div className="flex items-center gap-2 text-brand">
                <Calendar className="w-5 h-5" />
                <h3 className="text-sm font-bold text-ink">Predicted Shopping Day</h3>
              </div>

              {cadence && cadence.weekday ? (
                <div className="space-y-2">
                  <div className="flex items-baseline gap-2">
                    <span className="text-2xl font-black text-brand tracking-tight">{cadence.weekday}s</span>
                    <span className="text-xs font-bold text-emerald-700 bg-emerald-100/60 px-2 py-0.5 rounded-full">
                      {Math.round((cadence.confidence || 0.75) * 100)}% Match
                    </span>
                  </div>
                  <p className="text-xs text-muted leading-relaxed">
                    Based on your confirmed orders over the last 8 weeks, you frequently restock on {cadence.weekday}s. We schedule nudges the day before so you're never caught off guard.
                  </p>
                </div>
              ) : (
                <div className="space-y-1">
                  <p className="text-xs text-ink font-semibold">Learning your weekly rhythm...</p>
                  <p className="text-xs text-muted leading-relaxed">
                    Confirm at least 4 regular grocery orders to unlock an automated weekly replenishment day prediction.
                  </p>
                </div>
              )}
            </div>

            {/* Model Confidence Breakdown */}
            <div className="card p-5 space-y-4">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-brand" />
                <h3 className="text-sm font-bold text-ink">Prediction Accuracy</h3>
              </div>

              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="p-3 bg-emerald-50/60 rounded-xl border border-emerald-100">
                  <span className="text-base font-extrabold text-emerald-700">{highConfidence.length}</span>
                  <p className="text-[10px] font-bold text-emerald-800 uppercase tracking-wider mt-0.5">High</p>
                  <span className="text-[9px] text-emerald-600 font-medium">7+ cycles</span>
                </div>
                <div className="p-3 bg-amber-50/60 rounded-xl border border-amber-100">
                  <span className="text-base font-extrabold text-amber-700">{mediumConfidence.length}</span>
                  <p className="text-[10px] font-bold text-amber-800 uppercase tracking-wider mt-0.5">Medium</p>
                  <span className="text-[9px] text-amber-600 font-medium">3–6 cycles</span>
                </div>
                <div className="p-3 bg-gray-50 rounded-xl border border-gray-200">
                  <span className="text-base font-extrabold text-gray-700">{lowConfidence.length}</span>
                  <p className="text-[10px] font-bold text-gray-600 uppercase tracking-wider mt-0.5">Learning</p>
                  <span className="text-[9px] text-gray-500 font-medium">&lt;3 cycles</span>
                </div>
              </div>

              <p className="text-xs text-muted leading-relaxed">
                As you log orders and quick daily captures, item cadence evolves from general defaults to custom precision tailored to your household.
              </p>
            </div>

            {/* Spend & Ordering Patterns */}
            <div className="card p-5 space-y-4">
              <div className="flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-brand" />
                <h3 className="text-sm font-bold text-ink">Household Grocery Patterns</h3>
              </div>

              {orders.length >= 2 ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="p-3 bg-surface rounded-xl border border-border">
                      <p className="text-[10px] font-bold text-muted uppercase tracking-wider">Total Logged Spend</p>
                      <p className="text-lg font-bold font-mono text-ink mt-0.5">₹{totalSpend.toFixed(2)}</p>
                    </div>
                    <div className="p-3 bg-surface rounded-xl border border-border">
                      <p className="text-[10px] font-bold text-muted uppercase tracking-wider">Avg Order Value</p>
                      <p className="text-lg font-bold font-mono text-brand mt-0.5">₹{avgOrderValue.toFixed(2)}</p>
                    </div>
                  </div>
                  <p className="text-xs text-muted">
                    Calculated from {orders.length} confirmed orders in your household history.
                  </p>
                </div>
              ) : (
                <div className="p-4 bg-surface rounded-xl border border-border text-center space-y-1">
                  <p className="text-xs font-semibold text-ink">Insufficient order history for spend trends</p>
                  <p className="text-[11px] text-muted">
                    Log at least 2 confirmed orders to view your average basket spend and monthly trends.
                  </p>
                </div>
              )}
            </div>

            {/* Total Items Tracked Summary */}
            <div className="card p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-brand/10 flex items-center justify-center text-brand">
                  <Activity className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-xs font-bold text-ink">Tracked Essentials</h4>
                  <p className="text-[11px] text-muted">{items.length} items actively monitored</p>
                </div>
              </div>
              <Link to="/settings" className="text-xs font-bold text-brand hover:underline">
                Manage →
              </Link>
            </div>
          </>
        )}
      </main>

      <NavBar />
    </div>
  );
}
