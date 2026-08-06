import { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { Logo } from '@/components/ui/Logo';
import { Wordmark } from '@/components/ui/Wordmark';
import { SegmentedTabs } from '@/components/ui/SegmentedTabs';
import { RadixSelect, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/Select';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useManagedBuildings } from '@/lib/useManagedBuildings';
import { useEntities } from '@/lib/entities';
import { topRole } from '@/lib/permissions';
import { cn } from '@/lib/utils';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Separator } from '@/components/ui/separator';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import {
  LayoutDashboard, Wallet, AlertTriangle, CalendarDays,
  Layers, Users, Building2, LogOut, ClipboardCheck, FileSignature,
  CalendarClock, X, Network, Boxes, FileUp, KeyRound, ShieldCheck, Home, Rocket, FileBarChart2,
  ContactRound,
} from 'lucide-react';
import { gsHiddenKey } from '@/pages/GettingStarted';
import { isDemoEmail, DEMO_ACCOUNTS } from '@/lib/demo';
import { FeedbackWidget } from '@/components/FeedbackWidget';

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
  const { user, profile, signOut, canAny, isPlatformAdmin, grants, hasBothPersonas, viewMode, setViewMode, residentLens, memberships, residentUnitId, setResidentUnitId, entityKey, setEntityKey } = useAuth();
  const location = useLocation();

  // Global entity picker for the MANAGING lens (mirrors the My-home unit
  // picker): select once here, every manager page follows.
  const { buildings: managedBuildings } = useManagedBuildings();
  const entities = useEntities(managedBuildings);
  useEffect(() => {
    if (!entities.length) return;
    // single-entity admins lock onto their one entity; the platform admin gets
    // no "All buildings" (cross-tenant totals are meaningless + expensive);
    // stale persisted keys reset.
    if (entities.length === 1 && entityKey !== entities[0].key) setEntityKey(entities[0].key);
    else if (entityKey && !entities.some((e) => e.key === entityKey)) setEntityKey(isPlatformAdmin ? entities[0].key : '');
    else if (isPlatformAdmin && !entityKey) setEntityKey(entities[0].key);
  }, [entities, entityKey, setEntityKey, isPlatformAdmin]);
  const isDemo = isDemoEmail(user?.email);
  // The demo admin persona gets the structural pages too (read-only — every
  // edit control on them is capability-gated, and RLS blocks writes anyway).
  const isDemoAdmin = user?.email?.toLowerCase() === DEMO_ACCOUNTS.admin;

  // Building names for the unit picker (investor case: units across buildings).
  const [unitBuildingNames, setUnitBuildingNames] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!residentLens || memberships.length < 2) return;
    const bids = [...new Set(memberships.map(m => m.unit?.building_id).filter(Boolean))] as string[];
    if (!bids.length) return;
    supabase.from('buildings').select('id, name').in('id', bids).then(({ data }) => {
      setUnitBuildingNames(Object.fromEntries(((data ?? []) as { id: string; name: string }[]).map(b => [b.id, b.name])));
    });
  }, [residentLens, memberships]);

  const isOrgAdmin = grants.some(g => g.scope_type === 'org' && g.role === 'org_admin');
  const isScopeAdmin = grants.some(g => ['building_admin', 'compound_admin', 'org_admin'].includes(g.role));
  const canStructure = canAny('unit.manage') || isOrgAdmin;
  const canPeople = canAny('resident.manage') || canAny('resident.approve') || isOrgAdmin;
  // Compound admins need Buildings even with ZERO blocks — it's where they
  // create their first block. Building admins need it too: it's the only
  // place to edit their building's details (address, contacts, maps link).
  const canBuildings = isPlatformAdmin || isScopeAdmin;

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

  // Resident lens (dual-persona accounts browsing as "My home"): only the links
  // a plain resident would have. UI preference only — permissions unchanged.
  // Setup checklist tab: admins only, self-retires once the checklist is
  // complete or dismissed (flag written by the GettingStarted page).
  const showGettingStarted =
    !isPlatformAdmin && isScopeAdmin && !residentLens
    && localStorage.getItem(gsHiddenKey(profile?.id)) !== '1';

  const primaryLinks = [
    { to: '/getting-started', label: t('nav.gettingStarted'), icon: Rocket, show: showGettingStarted },
    { to: '/dashboard',   label: t('nav.dashboard'),   icon: LayoutDashboard },
    { to: '/finance',     label: t('nav.finance'),      icon: Wallet },
    { to: '/reports',     label: t('nav.reports'),       icon: FileBarChart2,  show: canAny('finance.view') || memberships.length > 0 },
    { to: '/dues',        label: t('nav.dues'),          icon: CalendarClock,  show: !residentLens && (canStructure || canAny('finance.view')) },
    { to: '/issues',      label: t('nav.issues'),        icon: AlertTriangle },
    { to: '/meetings',    label: t('nav.meetings'),      icon: CalendarDays },
    { to: '/contacts',    label: t('nav.contactsDir'),   icon: ContactRound },
    { to: '/inspections', label: t('nav.inspections'),   icon: ClipboardCheck, show: !residentLens },
    { to: '/contracts',   label: t('nav.contracts'),     icon: FileSignature,  show: !residentLens },
  ].filter(l => l.show !== false);

  const manageLinks = (residentLens ? [] : [
    { to: '/buildings',     label: t('nav.buildings'),     icon: Building2, show: canBuildings || isDemoAdmin },
    { to: '/structure',     label: t('nav.structure'),     icon: Layers,    show: canStructure || isDemoAdmin },
    { to: '/users',         label: t('nav.people'),        icon: Users,     show: canPeople },
    { to: '/security',      label: t('nav.security'),      icon: ShieldCheck, show: isPlatformAdmin || canAny('grant.manage') },
    { to: '/organizations', label: t('nav.organizations'), icon: Network,   show: isPlatformAdmin },
    { to: '/compounds',     label: t('nav.compounds'),     icon: Boxes,     show: isPlatformAdmin || isOrgAdmin },
    { to: '/import',        label: t('nav.import'),        icon: FileUp,    show: canBuildings || canStructure },
    { to: '/licenses',      label: t('nav.licenses'),      icon: KeyRound,  show: isScopeAdmin && !isPlatformAdmin },
    { to: '/licensing-admin', label: 'Platform Licensing', icon: KeyRound,  show: isPlatformAdmin },
  ]).filter(l => l.show);

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
    <div className="flex flex-col h-full pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
      {/* Logo — clickable, back to home base */}
      <div className="flex items-center gap-3 h-14 px-4 border-b border-sidebar-border shrink-0">
        <NavLink to="/dashboard" onClick={onClose} className="flex items-center gap-3 min-w-0">
          <Logo size={26} className="shrink-0" />
          <Wordmark className="text-xs text-sidebar-foreground" />
        </NavLink>
        <button
          onClick={onClose}
          className="ms-auto lg:hidden text-sidebar-foreground/50 hover:text-sidebar-foreground transition-colors cursor-pointer"
        >
          <X size={16} />
        </button>
      </div>

      {/* Dual-persona lens: admin who is also a resident/investor switches between
          the building they manage and their own unit(s). */}
      {hasBothPersonas && (
        <div className="px-2 pt-3">
          <SegmentedTabs
            className="w-full [&>button]:flex-1 [&>button]:justify-center [&>button]:px-2"
            value={viewMode}
            onChange={setViewMode}
            tabs={[
              { key: 'manager', label: t('nav.lensManaging'), icon: Building2 },
              { key: 'resident', label: t('nav.lensMyHome'), icon: Home },
            ]}
          />
        </div>
      )}

      {/* Managing entity picker: choose once, applies to every page (like the
          My-home unit picker below). Single-entity admins see their building
          named — that's the "which building am I managing" answer. */}
      {!residentLens && entities.length > 0 && (
        <div className="px-2 pt-2">
          <RadixSelect
            value={entityKey || '__all__'}
            onValueChange={(v) => setEntityKey(v === '__all__' ? '' : v)}
            disabled={entities.length === 1}
          >
            <SelectTrigger className="w-full h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {entities.length > 1 && !isPlatformAdmin && <SelectItem value="__all__">{t('dashboard.allBuildings')}</SelectItem>}
              {entities.map((e) => (
                <SelectItem key={e.key} value={e.key}>{e.kind === 'compound' ? `▣ ${e.name}` : e.name}</SelectItem>
              ))}
            </SelectContent>
          </RadixSelect>
        </div>
      )}

      {/* My-home unit picker: investors drill into one unit or view all. */}
      {residentLens && memberships.length > 1 && (
        <div className="px-2 pt-2">
          <RadixSelect value={residentUnitId || '__all__'} onValueChange={v => setResidentUnitId(v === '__all__' ? '' : v)}>
            <SelectTrigger className="w-full h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">{t('nav.allMyUnits')}</SelectItem>
              {memberships.map(m => m.unit && (
                <SelectItem key={m.unit_id} value={m.unit_id}>
                  {m.unit.label}{unitBuildingNames[m.unit.building_id] ? ` — ${unitBuildingNames[m.unit.building_id]}` : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </RadixSelect>
        </div>
      )}

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5">
        {primaryLinks.map(l => <NavItem key={l.to} {...l} />)}

        {manageLinks.length > 0 && (
          <>
            <div className="pt-4 pb-1 px-3">
              <p className="text-[10px] font-semibold text-sidebar-foreground/40 uppercase tracking-widest">
                {t('nav.config')}
              </p>
            </div>
            {manageLinks.map(l => <NavItem key={l.to} {...l} />)}
          </>
        )}
      </nav>

      {/* User footer — the demo account gets no Settings (read-only persona) */}
      <div className="shrink-0 px-2 py-3 border-t border-sidebar-border space-y-0.5">
        <NavLink
          to={isDemo ? '/dashboard' : '/settings'}
          onClick={onClose}
          className={cn(
            'flex items-center gap-3 px-3 py-2 rounded-lg transition-colors w-full',
            !isDemo && isActive('/settings')
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

        {!isDemo && <FeedbackWidget onOpenNavClose={onClose} />}

        <button
          onClick={async () => {
            if (isDemo) {
              // Leave FIRST. signOut() awaits two network round trips, and
              // waiting for them renders the login form for about a second on
              // a slow connection — which a prospect reads as "the demo threw
              // me out and now wants a password". The sign-out still runs; we
              // just don't hold the redirect for it, and /demo signs out again
              // before it signs anyone in. replace() also keeps the dead
              // session out of history, so Back doesn't return to it.
              void signOut();
              window.location.replace('https://abniyah.com');
              return;
            }
            await signOut();
          }}
          className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground w-full transition-colors cursor-pointer"
        >
          <LogOut size={16} />
          {t('nav.logout')}
        </button>
      </div>
    </div>
  );
}
