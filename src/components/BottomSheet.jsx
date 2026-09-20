import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Loader2 } from 'lucide-react';
import { trackEvent } from '../lib/analytics';

export default function BottomSheet({ isOpen, onClose, onSubmit }) {
  const [itemName, setItemName] = useState('');
  const [quantity, setQuantity] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  const inputRef = useRef(null);

  // 1. Track 'Quick Add opened' and autofocus when bottom sheet opens
  useEffect(() => {
    if (isOpen) {
      trackEvent('Quick Add opened');
      
      // Focus input with a slight timeout to ensure animation has started/completed
      const timer = setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.focus();
        }
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  // 2. Escape key closes bottom sheet (desktop fallback)
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    const trimmedName = itemName.trim();
    if (!trimmedName || isSubmitting) return;

    try {
      setIsSubmitting(true);
      
      // Dismiss keyboard immediately on mobile
      if (document.activeElement && typeof document.activeElement.blur === 'function') {
        document.activeElement.blur();
      }

      // Submit captured item
      await onSubmit({ 
        item_name: trimmedName, 
        quantity: quantity.trim() || null 
      });

      // Clear input state
      setItemName('');
      setQuantity('');
    } catch (err) {
      console.error('[BottomSheet] Error submitting capture:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop (tap outside to close) */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/40 z-50 max-w-[375px] mx-auto"
          />
          {/* Sheet Container */}
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            drag="y"
            dragConstraints={{ top: 0 }}
            dragElastic={{ top: 0.1, bottom: 0.75 }}
            onDragEnd={(e, info) => {
              if (info.offset.y > 120) {
                onClose();
              }
            }}
            className="fixed bottom-0 left-0 right-0 max-w-[375px] mx-auto bg-white rounded-t-[24px] p-6 pb-8 z-50 h-[50vh] shadow-2xl border-t border-border touch-none"
          >
            {/* Elegant Drag Handle Pill */}
            <div className="w-12 h-1.5 bg-gray-200 rounded-full mx-auto mb-4 cursor-grab active:cursor-grabbing" />

            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-ink">What's running low?</h3>
              <button onClick={onClose} className="p-2 text-muted hover:text-ink">
                <X className="w-6 h-6" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4 touch-auto">
              <div>
                <label className="block text-xs font-semibold text-muted mb-1.5 uppercase tracking-wider">Item Name</label>
                <input
                  type="text"
                  ref={inputRef}
                  disabled={isSubmitting}
                  placeholder="e.g. Milk"
                  className="input-field disabled:opacity-60 disabled:bg-gray-50"
                  value={itemName}
                  onChange={(e) => setItemName(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-muted mb-1.5 uppercase tracking-wider">Quantity (Optional)</label>
                <input
                  type="text"
                  disabled={isSubmitting}
                  placeholder="e.g. 500g"
                  className="input-field disabled:opacity-60 disabled:bg-gray-50"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                />
              </div>
              <button 
                type="submit" 
                disabled={!itemName.trim() || isSubmitting}
                className="btn-primary w-full mt-6 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-4.5 h-4.5 animate-spin" />
                    <span>Adding...</span>
                  </>
                ) : (
                  "Add to today's captures"
                )}
              </button>
            </form>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
