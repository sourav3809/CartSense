import { useState, useEffect } from 'react';
import { WifiOff } from 'lucide-react';

export default function OfflineBanner() {
  const [isOffline, setIsOffline] = useState(!navigator.onLine);

  useEffect(() => {
    const handleOffline = () => setIsOffline(true);
    const handleOnline = () => {
      setIsOffline(false);
      window.dispatchEvent(new CustomEvent('network-restored'));
    };

    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);

    return () => {
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
    };
  }, []);

  if (!isOffline) return null;

  return (
    <div className="bg-amber-600 text-white text-xs font-semibold px-3 py-2 text-center sticky top-0 z-50 shadow-sm flex items-center justify-center gap-2 animate-in fade-in slide-in-from-top duration-200">
      <WifiOff className="w-3.5 h-3.5 shrink-0" />
      <span>You are offline. Some live information may not be available.</span>
    </div>
  );
}
