import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ShoppingBag, Calendar, Package, ArrowRight, Clock } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { db } from '../lib/firebase';
import { collection, getDocs, query, orderBy } from 'firebase/firestore';
import NavBar from '../components/NavBar';

export default function History() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const userId = localStorage.getItem('userId');

  const fetchOrders = async () => {
    if (!userId) return;
    try {
      const q = query(
        collection(db, 'users', userId, 'order_history'),
        orderBy('ordered_at', 'desc')
      );
      const snap = await getDocs(q);
      const list = snap.docs.map(d => ({
        id: d.id,
        ...d.data()
      }));
      setOrders(list);
    } catch (err) {
      console.error('Failed to fetch order history:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOrders();

    const handleNetworkRestored = () => {
      fetchOrders();
    };
    window.addEventListener('network-restored', handleNetworkRestored);
    return () => window.removeEventListener('network-restored', handleNetworkRestored);
  }, [userId]);

  const formatDate = (timestamp) => {
    if (!timestamp) return 'Recent';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    if (isNaN(date.getTime())) return 'Recent';
    return date.toLocaleDateString('en-IN', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  return (
    <div className="pb-24 bg-surface min-h-screen">
      <header className="px-5 py-4 flex items-center justify-between border-b border-border bg-white sticky top-0 z-20">
        <div className="flex items-center gap-4">
          <Link to="/" className="p-1 -ml-1 text-muted" id="history-back-btn">
            <ChevronLeft className="w-6 h-6" />
          </Link>
          <h1 className="text-lg font-bold text-ink">Order History</h1>
        </div>
        <span className="text-xs font-semibold text-muted bg-gray-50 px-2.5 py-1 rounded-full border border-gray-100">
          {orders.length} {orders.length === 1 ? 'order' : 'orders'}
        </span>
      </header>

      <main className="p-5 space-y-4">
        {loading ? (
          <div className="py-16 text-center space-y-3">
            <div className="w-8 h-8 border-3 border-brand border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-xs font-semibold text-muted">Loading your past orders...</p>
          </div>
        ) : orders.length === 0 ? (
          <div className="card text-center py-12 space-y-3">
            <div className="w-12 h-12 bg-gray-50 rounded-full flex items-center justify-center text-muted mx-auto">
              <ShoppingBag className="w-6 h-6" />
            </div>
            <p className="text-sm font-bold text-ink">No orders logged yet</p>
            <p className="text-xs text-muted max-w-[240px] mx-auto">
              When you confirm grocery orders, they will appear here to train your household consumption predictions.
            </p>
            <Link to="/running-low" className="btn-primary inline-flex items-center gap-2 mt-2 text-xs py-2 px-4">
              Check Running Low <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {orders.map((order) => {
              const itemsList = Array.isArray(order.items) ? order.items : [];
              const platformName = order.platform || 'Grocery Store';

              return (
                <div
                  key={order.id}
                  onClick={() => setSelectedOrder(order)}
                  className="card p-4 hover:shadow-md transition-all cursor-pointer border border-border bg-white flex flex-col gap-3 group"
                  id={`order-history-card-${order.id}`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-ink capitalize">{platformName}</span>
                      <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded bg-brand/10 text-brand">
                        Logged
                      </span>
                    </div>
                    {order.estimated_value ? (
                      <span className="text-sm font-bold font-mono text-ink">
                        ₹{Number(order.estimated_value).toFixed(2)}
                      </span>
                    ) : null}
                  </div>

                  <div className="flex items-center gap-1.5 text-xs text-muted">
                    <Clock className="w-3.5 h-3.5" />
                    <span>{formatDate(order.ordered_at)}</span>
                  </div>

                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {itemsList.slice(0, 4).map((item, idx) => (
                      <span
                        key={idx}
                        className="text-[11px] font-medium bg-gray-50 text-gray-700 border border-gray-100 px-2 py-0.5 rounded-md"
                      >
                        {typeof item === 'string' ? item : item.item_name || item.name}
                        {item.quantity ? ` (${item.quantity})` : ''}
                      </span>
                    ))}
                    {itemsList.length > 4 && (
                      <span className="text-[11px] font-semibold text-muted bg-gray-50 px-2 py-0.5 rounded-md">
                        +{itemsList.length - 4} more
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* Order Details Modal */}
      <AnimatePresence>
        {selectedOrder && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-5">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-2xl w-full max-w-[340px] max-h-[80vh] flex flex-col shadow-2xl p-5"
            >
              <div className="flex items-center justify-between border-b border-border pb-3 mb-3">
                <div>
                  <h3 className="text-base font-bold text-ink capitalize">
                    {selectedOrder.platform || 'Grocery Store'}
                  </h3>
                  <p className="text-[11px] text-muted">{formatDate(selectedOrder.ordered_at)}</p>
                </div>
                {selectedOrder.estimated_value && (
                  <span className="text-base font-extrabold font-mono text-brand">
                    ₹{Number(selectedOrder.estimated_value).toFixed(2)}
                  </span>
                )}
              </div>

              <div className="flex-1 overflow-y-auto space-y-2 py-2">
                <p className="text-[11px] font-bold text-muted uppercase tracking-wider mb-2">
                  Items in this order ({Array.isArray(selectedOrder.items) ? selectedOrder.items.length : 0})
                </p>
                {(Array.isArray(selectedOrder.items) ? selectedOrder.items : []).map((item, idx) => (
                  <div
                    key={idx}
                    className="p-2.5 rounded-xl bg-gray-50 border border-gray-100 flex items-center justify-between text-xs"
                  >
                    <div className="flex items-center gap-2">
                      <Package className="w-4 h-4 text-muted" />
                      <span className="font-semibold text-ink">
                        {typeof item === 'string' ? item : item.item_name || item.name}
                      </span>
                    </div>
                    {item.quantity && (
                      <span className="text-[11px] text-muted font-medium bg-white px-2 py-0.5 rounded border border-gray-200">
                        {item.quantity}
                      </span>
                    )}
                  </div>
                ))}
              </div>

              <div className="pt-3 border-t border-border mt-3">
                <button
                  onClick={() => setSelectedOrder(null)}
                  className="btn-primary w-full py-2 text-xs"
                >
                  Close
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
