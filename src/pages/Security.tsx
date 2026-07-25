import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Boxes, Network, Shield, Trash2, UserPlus } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useEntities } from '@/lib/entities';
import type { Profile, Building, Grant, GrantRole, Organization } from '@/types';
import { Card, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { RadixSelect, SelectField, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/Select';
import { SegmentedTabs } from '@/components/ui/SegmentedTabs';
import { SkeletonTable } from '@/components/ui/Skeleton';

// Hierarchy: org > compound > building (migration 0027).
type GrantScope = 'building' | 'compound' | 'org';

type GrantRow = Grant & {
  profiles: { id: string; full_name: string; apartment_number: string | null } | null;
};

// A compound grant covers every block in the compound, incl. future ones (0027).
const BUILDING_ROLES: GrantRole[] = ['building_admin', 'building_super', 'building_finance', 'viewer'];
const COMPOUND_ROLES: GrantRole[] = ['compound_admin', 'compound_finance', 'viewer'];
const ORG_ROLES: GrantRole[] = ['org_admin', 'org_finance'];

/**
 * Security — who has which management role, at which scope.
 * Moved out of People (Users.tsx): access management is a security concern,
 * not a people-directory concern. Scope-first: pick Org / Compound / Building,
 * then the matching selector appears.
 */
export default function Security() {
  const { t } = useTranslation();
  const { isPlatformAdmin, canAny, grants: authGrants, manageableBuildingIds } = useAuth();
  const isSuperAdmin = isPlatformAdmin;
  const isOrgAdmin = !isPlatformAdmin && authGrants.some(g => g.scope_type === 'org' && g.role === 'org_admin');
  const myOrgIds = authGrants.filter(g => g.scope_type === 'org' && g.role === 'org_admin').map(g => g.org_id as string).filter(Boolean);
  const isScopeManager = !isSuperAdmin && !isOrgAdmin && manageableBuildingIds.length > 0;

  const [grantScope, setGrantScope] = useState<GrantScope>('building');
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const entities = useEntities(buildings);
  const compoundEntities = entities.filter(e => e.kind === 'compound');

  const [accessBuildingId, setAccessBuildingId] = useState('');
  const [selectedCompoundId, setSelectedCompoundId] = useState('');
  const [selectedOrgId, setSelectedOrgId] = useState('');

  const [grants, setGrants] = useState<GrantRow[]>([]);
  const [grantLoading, setGrantLoading] = useState(false);
  const [compoundGrants, setCompoundGrants] = useState<GrantRow[]>([]);
  const [compoundGrantLoading, setCompoundGrantLoading] = useState(false);
  const [orgGrants, setOrgGrants] = useState<GrantRow[]>([]);
  const [orgGrantLoading, setOrgGrantLoading] = useState(false);

  // add-access modals
  const [allProfiles, setAllProfiles] = useState<Profile[]>([]);
  const [grantModal, setGrantModal] = useState(false);
  const [grantUserId, setGrantUserId] = useState('');
  const [grantRole, setGrantRole] = useState<GrantRole>('building_finance');
  const [grantSearch, setGrantSearch] = useState('');
  const [compoundGrantModal, setCompoundGrantModal] = useState(false);
  const [compoundGrantUserId, setCompoundGrantUserId] = useState('');
  const [compoundGrantRole, setCompoundGrantRole] = useState<GrantRole>('compound_admin');
  const [compoundGrantSearch, setCompoundGrantSearch] = useState('');
  const [orgGrantModal, setOrgGrantModal] = useState(false);
  const [orgGrantUserId, setOrgGrantUserId] = useState('');
  const [orgGrantRole, setOrgGrantRole] = useState<GrantRole>('org_admin');
  const [orgGrantSearch, setOrgGrantSearch] = useState('');

  // ---- buildings / orgs for the selectors ----
  useEffect(() => {
    if (isSuperAdmin) {
      Promise.all([
        supabase.from('buildings').select('*').eq('is_active', true).order('name'),
        supabase.from('organizations').select('*').eq('is_active', true).order('name'),
      ]).then(([{ data: b }, { data: o }]) => {
        setBuildings(b ?? []);
        setOrganizations(o ?? []);
      });
    } else if (isOrgAdmin && myOrgIds.length) {
      supabase.from('org_buildings').select('buildings(*)').in('org_id', myOrgIds)
        .then(({ data }) => {
          const b = ((data ?? []) as unknown as { buildings: Building }[]).map(r => r.buildings).filter(Boolean);
          setBuildings(b);
        });
    } else if (isScopeManager) {
      supabase.from('buildings').select('*').in('id', manageableBuildingIds).order('name')
        .then(({ data }) => setBuildings(data ?? []));
    }
  }, [isSuperAdmin, isOrgAdmin, isScopeManager, manageableBuildingIds.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  // Single-building admins shouldn't have to pick their only building.
  useEffect(() => {
    if (!accessBuildingId && buildings.length === 1) setAccessBuildingId(buildings[0].id);
  }, [buildings, accessBuildingId]);

  useEffect(() => {
    if (accessBuildingId && grantScope === 'building') loadGrants();
  }, [accessBuildingId, grantScope]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (selectedCompoundId && grantScope === 'compound') loadCompoundGrants();
  }, [selectedCompoundId, grantScope]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (selectedOrgId && grantScope === 'org') loadOrgGrants();
  }, [selectedOrgId, grantScope]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- data ----
  async function loadGrants() {
    if (!accessBuildingId) return;
    setGrantLoading(true);
    const { data } = await supabase
      .from('grants').select('*, profiles(id, full_name, apartment_number)')
      .eq('building_id', accessBuildingId).eq('scope_type', 'building').order('created_at');
    setGrants((data as GrantRow[]) ?? []);
    setGrantLoading(false);
  }

  async function loadCompoundGrants() {
    if (!selectedCompoundId) return;
    setCompoundGrantLoading(true);
    const { data } = await supabase
      .from('grants').select('*, profiles(id, full_name, apartment_number)')
      .eq('compound_id', selectedCompoundId).eq('scope_type', 'compound').order('created_at');
    setCompoundGrants((data as GrantRow[]) ?? []);
    setCompoundGrantLoading(false);
  }

  async function loadOrgGrants() {
    if (!selectedOrgId) return;
    setOrgGrantLoading(true);
    const { data } = await supabase
      .from('grants').select('*, profiles(id, full_name, apartment_number)')
      .eq('org_id', selectedOrgId).eq('scope_type', 'org').order('created_at');
    setOrgGrants((data as GrantRow[]) ?? []);
    setOrgGrantLoading(false);
  }

  async function loadProfiles() {
    const { data } = await supabase.from('profiles').select('*').eq('status', 'active').order('full_name');
    setAllProfiles(data ?? []);
  }

  // ---- actions ----
  async function openGrantModal() {
    await loadProfiles();
    setGrantUserId(''); setGrantRole('building_finance'); setGrantSearch('');
    setGrantModal(true);
  }
  async function openCompoundGrantModal() {
    await loadProfiles();
    setCompoundGrantUserId(''); setCompoundGrantRole('compound_admin'); setCompoundGrantSearch('');
    setCompoundGrantModal(true);
  }
  async function openOrgGrantModal() {
    await loadProfiles();
    setOrgGrantUserId(''); setOrgGrantRole('org_admin'); setOrgGrantSearch('');
    setOrgGrantModal(true);
  }

  async function addGrant() {
    if (!grantUserId || !accessBuildingId) return;
    const { error } = await supabase.from('grants').insert({
      user_id: grantUserId, scope_type: 'building', building_id: accessBuildingId, org_id: null, role: grantRole,
    });
    if (error) { toast.error(error.message); return; }
    toast.success(t('users.grantAdded'));
    setGrantModal(false); loadGrants();
  }
  async function addCompoundGrant() {
    if (!compoundGrantUserId || !selectedCompoundId) return;
    const { error } = await supabase.from('grants').insert({
      user_id: compoundGrantUserId, scope_type: 'compound',
      compound_id: selectedCompoundId, building_id: null, org_id: null, role: compoundGrantRole,
    });
    if (error) { toast.error(error.message); return; }
    toast.success(t('users.grantAdded'));
    setCompoundGrantModal(false); loadCompoundGrants();
  }
  async function addOrgGrant() {
    if (!orgGrantUserId || !selectedOrgId) return;
    const { error } = await supabase.from('grants').insert({
      user_id: orgGrantUserId, scope_type: 'org', org_id: selectedOrgId, building_id: null, role: orgGrantRole,
    });
    if (error) { toast.error(error.message); return; }
    toast.success(t('users.grantAdded'));
    setOrgGrantModal(false); loadOrgGrants();
  }

  async function removeGrantRow(id: string, reload: () => void) {
    const { error } = await supabase.from('grants').delete().eq('id', id);
    if (error) { toast.error(error.message); return; }
    toast.success(t('users.grantRemoved')); reload();
  }

  /** Change a grant's role in place — the DB ladder guard re-checks it (0027/0042). */
  async function updateGrantRole(id: string, role: GrantRole, reload: () => void) {
    const { error } = await supabase.from('grants').update({ role }).eq('id', id);
    if (error) { toast.error(error.message); return; }
    toast.success(t('users.roleUpdated'));
    reload();
  }

  // ---- derived ----
  const grantedUserIds = new Set(grants.map(g => g.user_id));
  const orgGrantedUserIds = new Set(orgGrants.map(g => g.user_id));
  const compoundGrantedUserIds = new Set(compoundGrants.map(g => g.user_id));
  const bySearch = (q: string) => (p: Profile) =>
    p.full_name.toLowerCase().includes(q.toLowerCase()) || (p.apartment_number ?? '').toLowerCase().includes(q.toLowerCase());
  const availableProfiles = allProfiles.filter(p => !grantedUserIds.has(p.id)).filter(bySearch(grantSearch));
  const availableProfilesForOrg = allProfiles.filter(p => !orgGrantedUserIds.has(p.id)).filter(bySearch(orgGrantSearch));
  const availableProfilesForCompound = allProfiles.filter(p => !compoundGrantedUserIds.has(p.id)).filter(bySearch(compoundGrantSearch));

  const canManageAccess = isPlatformAdmin || canAny('grant.manage');
  if (!canManageAccess) return <Navigate to="/dashboard" replace />;

  // ---- render helpers ----
  function grantsTable(rows: GrantRow[], roles: GrantRole[], reload: () => void) {
    return (
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-muted-foreground text-xs uppercase tracking-wide">
                <th className="px-4 py-3 text-start font-medium">{t('users.name')}</th>
                <th className="px-4 py-3 text-start font-medium">{t('users.role')}</th>
                <th className="px-4 py-3 text-start font-medium">{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map(g => (
                <tr key={g.id} className="hover:bg-accent/30">
                  <td className="px-4 py-3">
                    <p className="font-medium text-foreground">{g.profiles?.full_name ?? '—'}</p>
                    {g.profiles?.apartment_number && (
                      <p className="text-xs text-muted-foreground">Apt {g.profiles.apartment_number}</p>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <RadixSelect value={g.role} onValueChange={v => updateGrantRole(g.id, v as GrantRole, reload)}>
                      <SelectTrigger size="sm" className="h-7 px-2 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {roles.map(r => (
                          <SelectItem key={r} value={r}>{t(`users.roles.${r}`, { defaultValue: r })}</SelectItem>
                        ))}
                      </SelectContent>
                    </RadixSelect>
                  </td>
                  <td className="px-4 py-3">
                    <button onClick={() => removeGrantRow(g.id, reload)} className="text-muted-foreground hover:text-red-500 transition cursor-pointer" title={t('users.revokeAccess')}>
                      <Trash2 size={15} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    );
  }

  function emptyHint(icon: React.ReactNode, text: string) {
    return (
      <Card><CardBody>
        <div className="text-center py-10">
          {icon}
          <p className="text-sm text-muted-foreground">{text}</p>
        </div>
      </CardBody></Card>
    );
  }

  const pickerProfileList = (
    search: string, setSearch: (v: string) => void,
    picked: string, setPicked: (v: string) => void,
    options: Profile[],
  ) => (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-medium text-muted-foreground">{t('users.name')}</label>
      <input
        type="text"
        placeholder={t('common.search')}
        value={search}
        onChange={e => { setSearch(e.target.value); setPicked(''); }}
        className="rounded-lg border border-border bg-background text-foreground px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/50"
      />
      {search.length > 0 && (
        <div className="max-h-44 overflow-y-auto border border-border rounded-xl divide-y divide-border">
          {options.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-3">{t('users.noUsers')}</p>
          ) : options.slice(0, 20).map(p => (
            <button
              key={p.id} type="button"
              onClick={() => { setPicked(p.id); setSearch(p.full_name); }}
              className={`w-full flex items-center gap-2 px-3 py-2 text-sm transition cursor-pointer text-start ${picked === p.id ? 'bg-primary/10 text-primary' : 'text-foreground hover:bg-accent'}`}
            >
              <span className="font-medium">{p.full_name}</span>
              {p.apartment_number && <span className="text-muted-foreground text-xs">· Apt {p.apartment_number}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-6">
        <div>
          <h1 className="text-xl font-semibold text-foreground">{t('security.title')}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{t('security.subtitle')}</p>
        </div>
        {grantScope === 'org' && isSuperAdmin ? (
          <Button onClick={openOrgGrantModal} disabled={!selectedOrgId}>
            <UserPlus size={16} /> {t('users.addOrgAccess')}
          </Button>
        ) : grantScope === 'compound' ? (
          selectedCompoundId ? (
            <Button onClick={openCompoundGrantModal}><Shield size={16} /> {t('users.addAccess')}</Button>
          ) : null
        ) : accessBuildingId ? (
          <Button onClick={openGrantModal}><UserPlus size={16} /> {t('users.addAccess')}</Button>
        ) : null}
      </div>

      <div className="space-y-4">
        {/* Scope first: pick Org / Compound / Building, then its selector appears. */}
        {(isSuperAdmin || (isOrgAdmin && compoundEntities.length > 0)) && (
          <SegmentedTabs
            value={grantScope}
            onChange={setGrantScope}
            tabs={[
              ...(isSuperAdmin ? [{ key: 'org' as GrantScope, label: t('users.scopeOrg'), icon: Network }] : []),
              { key: 'compound' as GrantScope, label: t('users.scopeCompound'), icon: Boxes },
              { key: 'building' as GrantScope, label: t('users.scopeBuilding') },
            ]}
          />
        )}

        {grantScope === 'compound' && (isSuperAdmin || isOrgAdmin) ? (
          <>
            <RadixSelect value={selectedCompoundId || '__none__'} onValueChange={v => setSelectedCompoundId(v === '__none__' ? '' : v)}>
              <SelectTrigger className="min-w-[280px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">{t('users.selectCompoundHint')}</SelectItem>
                {compoundEntities.map(c => (
                  <SelectItem key={c.id} value={c.id}>{c.name} ({c.blocks.length} {t('buildings.blocks')})</SelectItem>
                ))}
              </SelectContent>
            </RadixSelect>
            {selectedCompoundId && <p className="text-xs text-muted-foreground">{t('users.compoundScopeNote')}</p>}
            {!selectedCompoundId
              ? emptyHint(<Boxes size={32} className="mx-auto text-primary mb-2" />, t('users.selectCompoundHint'))
              : compoundGrantLoading ? <SkeletonTable rows={3} cols={3} />
              : compoundGrants.length === 0
                ? emptyHint(<Shield size={32} className="mx-auto text-primary mb-2" />, t('users.noCompoundGrants'))
                : grantsTable(compoundGrants, COMPOUND_ROLES, loadCompoundGrants)}
          </>
        ) : grantScope === 'org' && isSuperAdmin ? (
          <>
            <RadixSelect value={selectedOrgId || '__none__'} onValueChange={v => setSelectedOrgId(v === '__none__' ? '' : v)}>
              <SelectTrigger className="min-w-[280px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">{t('users.selectOrgHint')}</SelectItem>
                {organizations.map(o => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
              </SelectContent>
            </RadixSelect>
            {!selectedOrgId
              ? emptyHint(<Network size={32} className="mx-auto text-primary mb-2" />, t('users.selectOrgHint'))
              : orgGrantLoading ? <SkeletonTable rows={3} cols={3} />
              : orgGrants.length === 0
                ? emptyHint(<Shield size={32} className="mx-auto text-primary mb-2" />, t('users.noOrgGrants'))
                : grantsTable(orgGrants, ORG_ROLES, loadOrgGrants)}
          </>
        ) : (
          <>
            {buildings.length > 1 && (
              <RadixSelect value={accessBuildingId || '__none__'} onValueChange={v => setAccessBuildingId(v === '__none__' ? '' : v)}>
                <SelectTrigger className="min-w-[280px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">{t('common.selectBuilding')}</SelectItem>
                  {buildings.map(b => <SelectItem key={b.id} value={b.id}>{b.name} ({b.city})</SelectItem>)}
                </SelectContent>
              </RadixSelect>
            )}
            {!accessBuildingId
              ? emptyHint(<Shield size={32} className="mx-auto text-primary mb-2" />, t('users.selectBuildingHint'))
              : grantLoading ? <SkeletonTable rows={3} cols={3} />
              : grants.length === 0
                ? emptyHint(<Shield size={32} className="mx-auto text-primary mb-2" />, t('users.noGrants'))
                : grantsTable(grants, BUILDING_ROLES, loadGrants)}
          </>
        )}
      </div>

      {/* ── Grant building access ── */}
      <Modal open={grantModal} onClose={() => setGrantModal(false)} title={t('users.addAccess')} size="sm">
        <div className="space-y-4">
          {pickerProfileList(grantSearch, setGrantSearch, grantUserId, setGrantUserId, availableProfiles)}
          <SelectField label={t('users.role')} value={grantRole} onValueChange={v => setGrantRole(v as GrantRole)}>
            {BUILDING_ROLES.map(r => <SelectItem key={r} value={r}>{t(`users.roles.${r}`, { defaultValue: r })}</SelectItem>)}
          </SelectField>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setGrantModal(false)}>{t('common.cancel')}</Button>
            <Button onClick={addGrant} disabled={!grantUserId}>{t('users.addAccess')}</Button>
          </div>
        </div>
      </Modal>

      {/* ── Grant compound access — one grant, every block (0027) ── */}
      <Modal open={compoundGrantModal} onClose={() => setCompoundGrantModal(false)} title={t('users.addCompoundAccess')} size="sm">
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">{t('users.compoundScopeNote')}</p>
          {pickerProfileList(compoundGrantSearch, setCompoundGrantSearch, compoundGrantUserId, setCompoundGrantUserId, availableProfilesForCompound)}
          <SelectField label={t('users.role')} value={compoundGrantRole} onValueChange={v => setCompoundGrantRole(v as GrantRole)}>
            {COMPOUND_ROLES.map(r => <SelectItem key={r} value={r}>{t(`users.roles.${r}`, { defaultValue: r })}</SelectItem>)}
          </SelectField>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setCompoundGrantModal(false)}>{t('common.cancel')}</Button>
            <Button onClick={addCompoundGrant} disabled={!compoundGrantUserId}>{t('users.addCompoundAccess')}</Button>
          </div>
        </div>
      </Modal>

      {/* ── Grant org access ── */}
      <Modal open={orgGrantModal} onClose={() => setOrgGrantModal(false)} title={t('users.addOrgAccess')} size="sm">
        <div className="space-y-4">
          {pickerProfileList(orgGrantSearch, setOrgGrantSearch, orgGrantUserId, setOrgGrantUserId, availableProfilesForOrg)}
          <SelectField label={t('users.role')} value={orgGrantRole} onValueChange={v => setOrgGrantRole(v as GrantRole)}>
            {ORG_ROLES.map(r => <SelectItem key={r} value={r}>{t(`users.roles.${r}`, { defaultValue: r })}</SelectItem>)}
          </SelectField>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setOrgGrantModal(false)}>{t('common.cancel')}</Button>
            <Button onClick={addOrgGrant} disabled={!orgGrantUserId}>{t('users.addOrgAccess')}</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
