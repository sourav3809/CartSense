import { useState, useEffect } from 'react';
import { useLocation, useNavigate, Link } from 'react-router-dom';
import { ChevronLeft, Info, CheckCircle2, AlertCircle, X, HelpCircle, RotateCw } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import NavBar from '../components/NavBar';

export default function Prices() {
  const location = useLocation();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [platforms, setPlatforms] = useState(null);
  const [selectedPlatform, setSelectedPlatform] = useState(null);
  const [error, setError] = useState(null);
  const [refreshError, setRefreshError] = useState(null);
  const [availabilityMessage, setAvailabilityMessage] = useState("");
  const [tick, setTick] = useState(0);
  
  const userId = localStorage.getItem('userId');
  const items = location.state?.items || [];

  // Update elapsed time display every 10 seconds
  useEffect(() => {
    const interval = setInterval(() => setTick(t => t + 1), 10000);
    return () => clearInterval(interval);
  }, []);

  const fetchPrices = async (isManualRefresh = false) => {
    if (isManualRefresh) {
      setRefreshing(true);
      setRefreshError(null);
    } else {
      setLoading(true);
      setError(null);
    }

    try {
      const res = await fetch(`/api/users/${userId}/prices`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          items,
          forceRefresh: isManualRefresh
        })
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      
      setPlatforms(data.platforms);
      setAvailabilityMessage(data.availabilityMessage || "");
      setRefreshError(null);
    } catch (err) {
      console.error(err);
      if (isManualRefresh) {
        setRefreshError('Connect to the internet to refresh this information.');
      } else {
        setError('Connect to the internet to refresh this information.');
      }
    } finally {
      if (isManualRefresh) {
        setRefreshing(false);
      } else {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    if (items.length === 0) {
      setLoading(false);
      return;
    }
    fetchPrices(false);

    const handleNetworkRestored = () => {
      console.log('[Prices] Network connection restored. Auto-refreshing prices.');
      fetchPrices(false);
    };

    window.addEventListener('network-restored', handleNetworkRestored);
    return () => window.removeEventListener('network-restored', handleNetworkRestored);
  }, [userId, items]);

  const handleRefresh = () => {
    if (refreshing) return;
    fetchPrices(true);
  };

  function formatLastUpdated(timestampStr) {
    if (!timestampStr) return '';
    const diffMs = Date.now() - new Date(timestampStr).getTime();
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);

    if (diffSec < 10) {
      return 'Updated just now';
    }
    if (diffSec < 60) {
      return `Updated ${diffSec}s ago`;
    }
    if (diffMin < 60) {
      return `Updated ${diffMin} min ago`;
    }
    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) {
      return `Updated ${diffHours} ${diffHours === 1 ? 'hour' : 'hours'} ago`;
    }
    return `Updated on ${new Date(timestampStr).toLocaleDateString()}`;
  }

  if (items.length === 0) {
    return (
      <div className="pb-24 bg-surface min-h-screen">
        <header className="px-5 py-4 flex items-center gap-4 border-b border-border bg-white">
          <button onClick={() => navigate(-1)} className="p-1 -ml-1 text-muted" id="back-btn-empty">
            <ChevronLeft className="w-6 h-6" />
          </button>
          <h1 className="text-lg font-bold text-ink">Price Comparison</h1>
        </header>
        <main className="p-10 text-center space-y-4">
          <p className="text-muted">Add items to your list first</p>
          <button onClick={() => navigate('/running-low')} className="btn-primary w-full" id="go-to-running-low-btn">
            Go to Running Low
          </button>
        </main>
        <NavBar />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="pb-24 bg-surface min-h-screen flex flex-col items-center justify-center p-10 text-center space-y-4">
        <div className="w-12 h-12 border-4 border-brand border-t-transparent rounded-full animate-spin" />
        <p className="text-brand font-bold">Fetching prices across platforms...</p>
        <p className="text-xs text-muted">This usually takes 2–3 seconds</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="pb-24 bg-surface min-h-screen">
        <header className="px-5 py-4 flex items-center gap-4 border-b border-border bg-white">
          <button onClick={() => navigate(-1)} className="p-1 -ml-1 text-muted" id="back-btn-error">
            <ChevronLeft className="w-6 h-6" />
          </button>
          <h1 className="text-lg font-bold text-ink">Price Comparison</h1>
        </header>
        <main className="p-10 text-center space-y-4">
          <AlertCircle className="w-12 h-12 text-red-500 mx-auto" />
          <p className="text-ink font-medium">{error}</p>
          <button onClick={() => window.location.reload()} className="btn-primary w-full" id="retry-btn">
            Try Again
          </button>
        </main>
        <NavBar />
      </div>
    );
  }

  const platformList = Object.entries(platforms || {})
    .map(([id, data]) => ({ id, ...data }))
    .sort((a, b) => {
      if (a.recommended && !b.recommended) return -1;
      if (!a.recommended && b.recommended) return 1;
      if (a.totalMatchedPrice === null) return 1;
      if (b.totalMatchedPrice === null) return -1;
      return a.totalMatchedPrice - b.totalMatchedPrice;
    });

  const recommendedPlatform = platformList.find(p => p.recommended) || platformList.find(p => p.totalMatchedPrice !== null);

  return (
    <div className="pb-24 bg-surface min-h-screen">
      <header className="px-5 py-4 flex items-center justify-between border-b border-border bg-white">
        <div className="flex items-center gap-4">
          <button onClick={() => navigate(-1)} className="p-1 -ml-1 text-muted" id="back-btn">
            <ChevronLeft className="w-6 h-6" />
          </button>
          <h1 className="text-lg font-bold text-ink">Best price for your list</h1>
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="px-3 py-1.5 bg-gray-50 hover:bg-gray-100 disabled:opacity-50 border border-border text-xs font-semibold text-ink rounded-lg flex items-center gap-1.5 transition-all shadow-sm"
          id="refresh-prices-btn"
        >
          <RotateCw className={`w-3.5 h-3.5 text-ink ${refreshing ? 'animate-spin' : ''}`} />
          <span>{refreshing ? 'Refreshing...' : 'Refresh'}</span>
        </button>
      </header>

      <main className="p-5 space-y-6">
        {refreshError && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-xl flex items-start justify-between gap-3 shadow-sm">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
              <p className="text-xs font-medium text-red-800">{refreshError}</p>
            </div>
            <button onClick={() => setRefreshError(null)} className="text-red-500 hover:text-red-700 flex-shrink-0">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {availabilityMessage && (
          <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
            <p className="text-xs font-medium text-amber-800">{availabilityMessage}</p>
          </div>
        )}

        <div className="space-y-3">
          {platformList.map((platform) => {
            const isRec = platform.recommended;
            const displayTotal = platform.totalMatchedPrice;

            return (
              <div
                key={platform.id}
                className={`w-full card p-4 flex flex-col transition-all border-2 rounded-2xl ${
                  isRec 
                    ? 'border-[#22c55e] bg-green-50/10 shadow-md' 
                    : 'border-border bg-white shadow-sm'
                }`}
                id={`platform-card-${platform.id}`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex flex-col">
                    <span className="text-base font-bold text-ink capitalize flex items-center gap-2">
                      {platform.id}
                      {isRec && (
                        <span className="bg-[#22c55e]/15 text-[#16a34a] text-[10px] font-extrabold px-2.5 py-0.5 rounded-full uppercase tracking-wider">
                          Recommended
                        </span>
                      )}
                    </span>
                    {platform.recommendationReason && (
                      <span className={`text-[11px] font-medium mt-1 ${isRec ? 'text-[#16a34a]' : 'text-muted'}`}>
                        {platform.recommendationReason}
                      </span>
                    )}
                    {platform.lastUpdated && (
                      <div className="flex items-center gap-1.5 mt-2 text-[10px] font-semibold">
                        {platform.isFromCache ? (
                          <span className="bg-amber-50 text-amber-700 border border-amber-100 px-2 py-0.5 rounded-full flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                            <span>Cached</span>
                          </span>
                        ) : (
                          <span className="bg-green-50 text-green-700 border border-green-100 px-2 py-0.5 rounded-full flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                            <span>Fresh</span>
                          </span>
                        )}
                        <span className="text-muted font-normal">{formatLastUpdated(platform.lastUpdated)}</span>
                      </div>
                    )}
                  </div>
                  <div className="text-right">
                    {displayTotal !== null ? (
                      <span className="text-xl font-bold text-ink">₹{displayTotal.toFixed(2)}</span>
                    ) : (
                      <span className="text-xs text-[#9ca3af] font-semibold bg-gray-50 px-2 py-1 rounded">Unavailable</span>
                    )}
                  </div>
                </div>

                <div className="mt-4 flex items-center gap-3">
                  <button
                    onClick={() => setSelectedPlatform(platform)}
                    className="flex-1 py-2 text-center border border-border rounded-xl text-xs font-semibold text-ink bg-gray-50 hover:bg-gray-100 transition-all shadow-sm"
                    id={`view-breakdown-btn-${platform.id}`}
                  >
                    View Breakdown ({platform.itemsFound}/{platform.itemsRequested})
                  </button>
                  {displayTotal !== null && (
                    <button
                      onClick={() => {
                        const matchedNames = platform.availableItems.map(i => i.name);
                        navigate(`/order/${platform.id}`, { state: { items: matchedNames, platformData: platform } });
                      }}
                      className="flex-1 py-2 text-center rounded-xl text-xs font-semibold text-white bg-brand hover:bg-brand-dark transition-all flex items-center justify-center gap-1.5 shadow-sm"
                      id={`order-now-btn-${platform.id}`}
                    >
                      Order Now
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {recommendedPlatform && recommendedPlatform.totalMatchedPrice !== null && (
          <div className="pt-4">
            <button
              onClick={() => {
                const matchedNames = recommendedPlatform.availableItems.map(i => i.name);
                navigate(`/order/${recommendedPlatform.id}`, { state: { items: matchedNames, platformData: recommendedPlatform } });
              }}
              className="btn-primary w-full shadow-lg"
              id="use-recommended-btn"
            >
              Use recommended list
            </button>
          </div>
        )}
      </main>

      {/* Item Breakdown Modal */}
      <AnimatePresence>
        {selectedPlatform && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-2xl w-full max-w-[340px] max-h-[80vh] flex flex-col shadow-2xl relative border border-border"
            >
              <button
                onClick={() => setSelectedPlatform(null)}
                className="absolute top-4 right-4 text-muted hover:text-ink z-10 transition-all"
                id="close-modal-btn"
              >
                <X className="w-5 h-5" />
              </button>

              <div className="p-5 border-b border-border">
                <h2 className="text-base font-bold text-ink capitalize">{selectedPlatform.id} Breakdown</h2>
                <p className="text-xs text-muted mt-1">
                  Found {selectedPlatform.itemsFound} of {selectedPlatform.itemsRequested} requested items
                </p>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {/* Available Items */}
                {selectedPlatform.availableItems && selectedPlatform.availableItems.length > 0 && (
                  <div className="space-y-2">
                    <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Available Items</h3>
                    {selectedPlatform.availableItems.map((item, idx) => {
                      const hasDiscount = item.original_price && item.original_price > item.price;
                      return (
                        <div key={`avail-${idx}`} className="flex gap-3 items-center p-2.5 rounded-xl border border-gray-100 bg-white shadow-sm">
                          <div className="w-10 h-10 rounded-lg border border-gray-100 bg-gray-50 flex-shrink-0 flex items-center justify-center overflow-hidden">
                            {item.product_image ? (
                              <img 
                                src={item.product_image} 
                                alt={item.product_name} 
                                className="w-full h-full object-contain"
                                referrerPolicy="no-referrer"
                              />
                            ) : (
                              <span className="text-[10px] text-muted uppercase font-bold">{item.name.slice(0, 2)}</span>
                            )}
                          </div>

                          <div className="flex-1 min-w-0">
                            <h4 className="text-xs font-bold text-ink truncate" title={item.product_name || item.name}>
                              {item.product_name || item.name}
                            </h4>
                            <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                              {item.brand && (
                                <span className="text-[9px] font-semibold text-brand px-1 py-0.2 bg-brand/5 rounded">
                                  {item.brand}
                                </span>
                              )}
                              {item.unit && (
                                <span className="text-[9px] text-muted">
                                  {item.unit}
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="text-right flex-shrink-0">
                            {item.price !== null ? (
                              <div className="flex flex-col">
                                <span className="text-xs font-mono font-bold text-ink">₹{item.price.toFixed(2)}</span>
                                {hasDiscount && (
                                  <span className="text-[9px] font-mono text-muted line-through">
                                    ₹{item.original_price.toFixed(2)}
                                  </span>
                                )}
                              </div>
                            ) : (
                              <span className="text-xs text-muted">—</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Missing / Unavailable Items */}
                {selectedPlatform.missingItems && selectedPlatform.missingItems.length > 0 && (
                  <div className="space-y-2">
                    <h3 className="text-[10px] font-bold text-red-400 uppercase tracking-wider">Unavailable Items</h3>
                    {selectedPlatform.missingItems.map((item, idx) => (
                      <div key={`miss-${idx}`} className="flex gap-3 items-center p-2.5 rounded-xl border border-dashed border-red-100 bg-red-50/10 opacity-75">
                        <div className="w-10 h-10 rounded-lg border border-dashed border-red-100 bg-red-50/20 flex-shrink-0 flex items-center justify-center">
                          <HelpCircle className="w-4 h-4 text-red-300" />
                        </div>

                        <div className="flex-1 min-w-0">
                          <h4 className="text-xs font-bold text-gray-500 line-through truncate">
                            {item.name}
                          </h4>
                          <span className="text-[9px] text-red-500 font-semibold bg-red-50 px-1 py-0.5 rounded mt-0.5 inline-block">
                            Not available
                          </span>
                        </div>

                        <div className="text-right flex-shrink-0">
                          <span className="text-xs text-gray-400 italic font-medium">—</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="p-5 border-t border-border bg-gray-50 rounded-b-2xl">
                <div className="flex justify-between items-center mb-4">
                  <span className="text-xs font-bold text-muted">Estimated Total</span>
                  <span className="text-lg font-extrabold text-ink">
                    {selectedPlatform.totalMatchedPrice !== null ? `₹${selectedPlatform.totalMatchedPrice.toFixed(2)}` : 'N/A'}
                  </span>
                </div>
                {selectedPlatform.totalMatchedPrice !== null && (
                  <button
                    onClick={() => {
                      const matchedNames = selectedPlatform.availableItems.map(i => i.name);
                      navigate(`/order/${selectedPlatform.id}`, { state: { items: matchedNames, platformData: selectedPlatform } });
                    }}
                    className="btn-primary w-full"
                    id={`order-available-btn-${selectedPlatform.id}`}
                  >
                    Order Available Items
                  </button>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <NavBar />
    </div>
  );
}
