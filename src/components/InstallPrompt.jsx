import { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { X, Download, Share, Sparkles, RefreshCw, WifiOff } from 'lucide-react';

export default function InstallPrompt() {
  const location = useLocation();
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  
  // Dialog visibility states
  const [showAndroidCard, setShowAndroidCard] = useState(false);
  const [showIOSCard, setShowIOSCard] = useState(false);
  const [showWelcomeCard, setShowWelcomeCard] = useState(false);
  const [showUpdateAlert, setShowUpdateAlert] = useState(false);
  const [updateRegistration, setUpdateRegistration] = useState(null);
  const [isOffline, setIsOffline] = useState(!navigator.onLine);

  // Check if we should block prompting on specific paths to respect "Never Interrupt"
  const isInterruptionBlockPath = 
    location.pathname === '/auth' || 
    location.pathname === '/onboarding' || 
    location.pathname === '/prices' || 
    location.pathname.startsWith('/order');

  // 1. Detect environment and installation state
  useEffect(() => {
    // Detect Standalone/Installed Mode
    const checkStandalone = () => {
      const isStandalone = 
        window.matchMedia('(display-mode: standalone)').matches || 
        window.navigator.standalone === true;
      setIsInstalled(isStandalone);
      return isStandalone;
    };

    const standalone = checkStandalone();

    // Detect iOS
    const detectIOS = () => {
      const userAgent = window.navigator.userAgent.toLowerCase();
      const isDeviceIOS = /ipad|iphone|ipod/.test(userAgent) || 
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
      setIsIOS(isDeviceIOS);
      return isDeviceIOS;
    };

    const ios = detectIOS();

    // 2. Handle First Launch Experience
    if (standalone) {
      const welcomeShown = localStorage.getItem('cartsense_first_launch_shown');
      if (!welcomeShown) {
        setShowWelcomeCard(true);
      }
    }

    // 3. Handle beforeinstallprompt for Android / Chrome
    const handleBeforeInstallPrompt = (e) => {
      // Prevent the default browser prompt
      e.preventDefault();
      // Store the event so it can be triggered later
      setDeferredPrompt(e);
      
      // If not installed and not dismissed in current session, show prompt
      const isLater = sessionStorage.getItem('cartsense_install_later') === 'true';
      if (!standalone && !isLater) {
        setShowAndroidCard(true);
      }
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    // Track if app gets installed
    const handleAppInstalled = () => {
      console.log('[PWA] App installed successfully');
      setIsInstalled(true);
      setShowAndroidCard(false);
      setShowIOSCard(false);
      setDeferredPrompt(null);
    };

    window.addEventListener('appinstalled', handleAppInstalled);

    // 4. iOS Specific Prompt Trigger (Show once per session)
    if (ios && !standalone) {
      const iosDismissed = sessionStorage.getItem('cartsense_ios_install_dismissed') === 'true';
      if (!iosDismissed) {
        setShowIOSCard(true);
      }
    }

    // 5. Handle network online/offline state
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // 6. Handle Service Worker Updates
    const handleSWUpdate = (e) => {
      console.log('[PWA] SW Update found custom event fired');
      setUpdateRegistration(e.detail);
      setShowUpdateAlert(true);
    };

    window.addEventListener('swUpdateAvailable', handleSWUpdate);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('swUpdateAvailable', handleSWUpdate);
    };
  }, []);

  // 2. Install actions
  const handleAndroidInstall = async () => {
    if (!deferredPrompt) return;
    
    // Show the browser install prompt
    deferredPrompt.prompt();
    
    // Wait for the user's choice
    const { outcome } = await deferredPrompt.userChoice;
    console.log(`[PWA] User response to install prompt: ${outcome}`);
    
    if (outcome === 'accepted') {
      setIsInstalled(true);
      setShowAndroidCard(false);
    }
    // Clear the deferred prompt regardless of outcome
    setDeferredPrompt(null);
  };

  const handleAndroidLater = () => {
    sessionStorage.setItem('cartsense_install_later', 'true');
    setShowAndroidCard(false);
  };

  const handleIOSDismiss = () => {
    sessionStorage.setItem('cartsense_ios_install_dismissed', 'true');
    setShowIOSCard(false);
  };

  const handleWelcomeDismiss = () => {
    localStorage.setItem('cartsense_first_launch_shown', 'true');
    setShowWelcomeCard(false);
  };

  const handleApplyUpdate = () => {
    if (updateRegistration && updateRegistration.waiting) {
      console.log('[PWA] Sending skip waiting to service worker');
      updateRegistration.waiting.postMessage({ type: 'SKIP_WAITING' });
    } else {
      // Fallback reload if SW object isn't available
      window.location.reload();
    }
  };

  // Return empty if we are in an interruption path (e.g. login, onboarding, checkout, modal flows)
  if (isInterruptionBlockPath) {
    // We still show the critical offline alert at the very top if it's essential, but hide general installation dialogs
    return (
      <AnimatePresence>
        {isOffline && (
          <motion.div
            initial={{ y: -50, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -50, opacity: 0 }}
            className="absolute top-0 left-0 right-0 bg-[#ea580c] text-white py-2 px-4 text-center text-xs font-semibold z-50 flex items-center justify-center gap-2 max-w-[375px] mx-auto"
          >
            <WifiOff className="w-4 h-4 shrink-0" />
            <span>You're offline. Some features may be limited.</span>
          </motion.div>
        )}
      </AnimatePresence>
    );
  }

  return (
    <>
      {/* Offline Alert Banner */}
      <AnimatePresence>
        {isOffline && (
          <motion.div
            initial={{ y: -50, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -50, opacity: 0 }}
            className="absolute top-0 left-0 right-0 bg-rose-600 text-white py-2.5 px-4 text-center text-[12px] font-medium z-50 flex items-center justify-center gap-2 max-w-[375px] mx-auto shadow-md"
          >
            <WifiOff className="w-4 h-4 shrink-0" />
            <span>You're offline. Some information may be unavailable until your connection is restored.</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* SW Update Alert Banner (Top sticky) */}
      <AnimatePresence>
        {showUpdateAlert && (
          <motion.div
            initial={{ y: -50, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -50, opacity: 0 }}
            className="absolute top-0 left-0 right-0 bg-brand text-white py-2.5 px-4 text-center text-[12px] font-semibold z-50 flex items-center justify-between gap-2 max-w-[375px] mx-auto shadow-lg"
          >
            <div className="flex items-center gap-2">
              <RefreshCw className="w-4 h-4 animate-spin" />
              <span>A new version of CartSense is available!</span>
            </div>
            <button
              onClick={handleApplyUpdate}
              className="bg-white text-brand px-3 py-1 rounded-[6px] text-xs font-bold whitespace-nowrap shadow-sm hover:bg-gray-50 active:scale-95 transition-all"
            >
              Update Now
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Android/Chrome Installation Floating Card */}
      <AnimatePresence>
        {showAndroidCard && !isInstalled && (
          <motion.div
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 100, opacity: 0 }}
            className="absolute bottom-[76px] left-4 right-4 bg-white border border-border rounded-2xl p-4 shadow-2xl z-40 max-w-[343px] mx-auto"
          >
            <div className="flex items-start justify-between mb-2">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 bg-brand/10 text-brand rounded-lg flex items-center justify-center">
                  <Download className="w-4 h-4" />
                </div>
                <h4 className="text-[14px] font-extrabold text-ink">Install CartSense</h4>
              </div>
              <button onClick={handleAndroidLater} className="p-1 text-muted hover:text-ink">
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-[12px] text-muted leading-relaxed mb-4">
              Install CartSense on your device for faster access and a better experience.
            </p>
            <div className="flex gap-2">
              <button
                onClick={handleAndroidLater}
                className="btn-secondary flex-1 h-[36px] rounded-lg"
              >
                Later
              </button>
              <button
                onClick={handleAndroidInstall}
                className="btn-primary flex-1 h-[36px] rounded-lg"
              >
                Install
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* iOS/Safari Specific Installation Floating Card */}
      <AnimatePresence>
        {showIOSCard && isIOS && !isInstalled && (
          <motion.div
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 100, opacity: 0 }}
            className="absolute bottom-[76px] left-4 right-4 bg-white border border-border rounded-2xl p-4 shadow-2xl z-40 max-w-[343px] mx-auto"
          >
            <div className="flex items-start justify-between mb-2.5">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 bg-brand/10 text-brand rounded-lg flex items-center justify-center">
                  <Share className="w-4 h-4" />
                </div>
                <h4 className="text-[14px] font-extrabold text-ink">Install CartSense</h4>
              </div>
              <button onClick={handleIOSDismiss} className="p-1 text-muted hover:text-ink">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="text-[12px] text-muted space-y-2 mb-4 leading-relaxed">
              <p>Install CartSense on your iPhone for quick access and full-screen convenience:</p>
              <ol className="list-decimal pl-4 space-y-1 text-ink font-medium">
                <li>Tap the <span className="font-semibold text-brand">Share</span> button in Safari.</li>
                <li>Scroll down and tap <span className="font-semibold text-brand">"Add to Home Screen"</span>.</li>
              </ol>
            </div>
            <button
              onClick={handleIOSDismiss}
              className="btn-primary w-full h-[36px] rounded-lg"
            >
              Got it
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Standalone Welcome Card (First Launch) */}
      <AnimatePresence>
        {showWelcomeCard && isInstalled && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-6 max-w-[375px] mx-auto">
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white rounded-2xl w-full max-w-[320px] p-6 shadow-2xl text-center border border-border"
            >
              <div className="w-12 h-12 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-4">
                <Sparkles className="w-6 h-6 animate-pulse" />
              </div>
              <h3 className="text-[16px] font-extrabold text-ink mb-1">Welcome to CartSense</h3>
              <p className="text-[12px] text-muted leading-relaxed mb-6">
                Your household stock assistant is now installed. Enjoy faster speeds and offline support!
              </p>
              <button
                onClick={handleWelcomeDismiss}
                className="btn-primary w-full h-[40px] rounded-lg font-bold"
              >
                Dismiss
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}
