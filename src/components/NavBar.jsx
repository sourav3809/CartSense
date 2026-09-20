import { Home, List, History } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';

export default function NavBar() {
  const location = useLocation();
  
  const tabs = [
    { icon: Home, label: 'Home', path: '/' },
    { icon: List, label: 'List', path: '/running-low' },
    { icon: History, label: 'History', path: '/history' },
  ];

  return (
    <nav className="fixed bottom-0 left-0 right-0 max-w-[375px] mx-auto bg-white border-t border-border flex justify-around items-center h-[64px] z-40">
      {tabs.map(tab => {
        const isActive = location.pathname === tab.path;
        const Icon = tab.icon;
        return (
          <Link
            key={tab.path}
            to={tab.path}
            className={`flex flex-col items-center gap-1 transition-colors ${isActive ? 'text-brand nav-item-active' : 'text-muted'}`}
          >
            <div className="nav-icon-bg">
              <Icon className="w-5 h-5" />
            </div>
            <span className="text-[11px] font-medium">{tab.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
