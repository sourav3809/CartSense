import { Link } from 'react-router-dom';
import { Check } from 'lucide-react';

export default function RunningLowCard({ items = [] }) {
  if (items.length === 0) {
    return (
      <div className="card flex flex-col items-center justify-center py-8 space-y-2">
        <div className="w-12 h-12 bg-green-50 rounded-full flex items-center justify-center text-green-500">
          <Check className="w-6 h-6" />
        </div>
        <p className="text-sm font-medium text-ink">Everything looks stocked up</p>
      </div>
    );
  }

  return (
    <div className="card space-y-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-bold text-ink">Running low</h3>
        <span className="bg-brand text-white text-[11px] font-bold px-2 py-0.5 rounded-[12px]">
          {items.length}
        </span>
      </div>

      <div className="divide-y divide-[#f3f4f6]">
        {items.slice(0, 3).map(item => (
          <div key={item.id} className="py-2.5 flex items-center justify-between first:pt-0 last:pb-0">
            <div className="flex flex-col">
              <div className="flex items-center gap-2">
                <span className="text-[15px] font-bold text-ink">{item.item_name}</span>
                {item.is_kirana && (
                  <span className="text-[8px] bg-amber-50 text-amber-600 px-1.5 py-0.5 rounded font-bold uppercase tracking-wider">Kirana</span>
                )}
              </div>
              <span className={`text-[12px] mt-0.5 font-medium ${item.days_remaining <= 1 ? 'text-[#dc2626]' : 'text-[#f59e0b]'}`}>
                {item.days_remaining <= 0 ? "Due today" : `~${item.days_remaining} days left`}
              </span>
            </div>
            <span className={`badge pill-${item.confidence_level || 'low'} text-[12px] rounded-[6px] px-2 py-1`}>
              {item.confidence_level || 'low'}
            </span>
          </div>
        ))}
      </div>

      {items.length > 3 && (
        <div className="text-center mt-3 pt-3 border-t border-[#f3f4f6]">
          <Link to="/running-low" className="text-brand text-[12px] font-bold no-underline">
            View all {items.length} items →
          </Link>
        </div>
      )}
    </div>
  );
}
