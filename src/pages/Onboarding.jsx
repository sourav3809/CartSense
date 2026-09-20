import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { Check, Plus, ChevronLeft, ChevronRight, Bell } from 'lucide-react';
import { db } from '../lib/firebase';
import { doc, updateDoc, collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { registerPushSubscription } from '../lib/notifications';

const COMMON_ITEMS = [
  'Milk', 'Bread', 'Eggs', 'Rice', 'Atta', 'Cooking Oil', 'Dal', 'Sugar',
  'Salt', 'Tea', 'Coffee', 'Onions', 'Tomatoes', 'Potatoes', 'Coriander',
  'Curry Leaves', 'Lemons', 'Yoghurt', 'Butter', 'Paneer', 'Biscuits',
  'Maggi Noodles', 'Soap', 'Shampoo'
];

const CONSUMPTION_OPTIONS = [
  { label: '1–2 days', value: 2 },
  { label: '3–5 days', value: 4 },
  { label: '1 week', value: 7 },
  { label: '2 weeks', value: 14 },
  { label: 'Monthly', value: 30 }
];

export function getItemDefaultQuantityConfig(itemName) {
  const name = itemName.toLowerCase();
  if (name.includes('milk')) {
    return { value: '500', unit: 'ml', units: ['ml', 'L'], quick: ['500ml', '1 L', '2 L'] };
  }
  if (name.includes('bread')) {
    return { value: '450', unit: 'gm', units: ['gm', 'pack'], quick: ['400gm', '450gm', '700gm'] };
  }
  if (name.includes('egg')) {
    return { value: '10', unit: 'eggs', units: ['eggs', 'pack'], quick: ['6 eggs', '10 eggs', '12 eggs', '30 eggs'] };
  }
  if (name.includes('rice') || name.includes('atta') || name.includes('sugar') || name.includes('dal') || name.includes('salt')) {
    return { value: '1', unit: 'kg', units: ['kg', 'gm'], quick: ['1kg', '2kg', '5kg', '10kg'] };
  }
  if (name.includes('oil')) {
    return { value: '1', unit: 'L', units: ['L', 'ml'], quick: ['500ml', '1 L', '2 L', '5 L'] };
  }
  if (name.includes('coffee') || name.includes('tea')) {
    return { value: '250', unit: 'gm', units: ['gm', 'kg'], quick: ['100gm', '250gm', '500gm', '1kg'] };
  }
  if (name.includes('onion') || name.includes('tomato') || name.includes('potato')) {
    return { value: '1', unit: 'kg', units: ['kg', 'gm'], quick: ['500gm', '1kg', '2kg', '5kg'] };
  }
  if (name.includes('yoghurt') || name.includes('curd') || name.includes('butter') || name.includes('paneer')) {
    return { value: '200', unit: 'gm', units: ['gm', 'kg', 'cup'], quick: ['100gm', '200gm', '400gm', '500gm'] };
  }
  if (name.includes('coriander') || name.includes('leaves') || name.includes('lemon')) {
    return { value: '100', unit: 'gm', units: ['gm', 'pcs'], quick: ['50gm', '100gm', '4 pcs', '6 pcs'] };
  }
  if (name.includes('biscuit') || name.includes('maggi') || name.includes('noodles') || name.includes('soap')) {
    return { value: '1', unit: 'pack', units: ['pack', 'pcs', 'gm'], quick: ['1 pack', '2 packs', '4 pcs', '120gm'] };
  }
  if (name.includes('shampoo')) {
    return { value: '300', unit: 'ml', units: ['ml', 'L', 'bottle'], quick: ['100ml', '300ml', '650ml'] };
  }
  // Default fallback
  return { value: '1', unit: 'pcs', units: ['pcs', 'pack', 'kg', 'L', 'gm', 'ml'], quick: ['1 pcs', '2 pcs', '1 pack'] };
}

export default function Onboarding() {
  const [step, setStep] = useState(1);
  const [selectedItems, setSelectedItems] = useState([]);
  const [customItem, setCustomItem] = useState('');
  const [itemsConfig, setItemsConfig] = useState({});
  const [nudgeThreshold, setNudgeThreshold] = useState(4);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const userId = localStorage.getItem('userId');

  const toggleItem = (item) => {
    if (selectedItems.includes(item)) {
      setSelectedItems(selectedItems.filter(i => i !== item));
    } else {
      setSelectedItems([...selectedItems, item]);
      if (!itemsConfig[item]) {
        const qConfig = getItemDefaultQuantityConfig(item);
        setItemsConfig(prev => ({
          ...prev,
          [item]: {
            consumption_days: 7,
            is_critical: ['Milk', 'Bread', 'Cooking Oil'].includes(item),
            is_kirana: ['Coriander', 'Curry Leaves', 'Lemons'].includes(item),
            quantity_value: qConfig.value,
            quantity_unit: qConfig.unit
          }
        }));
      }
    }
  };

  const addCustomItem = () => {
    if (customItem && !COMMON_ITEMS.includes(customItem) && !selectedItems.includes(customItem)) {
      toggleItem(customItem);
      setCustomItem('');
    }
  };

  const updateItemConfig = (item, key, value) => {
    setItemsConfig(prev => ({
      ...prev,
      [item]: { ...prev[item], [key]: value }
    }));
  };

  const handleComplete = async () => {
    setLoading(true);
    try {
      // 1. Save items to Firestore
      const itemsCollectionRef = collection(db, 'users', userId, 'household_items');
      for (const itemName of selectedItems) {
        const config = itemsConfig[itemName];
        
        let quantityStr = '1 unit';
        if (config.quantity_value && config.quantity_unit) {
          const unit = config.quantity_unit;
          if (['ml', 'gm'].includes(unit)) {
            quantityStr = `${config.quantity_value}${unit}`;
          } else {
            quantityStr = `${config.quantity_value} ${unit}`;
          }
        }

        await addDoc(itemsCollectionRef, {
          item_name: itemName,
          consumption_days: config.consumption_days,
          is_critical: config.is_critical,
          is_kirana: config.is_kirana,
          quantity_per_order: quantityStr,
          confidence_level: 'low',
          last_ordered_at: serverTimestamp(),
          created_at: serverTimestamp(),
        });
      }

      // 2. Update user profile in Firestore
      const userDocRef = doc(db, 'users', userId);
      const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata';
      await updateDoc(userDocRef, {
        nudge_threshold: nudgeThreshold,
        timezone: userTimezone,
        onboarding_complete: true
      });

      navigate('/');
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const requestNotifications = async () => {
    try {
      await registerPushSubscription(userId);
    } catch (err) {
      console.warn('[Onboarding] Error subscribing to push:', err);
    }
    await handleComplete();
  };

  const renderStep = () => {
    switch (step) {
      case 1:
        return (
          <div className="space-y-6">
            <div>
              <h2 className="text-xl font-bold mb-2">Add your household items</h2>
              <p className="text-sm text-gray-500">Select the essentials you usually stock.</p>
            </div>
            <div className="grid grid-cols-3 gap-3">
              {COMMON_ITEMS.map(item => (
                <button
                  key={item}
                  onClick={() => toggleItem(item)}
                  className={`p-3 rounded-xl border text-center transition-all ${selectedItems.includes(item) ? 'border-brand bg-brand/5 ring-1 ring-brand' : 'border-gray-200 bg-white'}`}
                >
                  <div className="text-xs font-medium truncate">{item}</div>
                  {selectedItems.includes(item) && <Check className="w-3 h-3 text-brand mx-auto mt-1" />}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Add custom item..."
                className="input-field flex-1"
                value={customItem}
                onChange={(e) => setCustomItem(e.target.value)}
              />
              <button onClick={addCustomItem} className="btn-secondary px-3">
                <Plus className="w-5 h-5" />
              </button>
            </div>
          </div>
        );
      case 2:
        return (
          <div className="space-y-6">
            <div>
              <h2 className="text-xl font-bold mb-2">How long does each item last?</h2>
              <p className="text-sm text-gray-500">Estimate your typical consumption and quantity.</p>
            </div>
            <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-2">
              {selectedItems.map(item => (
                <div key={item} className="p-4 bg-white border border-gray-100 rounded-xl space-y-3.5 shadow-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-bold text-ink">{item}</span>
                  </div>
                  
                  {/* Consumption Rate Selection */}
                  <div>
                    <span className="block text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-2">How long does it last?</span>
                    <div className="flex flex-wrap gap-2">
                      {CONSUMPTION_OPTIONS.map(opt => (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => updateItemConfig(item, 'consumption_days', opt.value)}
                          className={`px-3 py-1.5 rounded-full text-[10px] font-medium border transition-all ${itemsConfig[item]?.consumption_days === opt.value ? 'bg-brand text-white border-brand' : 'bg-white text-gray-500 border-gray-200'}`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Quantity Input */}
                  <div className="pt-2 border-t border-gray-50 space-y-2">
                    <span className="block text-[11px] font-bold text-gray-400 uppercase tracking-wider">
                      Quantity consumed within this duration
                    </span>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        placeholder="e.g. 500"
                        className="input-field max-w-[120px]"
                        value={itemsConfig[item]?.quantity_value || ''}
                        onChange={(e) => updateItemConfig(item, 'quantity_value', e.target.value)}
                      />
                      <select
                        className="input-field flex-1 appearance-none cursor-pointer pr-8 bg-no-repeat bg-[right_10px_center] text-sm"
                        value={itemsConfig[item]?.quantity_unit || ''}
                        onChange={(e) => updateItemConfig(item, 'quantity_unit', e.target.value)}
                      >
                        {getItemDefaultQuantityConfig(item).units.map(unit => (
                          <option key={unit} value={unit}>{unit}</option>
                        ))}
                      </select>
                    </div>

                    {/* Quick Choice Selection Chips */}
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {getItemDefaultQuantityConfig(item).quick.map(v => {
                        const numericPart = parseFloat(v);
                        const unitPart = v.replace(/[0-9.]/g, '').trim();
                        const isSelected = (itemsConfig[item]?.quantity_value === String(numericPart)) && (itemsConfig[item]?.quantity_unit === unitPart);
                        
                        return (
                          <button
                            key={v}
                            type="button"
                            onClick={() => {
                              updateItemConfig(item, 'quantity_value', String(numericPart));
                              updateItemConfig(item, 'quantity_unit', unitPart);
                            }}
                            className={`px-2 py-1 rounded-md text-[9px] font-semibold transition-all ${isSelected ? 'bg-brand/10 text-brand border border-brand/20' : 'bg-gray-50 text-gray-500 hover:bg-gray-100 border border-transparent'}`}
                          >
                            {v}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      case 3:
        return (
          <div className="space-y-6">
            <div>
              <h2 className="text-xl font-bold mb-2">Mark critical items</h2>
              <p className="text-sm text-gray-500">Get urgent alerts for these items.</p>
            </div>
            <div className="space-y-4">
              {selectedItems.map(item => (
                <div key={item} className="flex items-center justify-between p-3 border border-gray-100 rounded-xl">
                  <div>
                    <div className="text-sm font-medium">{item}</div>
                    {itemsConfig[item]?.is_critical && (
                      <p className="text-[10px] text-brand mt-0.5">Urgent alert at ≤ 1 day left</p>
                    )}
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      className="sr-only peer"
                      checked={itemsConfig[item]?.is_critical || false}
                      onChange={(e) => updateItemConfig(item, 'is_critical', e.target.checked)}
                    />
                    <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-brand"></div>
                  </label>
                </div>
              ))}
            </div>
          </div>
        );
      case 4:
        return (
          <div className="space-y-6">
            <div>
              <h2 className="text-xl font-bold mb-2">Mark kirana items</h2>
              <p className="text-sm text-gray-500">Items you buy from local stores.</p>
            </div>
            <div className="space-y-4">
              {selectedItems.map(item => (
                <div key={item} className="flex items-center justify-between p-3 border border-gray-100 rounded-xl">
                  <div>
                    <div className="text-sm font-medium">{item}</div>
                    {itemsConfig[item]?.is_kirana && (
                      <p className="text-[10px] text-gray-500 mt-0.5">Excluded from online comparisons</p>
                    )}
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      className="sr-only peer"
                      checked={itemsConfig[item]?.is_kirana || false}
                      onChange={(e) => updateItemConfig(item, 'is_kirana', e.target.checked)}
                    />
                    <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-brand"></div>
                  </label>
                </div>
              ))}
            </div>
          </div>
        );
      case 5:
        return (
          <div className="space-y-8 flex flex-col items-center text-center">
            <div>
              <h2 className="text-xl font-bold mb-2">How many items running low before we notify you?</h2>
            </div>
            <div className="flex items-center gap-8">
              <button
                onClick={() => setNudgeThreshold(Math.max(2, nudgeThreshold - 1))}
                className="w-12 h-12 rounded-full border border-gray-200 flex items-center justify-center text-2xl"
              >
                -
              </button>
              <div className="text-6xl font-bold text-brand">{nudgeThreshold}</div>
              <button
                onClick={() => setNudgeThreshold(Math.min(8, nudgeThreshold + 1))}
                className="w-12 h-12 rounded-full border border-gray-200 flex items-center justify-center text-2xl"
              >
                +
              </button>
            </div>
            <p className="text-sm text-gray-600 px-6">
              {nudgeThreshold === 2 && "Notify me as soon as 2 items are running low — good for daily orderers."}
              {(nudgeThreshold >= 3 && nudgeThreshold <= 4) && "A balanced setting — works well for most households."}
              {nudgeThreshold >= 5 && "Notify me only when several items need restocking — good for weekly orderers."}
            </p>
          </div>
        );
      case 6:
        return (
          <div className="space-y-6 text-center py-8">
            <div className="w-20 h-20 bg-brand/10 rounded-full flex items-center justify-center mx-auto mb-4">
              <Bell className="w-10 h-10 text-brand" />
            </div>
            <h2 className="text-xl font-bold">Get notified at the right time</h2>
            <p className="text-sm text-gray-600 leading-relaxed">
              CartSense checks your stock every evening. We'll notify you when it's a good time to review your list — based on what's running low and your ordering habits.
            </p>
            <div className="pt-8 space-y-4">
              <button onClick={requestNotifications} className="btn-primary w-full">
                Allow notifications
              </button>
              <button onClick={handleComplete} className="text-sm text-gray-400 font-medium w-full">
                Skip for now
              </button>
            </div>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen bg-white p-6 flex flex-col">
      {/* Progress Bar */}
      <div className="mb-8">
        <div className="flex justify-between text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">
          <span>Step {step} of 6</span>
          <span>{Math.round((step / 6) * 100)}%</span>
        </div>
        <div className="h-1.5 w-full bg-gray-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-brand transition-all duration-500"
            style={{ width: `${(step / 6) * 100}%` }}
          />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1">
        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.3 }}
          >
            {renderStep()}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Navigation */}
      {step < 6 && (
        <div className="mt-8 flex gap-4">
          {step > 1 && (
            <button
              onClick={() => setStep(step - 1)}
              className="btn-secondary flex-1 gap-2"
            >
              <ChevronLeft className="w-4 h-4" /> Back
            </button>
          )}
          <button
            onClick={() => setStep(step + 1)}
            disabled={step === 1 && selectedItems.length === 0}
            className="btn-primary flex-1 gap-2"
          >
            Next <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}

      {loading && (
        <div className="fixed inset-0 bg-white/80 flex items-center justify-center z-50">
          <div className="text-brand font-bold">Setting up your home...</div>
        </div>
      )}
    </div>
  );
}
