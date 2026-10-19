import React from 'react';
import { NavLink } from 'react-router-dom';
import { ClipboardList, LayoutDashboard, Zap, Hammer, BarChart3 } from 'lucide-react';
import { StationViewId } from '../../config/cafe.config';
import { ALL_STATION_VIEWS } from '../../utils/hostnameViews';

interface NavigationProps {
  allowedViews?: readonly StationViewId[];
}

const STATION_NAV_ITEMS: Record<
  StationViewId,
  {
    to: string;
    fullLabel: string;
    shortLabel: string;
    icon: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' | 'false' }>;
  }
> = {
  register: {
    to: '/register',
    fullLabel: '1. Register Item',
    shortLabel: 'Register Item',
    icon: ClipboardList,
  },
  frontdesk: {
    to: '/frontdesk',
    fullLabel: '2. Front Desk',
    shortLabel: 'Front Desk',
    icon: LayoutDashboard,
  },
  pat: {
    to: '/pat',
    fullLabel: '3. PAT Station',
    shortLabel: 'PAT Station',
    icon: Zap,
  },
  fixer: {
    to: '/fixer',
    fullLabel: '4. Fixer Station',
    shortLabel: 'Fixer Station',
    icon: Hammer,
  },
  reports: {
    to: '/reports',
    fullLabel: '5. Reports',
    shortLabel: 'Reports',
    icon: BarChart3,
  },
};

export const Navigation: React.FC<NavigationProps> = ({
  allowedViews = ALL_STATION_VIEWS,
}) => {
  // Hide navigation bar completely when a hostname only exposes a single view (e.g. register.suttonrepaircafe.app)
  if (allowedViews.length <= 1) {
    return null;
  }

  const isFullSuite = allowedViews.length === ALL_STATION_VIEWS.length;
  const links = allowedViews
    .filter((id) => Boolean(STATION_NAV_ITEMS[id]))
    .map((id) => {
      const item = STATION_NAV_ITEMS[id];
      return {
        to: item.to,
        label: isFullSuite ? item.fullLabel : item.shortLabel,
        icon: item.icon,
      };
    });

  return (
    <nav aria-label="Station navigation" className="bg-white border-b border-slate-200 shadow-sm sticky top-16 z-30">
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
              <Icon className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
              <span>{label}</span>
            </NavLink>
          ))}
        </div>
      </div>
    </nav>
  );
};

