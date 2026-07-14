import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/contexts/AuthContext';
import {
  LayoutDashboard, Wallet, AlertTriangle, CalendarDays,
  Layers, Users, Building2, LogOut, X, ClipboardCheck, FileSignature,
  CalendarClock, Settings, ChevronDown,
} from 'lucide-react';

interface SidebarProps {
  open: boolean;
  onClose: () => void;
}

const SETTINGS_KEY = 'bh_settings_open';

export function Sidebar({ open, onClose }: SidebarProps) {
  const { t, i18n } = useTranslation();
  const { profile, signOut, canAny, isPlatformAdmin, grants } = useAuth();
  const location = useLocation();

  const isOrgAdmin = grants.some(g => g.scope_type === 'org' && g.role === 'org_admin');
  const canStructure = canAny('unit.manage') || isOrgAdmin;
  const canPeople = canAny('resident.manage') || canAny('resident.approve') || isOrgAdmin;
  const canBuildings = isPlatformAdmin || isOrgAdmin;

  const displayRole = isPlatformAdmin
    ? 'Platform Admin'
    : grants.some(g => g.role === 'org_admin') ? 'Org Admin'
    : grants.some(g => g.role === 'building_admin') ? 'Building Admin'
    : grants.some(g => g.role === 'org_finance' || g.role === 'building_finance') ? 'Finance'
    : grants.some(g => g.role === 'viewer') ? 'Viewer'
    : profile?.role?.replace('_', ' ') ?? 'Member';

  const operationsLinks = [
    { to: '/dashboard', label: t('nav.dashboard'), icon: LayoutDashboard, show: true },
    { to: '/finance', label: t('nav.finance'), icon: Wallet, show: true },
    { to: '/dues', label: t('nav.dues'), icon: CalendarClock, show: canStructure || canAny('finance.view') },
    { to: '/issues', label: t('nav.issues'), icon: AlertTriangle, show: true },
    { to: '/meetings', label: t('nav.meetings'), icon: CalendarDays, show: true },
    { to: '/inspections', label: t('nav.inspections'), icon: ClipboardCheck, show: true },
    { to: '/contracts', label: t('nav.contracts'), icon: FileSignature, show: true },
  ].filter(l => l.show);

  const settingsLinks = [
    { to: '/buildings', label: t('nav.buildings'), icon: Building2, show: canBuildings },
    { to: '/structure', label: t('nav.structure'), icon: Layers, show: canStructure },
    { to: '/users', label: t('nav.people'), icon: Users, show: canPeople },
  ].filter(l => l.show);

  const settingsRoutes = settingsLinks.map(l => l.to);
  const isInSettings = settingsRoutes.some(r => location.pathname.startsWith(r));

  const [settingsOpen, setSettingsOpen] = useState<boolean>(() => {
    const saved = localStorage.getItem(SETTINGS_KEY);
    return saved !== null ? saved === 'true' : isInSettings;
  });

  function toggleSettings() {
    const next = !settingsOpen;
    setSettingsOpen(next);
    localStorage.setItem(SETTINGS_KEY, String(next));
  }

  const rtl = i18n.dir() === 'rtl';
  const offCanvas = rtl ? 'translate-x-full' : '-translate-x-full';

  const navLink = ({ to, label, icon: Icon }: { to: string; label: string; icon: React.ElementType }) => (
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
  );

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

        <nav className="flex-1 py-4 px-3 overflow-y-auto space-y-1">
          {operationsLinks.map(navLink)}

          {settingsLinks.length > 0 && (
            <div className="pt-3">
              <button
                onClick={toggleSettings}
                className="w-full flex items-center justify-between px-3 py-1.5 mb-1 cursor-pointer group"
              >
                <div className="flex items-center gap-2 text-xs font-semibold text-slate-500 uppercase tracking-wider group-hover:text-slate-400 transition-colors">
                  <Settings size={12} />
                  {t('nav.settings')}
                </div>
                <ChevronDown
                  size={13}
                  className={`text-slate-500 group-hover:text-slate-400 transition-all duration-200 ${settingsOpen ? 'rotate-0' : '-rotate-90'}`}
                />
              </button>

              {settingsOpen && (
                <div className="space-y-1">
                  {settingsLinks.map(navLink)}
                </div>
              )}
            </div>
          )}
        </nav>

        <div className="px-3 py-4 border-t border-white/5">
          <div className="flex items-center gap-3 px-3 py-2 mb-1">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-400 to-violet-500 flex items-center justify-center text-xs font-semibold flex-shrink-0">
              {profile?.full_name?.charAt(0).toUpperCase() ?? '?'}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">{profile?.full_name ?? '—'}</p>
              <p className="text-xs text-slate-400 truncate">{displayRole}</p>
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
