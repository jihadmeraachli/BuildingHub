import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/contexts/AuthContext';
import {
  LayoutDashboard, Wallet, AlertTriangle, CalendarDays,
  Layers, Users, Building2, LogOut, X, ClipboardCheck, FileSignature, CalendarClock,
} from 'lucide-react';

interface SidebarProps {
  open: boolean;
  onClose: () => void;
}

export function Sidebar({ open, onClose }: SidebarProps) {
  const { t, i18n } = useTranslation();
  const { profile, signOut, canAny, isPlatformAdmin } = useAuth();

  const canStructure = canAny('unit.manage');
  const canPeople = canAny('resident.manage') || canAny('resident.approve');
  const canBuildings = isPlatformAdmin;

  const links = [
    { to: '/dashboard', label: t('nav.dashboard'), icon: LayoutDashboard, show: true },
    { to: '/finance', label: t('nav.finance'), icon: Wallet, show: true },
    { to: '/dues', label: t('nav.dues'), icon: CalendarClock, show: canStructure || canAny('finance.view') },
    { to: '/issues', label: t('nav.issues'), icon: AlertTriangle, show: true },
    { to: '/meetings', label: t('nav.meetings'), icon: CalendarDays, show: true },
    { to: '/inspections', label: t('nav.inspections'), icon: ClipboardCheck, show: true },
    { to: '/contracts', label: t('nav.contracts'), icon: FileSignature, show: true },
    { to: '/structure', label: t('nav.structure'), icon: Layers, show: canStructure },
    { to: '/users', label: t('nav.people'), icon: Users, show: canPeople },
    { to: '/buildings', label: t('nav.buildings'), icon: Building2, show: canBuildings },
  ].filter((l) => l.show);

  // RTL-correct off-canvas direction (the bug fix): a start-anchored drawer must
  // slide toward the *start* edge — left in LTR, right in RTL.
  const rtl = i18n.dir() === 'rtl';
  const offCanvas = rtl ? 'translate-x-full' : '-translate-x-full';

  return (
    <>
      {open && <div className="fixed inset-0 bg-slate-900/40 z-20 lg:hidden" onClick={onClose} />}
      <aside
        className={`fixed inset-y-0 start-0 h-full w-64 flex flex-col z-30 bg-gradient-to-b from-slate-900 to-slate-950 text-white transition-transform duration-200
        ${open ? 'translate-x-0' : offCanvas} lg:translate-x-0 lg:static lg:flex`}
      >
        <div className="flex items-center justify-between px-5 h-16 border-b border-white/5">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center font-extrabold text-sm shadow-lg shadow-indigo-900/40">
              BH
            </div>
            <span className="text-[15px] font-bold tracking-tight">BuildingHub</span>
          </div>
          <button onClick={onClose} className="lg:hidden text-slate-400 hover:text-white cursor-pointer">
            <X size={18} />
          </button>
        </div>

        <nav className="flex-1 py-4 px-3 space-y-1 overflow-y-auto">
          {links.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              onClick={onClose}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-900/40'
                    : 'text-slate-300 hover:bg-white/5 hover:text-white'
                }`
              }
            >
              <Icon size={18} />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="px-3 py-4 border-t border-white/5">
          <div className="flex items-center gap-3 px-3 py-2 mb-1">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-400 to-violet-500 flex items-center justify-center text-xs font-semibold flex-shrink-0">
              {profile?.full_name?.charAt(0).toUpperCase() ?? '?'}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">{profile?.full_name ?? '—'}</p>
              <p className="text-xs text-slate-400 truncate">
                {isPlatformAdmin ? 'Platform Admin' : (profile?.role?.replace('_', ' ') ?? 'Member')}
              </p>
            </div>
          </div>
          <button
            onClick={signOut}
            className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-slate-300 hover:bg-white/5 hover:text-white w-full transition-colors cursor-pointer"
          >
            <LogOut size={18} />
            {t('nav.logout')}
          </button>
        </div>
      </aside>
    </>
  );
}
