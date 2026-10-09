import React from 'react';
import { NavLink } from 'react-router-dom';
import { ClipboardList, LayoutDashboard, Zap, Hammer, BarChart3 } from 'lucide-react';

export const Navigation: React.FC = () => {
  const links = [
    { to: '/register', label: '1. Register Item', icon: ClipboardList },
    { to: '/frontdesk', label: '2. Front Desk', icon: LayoutDashboard },
    { to: '/pat', label: '3. PAT Station', icon: Zap },
    { to: '/fixer', label: '4. Fixer Station', icon: Hammer },
    { to: '/reports', label: '5. Reports', icon: BarChart3 },
  ];

  return (
    <nav className="bg-white border-b border-slate-200 shadow-sm sticky top-16 z-30">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex space-x-1 sm:space-x-4 overflow-x-auto py-2 no-scrollbar">
          {links.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `inline-flex items-center gap-2 px-3 py-2 rounded-lg text-xs sm:text-sm font-semibold whitespace-nowrap transition-all ${
                  isActive
                    ? 'bg-emerald-100 text-emerald-900 border border-emerald-300 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                }`
              }
            >
              <Icon className="h-4 w-4 flex-shrink-0" />
              <span>{label}</span>
            </NavLink>
          ))}
        </div>
      </div>
    </nav>
  );
};
