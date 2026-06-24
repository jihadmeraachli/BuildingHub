import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/contexts/AuthContext';
import {
  LayoutDashboard, CalendarDays, Receipt, AlertTriangle,
  Users, Building2, LogOut, X,
} from 'lucide-react';

interface SidebarProps {
  open: boolean;
  onClose: () => void;
}

export function Sidebar({ open, onClose }: SidebarProps) {
  const { t } = useTranslation();
  const { profile, signOut } = useAuth();

  const links = [
    { to: '/dashboard', label: t('nav.dashboard'), icon: LayoutDashboard, roles: ['super_admin', 'building_admin', 'resident'] },
    { to: '/meetings', label: t('nav.meetings'), icon: CalendarDays, roles: ['super_admin', 'building_admin', 'resident'] },
    { to: '/billing', label: t('nav.billing'), icon: Receipt, roles: ['super_admin', 'building_admin', 'resident'] },
    { to: '/issues', label: t('nav.issues'), icon: AlertTriangle, roles: ['super_admin', 'building_admin', 'resident'] },
    { to: '/users', label: t('nav.users'), icon: Users, roles: ['super_admin', 'building_admin'] },
    { to: '/buildings', label: t('nav.buildings'), icon: Building2, roles: ['super_admin'] },
  ] as const;

  const visibleLinks = links.filter(l => profile?.role && (l.roles as readonly string[]).includes(profile.role));

  return (
    <>
      {open && <div className="fixed inset-0 bg-black/30 z-20 lg:hidden" onClick={onClose} />}
      <aside className={`fixed top-0 start-0 h-full w-64 bg-slate-900 text-white flex flex-col z-30 transition-transform duration-200 ${open ? 'translate-x-0' : '-translate-x-full'} lg:translate-x-0 lg:static lg:flex`}>
        <div className="flex items-center justify-between px-5 h-16 border-b border-slate-700">
          <span className="text-lg font-bold tracking-tight">BuildingHub</span>
          <button onClick={onClose} className="lg:hidden text-slate-400 hover:text-white cursor-pointer">
            <X size={18} />
          </button>
        </div>

        <nav className="flex-1 py-4 px-3 space-y-1 overflow-y-auto">
          {visibleLinks.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              onClick={onClose}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${isActive ? 'bg-blue-600 text-white' : 'text-slate-300 hover:bg-slate-800 hover:text-white'}`
              }
            >
              <Icon size={18} />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="px-3 py-4 border-t border-slate-700">
          <button
            onClick={signOut}
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-slate-300 hover:bg-slate-800 hover:text-white w-full transition-colors cursor-pointer"
          >
            <LogOut size={18} />
            {t('nav.logout')}
          </button>
        </div>
      </aside>
    </>
  );
}
