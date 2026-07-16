import { NavLink, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/contexts/AuthContext';
import { topRole } from '@/lib/permissions';
import { cn } from '@/lib/utils';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Separator } from '@/components/ui/separator';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import {
  LayoutDashboard, Wallet, AlertTriangle, CalendarDays,
  Layers, Users, Building2, LogOut, ClipboardCheck, FileSignature,
  CalendarClock, Settings, X,
} from 'lucide-react';

interface SidebarProps {
  open: boolean;
  onClose: () => void;
}

export function Sidebar({ open, onClose }: SidebarProps) {
  return (
    <>
      {/* Desktop: permanent sidebar */}
      <aside className="hidden lg:flex lg:flex-col lg:w-60 lg:shrink-0 border-e border-border bg-sidebar">
        <SidebarContent onClose={onClose} />
      </aside>

      {/* Mobile: sheet drawer */}
      <Sheet open={open} onOpenChange={v => !v && onClose()}>
        <SheetContent side="left" className="w-60 p-0 bg-sidebar border-e border-border">
          <SidebarContent onClose={onClose} />
        </SheetContent>
      </Sheet>
    </>
  );
}

function SidebarContent({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const { profile, signOut, canAny, isPlatformAdmin, grants } = useAuth();
  const location = useLocation();

  const isOrgAdmin = grants.some(g => g.scope_type === 'org' && g.role === 'org_admin');
  const canStructure = canAny('unit.manage') || isOrgAdmin;
  const canPeople = canAny('resident.manage') || canAny('resident.approve') || isOrgAdmin;
  const canBuildings = isPlatformAdmin || isOrgAdmin;

  const top = topRole(grants.map(g => g.role));
  const displayRole = isPlatformAdmin
    ? t('users.roles.platform_admin')
    : top ? t(`users.roles.${top}`, { defaultValue: top }) : t('users.roles.resident');

  const initials = profile?.full_name
    ?.split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map(w => w[0].toUpperCase())
    .join('') ?? '?';

  const primaryLinks = [
    { to: '/dashboard',   label: t('nav.dashboard'),   icon: LayoutDashboard },
    { to: '/finance',     label: t('nav.finance'),      icon: Wallet },
    { to: '/dues',        label: t('nav.dues'),          icon: CalendarClock,  show: canStructure || canAny('finance.view') },
    { to: '/issues',      label: t('nav.issues'),        icon: AlertTriangle },
    { to: '/meetings',    label: t('nav.meetings'),      icon: CalendarDays },
    { to: '/inspections', label: t('nav.inspections'),   icon: ClipboardCheck },
    { to: '/contracts',   label: t('nav.contracts'),     icon: FileSignature },
  ].filter(l => l.show !== false);

  const manageLinks = [
    { to: '/buildings', label: t('nav.buildings'), icon: Building2, show: canBuildings },
    { to: '/structure', label: t('nav.structure'), icon: Layers,    show: canStructure },
    { to: '/users',     label: t('nav.people'),    icon: Users,     show: canPeople },
  ].filter(l => l.show);

  const isActive = (to: string) => location.pathname === to || location.pathname.startsWith(to + '/');

  const NavItem = ({ to, label, icon: Icon }: { to: string; label: string; icon: React.ElementType }) => (
    <NavLink
      to={to}
      onClick={onClose}
      className={cn(
        'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
        isActive(to)
          ? 'bg-sidebar-primary/10 text-sidebar-primary'
          : 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground'
      )}
    >
      <Icon size={16} className={isActive(to) ? 'text-sidebar-primary' : ''} />
      {label}
    </NavLink>
  );

  return (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="flex items-center gap-3 h-14 px-4 border-b border-sidebar-border shrink-0">
        <div className="flex items-center justify-center w-7 h-7 rounded-md bg-sidebar-primary text-sidebar-primary-foreground text-xs font-extrabold shrink-0">
          BH
        </div>
        <span className="font-semibold text-sm text-sidebar-foreground tracking-tight">BuildingHub</span>
        <button
          onClick={onClose}
          className="ms-auto lg:hidden text-sidebar-foreground/50 hover:text-sidebar-foreground transition-colors cursor-pointer"
        >
          <X size={16} />
        </button>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5">
        {primaryLinks.map(l => <NavItem key={l.to} {...l} />)}

        {manageLinks.length > 0 && (
          <>
            <div className="pt-4 pb-1 px-3">
              <p className="text-[10px] font-semibold text-sidebar-foreground/40 uppercase tracking-widest">
                {t('nav.settings')}
              </p>
            </div>
            {manageLinks.map(l => <NavItem key={l.to} {...l} />)}
          </>
        )}

        <div className="pt-4 pb-1 px-3">
          <p className="text-[10px] font-semibold text-sidebar-foreground/40 uppercase tracking-widest">
            {t('settings.title')}
          </p>
        </div>
        <NavItem to="/settings" label={t('settings.title')} icon={Settings} />
      </nav>

      {/* User footer */}
      <div className="shrink-0 px-2 py-3 border-t border-sidebar-border space-y-0.5">
        <NavLink
          to="/settings"
          onClick={onClose}
          className={cn(
            'flex items-center gap-3 px-3 py-2 rounded-lg transition-colors w-full',
            isActive('/settings')
              ? 'bg-sidebar-primary/10'
              : 'hover:bg-sidebar-accent'
          )}
        >
          <Avatar className="w-7 h-7 shrink-0">
            <AvatarImage src={profile?.avatar_url ?? undefined} />
            <AvatarFallback className="bg-primary text-primary-foreground text-xs font-semibold">
              {initials}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="text-sm font-medium text-sidebar-foreground truncate leading-tight">
              {profile?.full_name ?? '—'}
            </p>
            <p className="text-xs text-sidebar-foreground/50 truncate">{displayRole}</p>
          </div>
        </NavLink>

        <Separator className="my-1 bg-sidebar-border" />

        <button
          onClick={signOut}
          className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground w-full transition-colors cursor-pointer"
        >
          <LogOut size={16} />
          {t('nav.logout')}
        </button>
      </div>
    </div>
  );
}
