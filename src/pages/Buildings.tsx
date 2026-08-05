import { useEffect, useState, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useForm } from 'react-hook-form';
import { Plus, Building2, MapPin, ExternalLink, Pencil, Trash2, Search, X, ChevronDown } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useExpenseTypes } from '@/lib/expenseTypes';
import type { Building, Compound, Organization, ExpenseType } from '@/types';
import { Card, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, SelectInput } from '@/components/ui/Input';
import { PhoneInput } from '@/components/ui/PhoneInput';
import { COUNTRIES } from '@/lib/locationData';
import { CitySelect } from '@/components/ui/CitySelect';
import { Controller } from 'react-hook-form';
import { SelectField, SelectItem } from '@/components/ui/Select';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { SkeletonCards } from '@/components/ui/Skeleton';
import { cn } from '@/lib/utils';

type FormData = {
  name: string; address: string; city: string; country: string;
  contact_email: string; contact_phone: string; maps_url: string; compound_id: string;
};

type OrgBuilding = { org_id: string; building_id: string };

type ColFilters = {
  city: string;
  org: string;
  compound: string;
  status: string;
  billing: string;
};

const EMPTY_FILTERS: ColFilters = { city: '', org: '', compound: '', status: '', billing: '' };

function buildEmbedUrl(b: Building): string {
  const query = encodeURIComponent(`${b.address}, ${b.city}, ${b.country}`);
  return `https://maps.google.com/maps?q=${query}&output=embed`;
}


type FilterOption = { value: string; label: string };

// Searchable popover filter — portalled to body so it escapes table overflow clipping
function SearchableColFilter({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: FilterOption[];
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [rect, setRect] = useState<DOMRect | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (
        triggerRef.current?.contains(e.target as Node) ||
        dropRef.current?.contains(e.target as Node)
      ) return;
      setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  function toggle() {
    if (!open && triggerRef.current) {
      setRect(triggerRef.current.getBoundingClientRect());
      setQuery('');
    }
    setOpen(v => !v);
  }

  // Always show the "All" option (value=''); search filters the rest
  const visible = options.filter(o =>
    o.value === '' || !query || o.label.toLowerCase().includes(query.toLowerCase())
  );

  const selectedLabel = options.find(o => o.value === value)?.label ?? 'All';

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={toggle}
        title={value ? selectedLabel : undefined}
        className={cn(
          'inline-flex items-center justify-center w-4 h-4 rounded transition-colors cursor-pointer focus:outline-none',
          value ? 'text-primary' : 'text-muted-foreground/50 hover:text-muted-foreground'
        )}
      >
        <ChevronDown size={12} />
      </button>

      {open && rect && createPortal(
        <div
          ref={dropRef}
          style={{
            position: 'fixed',
            top: rect.bottom + 4,
            left: rect.left,
            minWidth: Math.max(rect.width, 220),
            zIndex: 9999,
          }}
          className="bg-popover border border-border rounded-lg shadow-xl overflow-hidden"
        >
          <div className="p-1.5 border-b border-border">
            <div className="relative">
              <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              <input
                autoFocus
                type="text"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search..."
                className="w-full text-xs rounded pl-6 pr-2 py-1 bg-background border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring/50"
              />
            </div>
          </div>
          <div className="max-h-52 overflow-y-auto py-0.5">
            {visible.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-4">No matches</p>
            ) : visible.map(o => (
              <button
                key={o.value}
                type="button"
                onClick={() => { onChange(o.value); setOpen(false); setQuery(''); }}
                className={cn(
                  'w-full text-left text-xs px-3 py-1.5 hover:bg-accent transition-colors cursor-pointer',
                  o.value === value ? 'text-primary font-medium bg-primary/5' : 'text-foreground'
                )}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

export default function Buildings() {
  const { t } = useTranslation();
  const { isPlatformAdmin, grants } = useAuth();

  const myOrgIds = grants
    .filter(g => g.scope_type === 'org' && g.role === 'org_admin')
    .map(g => g.org_id as string)
    .filter(Boolean);
  const isOrgAdmin = !isPlatformAdmin && myOrgIds.length > 0;
  // Compound admins manage this page too: their blocks live here, and a fresh
  // compound has none yet — this page is where they create the first one.
  const myCompoundIds = grants
    .filter(g => g.scope_type === 'compound' && g.role === 'compound_admin')
    .map(g => g.compound_id as string)
    .filter(Boolean);
  const isCompoundAdmin = !isPlatformAdmin && !isOrgAdmin && myCompoundIds.length > 0;
  // Standalone building admin: sees and edits ONLY their own building(s);
  // can't create more (new entities come through registration or a higher scope).
  const myBuildingIds = grants
    .filter(g => g.scope_type === 'building' && g.role === 'building_admin')
    .map(g => g.building_id as string)
    .filter(Boolean);
  const isBuildingAdminOnly = !isPlatformAdmin && !isOrgAdmin && !isCompoundAdmin && myBuildingIds.length > 0;
  // Non-admin grant holders (viewer / finance / super) get a READ-ONLY view of
  // their own scope — never the whole platform (the buildings SELECT policy
  // reads broadly, so the page must scope itself).
  const anyBuildingIds = grants.filter(g => g.building_id).map(g => g.building_id as string);
  const anyCompoundIds = grants.filter(g => g.compound_id).map(g => g.compound_id as string);
  const canEdit = isPlatformAdmin || isOrgAdmin || isCompoundAdmin || isBuildingAdminOnly;

  const [buildings, setBuildings] = useState<Building[]>([]);
  const [compounds, setCompounds] = useState<Compound[]>([]);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [orgBuildings, setOrgBuildings] = useState<OrgBuilding[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<ColFilters>(EMPTY_FILTERS);

  const [modalOpen, setModalOpen] = useState(false);
  const [mapBuilding, setMapBuilding] = useState<Building | null>(null);
  const [editB, setEditB] = useState<Building | null>(null);
  const [ebForm, setEbForm] = useState({
    name: '', address: '', city: '', country: '',
    contact_email: '', contact_phone: '', maps_url: '',
    compound_id: '', billing_mode: 'arrears', is_active: true, org_id: '',
    reminder_day: '', whish_number: '',
    payment_due_days: '7', lbp_rate: '',
  });

  const { register, handleSubmit, reset, control, formState: { isSubmitting } } = useForm<FormData>();

  useEffect(() => { loadAll(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadAll() {
    setLoading(true);
    const [{ data: b }, { data: c }] = await Promise.all([
      supabase.from('buildings').select('*').order('name'),
      supabase.from('compounds').select('*').order('name'),
    ]);
    setBuildings((b as Building[]) ?? []);
    setCompounds((c as Compound[]) ?? []);

    if (isPlatformAdmin) {
      const [{ data: o }, { data: ob }] = await Promise.all([
        supabase.from('organizations').select('*').order('name'),
        supabase.from('org_buildings').select('org_id, building_id'),
      ]);
      setOrganizations((o as Organization[]) ?? []);
      setOrgBuildings((ob as OrgBuilding[]) ?? []);
    } else if (myOrgIds.length) {
      const { data: ob } = await supabase
        .from('org_buildings')
        .select('org_id, building_id')
        .in('org_id', myOrgIds);
      setOrgBuildings((ob as OrgBuilding[]) ?? []);
    }

    setLoading(false);
  }

  const orgByBuilding = Object.fromEntries(orgBuildings.map(ob => [ob.building_id, ob.org_id]));

  const visibleBuildings = isOrgAdmin
    ? buildings.filter(b => orgBuildings.some(ob => ob.building_id === b.id))
    : isCompoundAdmin
      ? buildings.filter(b => myCompoundIds.includes(b.compound_id ?? ''))
      : isBuildingAdminOnly
        ? buildings.filter(b => myBuildingIds.includes(b.id))
        : buildings.filter(b => anyBuildingIds.includes(b.id) || anyCompoundIds.includes(b.compound_id ?? ''));

  // NOTE (#70): single-building admins used to auto-open their building's edit
  // modal here. Testers experienced landing in an unrequested edit form as a
  // bug, so the page now always shows the normal list.

  const visibleCompounds = isOrgAdmin
    ? compounds.filter(c => myOrgIds.includes(c.org_id ?? ''))
    : isCompoundAdmin
      ? compounds.filter(c => myCompoundIds.includes(c.id))
      : isPlatformAdmin
        ? compounds
        : compounds.filter(c => anyCompoundIds.includes(c.id) || visibleBuildings.some(b => b.compound_id === c.id));

  const effMode = (b: Building) =>
    b.compound_id
      ? (compounds.find(c => c.id === b.compound_id)?.billing_mode ?? b.billing_mode)
      : b.billing_mode;

  // Distinct option sets from the full visible set (don't cascade-shrink with active filters)
  const uniqueCities = useMemo(
    () => [...new Set(visibleBuildings.map(b => b.city).filter(Boolean))].sort(),
    [visibleBuildings]
  );
  const usedCompounds = useMemo(
    () => compounds.filter(c => visibleBuildings.some(b => b.compound_id === c.id)),
    [compounds, visibleBuildings]
  );
  const usedOrgs = useMemo(
    () => organizations.filter(o => visibleBuildings.some(b => orgByBuilding[b.id] === o.id)),
    [organizations, visibleBuildings, orgByBuilding]
  );
  const hasStandalone = visibleBuildings.some(b => !b.compound_id);
  const hasNoOrg = isPlatformAdmin && visibleBuildings.some(b => !orgByBuilding[b.id]);

  // Option arrays for searchable filters
  const orgOptions: FilterOption[] = useMemo(() => [
    { value: '', label: 'All organizations' },
    ...(hasNoOrg ? [{ value: '__none__', label: '— None —' }] : []),
    ...usedOrgs.map(o => ({ value: o.id, label: o.name })),
  ], [usedOrgs, hasNoOrg]); // eslint-disable-line react-hooks/exhaustive-deps

  const compoundOptions: FilterOption[] = useMemo(() => [
    { value: '', label: 'All compounds' },
    ...(hasStandalone ? [{ value: '__none__', label: '— Standalone —' }] : []),
    ...usedCompounds.map(c => ({ value: c.id, label: c.name })),
  ], [usedCompounds, hasStandalone]); // eslint-disable-line react-hooks/exhaustive-deps

  const cityOptions: FilterOption[] = useMemo(() => [
    { value: '', label: 'All cities' },
    ...uniqueCities.map(c => ({ value: c, label: c })),
  ], [uniqueCities]);

  const statusOptions: FilterOption[] = [
    { value: '', label: 'All' },
    { value: 'active', label: t('buildings.active') },
    { value: 'inactive', label: t('buildings.inactive') },
  ];

  const billingOptions: FilterOption[] = [
    { value: '', label: 'All' },
    { value: 'arrears', label: 'Arrears' },
    { value: 'dues', label: 'Dues' },
  ];

  const filtered = useMemo(() => {
    let result = visibleBuildings;

    const q = search.trim().toLowerCase();
    if (q) {
      result = result.filter(b =>
        b.name.toLowerCase().includes(q) ||
        b.city.toLowerCase().includes(q) ||
        b.address.toLowerCase().includes(q)
      );
    }
    if (filters.city)
      result = result.filter(b => b.city === filters.city);
    if (filters.org === '__none__')
      result = result.filter(b => !orgByBuilding[b.id]);
    else if (filters.org)
      result = result.filter(b => orgByBuilding[b.id] === filters.org);
    if (filters.compound === '__none__')
      result = result.filter(b => !b.compound_id);
    else if (filters.compound)
      result = result.filter(b => b.compound_id === filters.compound);
    if (filters.status === 'active')
      result = result.filter(b => b.is_active);
    else if (filters.status === 'inactive')
      result = result.filter(b => !b.is_active);
    if (filters.billing)
      result = result.filter(b => effMode(b) === filters.billing);

    return result;
  }, [visibleBuildings, search, filters, orgByBuilding, compounds]); // eslint-disable-line react-hooks/exhaustive-deps

  const activeFilterCount = Object.values(filters).filter(v => v !== '').length;

  function setFilter(key: keyof ColFilters, value: string) {
    setFilters(prev => ({ ...prev, [key]: value }));
  }

  const compoundName = (id: string | null) =>
    id ? (compounds.find(c => c.id === id)?.name ?? null) : null;

  const orgName = (buildingId: string) => {
    const orgId = orgByBuilding[buildingId];
    return orgId ? (organizations.find(o => o.id === orgId)?.name ?? null) : null;
  };

  async function onSubmit(data: FormData) {
    // A compound admin's new block always lands in THEIR compound — never
    // standalone, never someone else's.
    let compoundId = data.compound_id || null;
    if (isCompoundAdmin) {
      compoundId = compoundId && myCompoundIds.includes(compoundId) ? compoundId : myCompoundIds[0];
    }
    const { data: inserted, error } = await supabase.from('buildings').insert({
      name: data.name, address: data.address, city: data.city, country: data.country,
      contact_email: data.contact_email || null, contact_phone: data.contact_phone || null,
      maps_url: data.maps_url || null, compound_id: compoundId, is_active: true,
    }).select('id').single();

    if (error) { toast.error(error.message); return; }

    if (isOrgAdmin && myOrgIds[0] && inserted) {
      await supabase.from('org_buildings').insert({ org_id: myOrgIds[0], building_id: (inserted as { id: string }).id });
    }

    toast.success(t('buildings.buildingAdded'));
    setModalOpen(false);
    reset();
    loadAll();
  }

  function openEditB(b: Building) {
    setEbForm({
      name: b.name, address: b.address, city: b.city, country: b.country,
      contact_email: b.contact_email ?? '', contact_phone: b.contact_phone ?? '',
      maps_url: b.maps_url ?? '', compound_id: b.compound_id ?? '',
      billing_mode: b.billing_mode, is_active: b.is_active,
      org_id: orgByBuilding[b.id] ?? '',
      reminder_day: b.reminder_day != null ? String(b.reminder_day) : '',
      payment_due_days: String(b.payment_due_days ?? 7),
      lbp_rate: b.lbp_rate != null ? String(b.lbp_rate) : '',
      whish_number: b.whish_number ?? '',
    });
    setEditB(b);
  }

  async function saveEditB() {
    if (!editB || !ebForm.name.trim()) return;
    await supabase.from('buildings').update({
      name: ebForm.name.trim(), address: ebForm.address, city: ebForm.city,
      country: ebForm.country, contact_email: ebForm.contact_email || null,
      contact_phone: ebForm.contact_phone || null, maps_url: ebForm.maps_url || null,
      compound_id: ebForm.compound_id || null, billing_mode: ebForm.billing_mode,
      is_active: ebForm.is_active,

      whish_number: ebForm.whish_number.trim() || null,
    }).eq('id', editB.id);

    // Payment terms go through their own RPC (0076): it needs only
    // `charge.manage`, so a finance role can run collections without also
    // gaining the power to rename or deactivate the building.
    const { error: termsErr } = await supabase.rpc('set_payment_due_days', {
      p_scope_type: 'building', p_scope_id: editB.id,
      p_days: Number(ebForm.payment_due_days) || 7,
    });
    if (termsErr) toast.error(termsErr.message);

    // LBP prefill rate (0086) — frozen per entry, so this only affects new forms
    const { error: rateErr } = await supabase.rpc('set_lbp_rate', {
      p_scope_type: 'building', p_scope_id: editB.id,
      p_rate: ebForm.lbp_rate ? Number(ebForm.lbp_rate) : null,
    });
    if (rateErr) toast.error(rateErr.message);

    if (isPlatformAdmin) {
      await supabase.from('org_buildings').delete().eq('building_id', editB.id);
      if (ebForm.org_id) {
        await supabase.from('org_buildings').insert({ org_id: ebForm.org_id, building_id: editB.id });
      }
    }

    setEditB(null);
    loadAll();
  }

  async function deleteB(id: string) {
    if (!confirm('Delete this building and ALL its units, charges, payments, etc.? This cannot be undone.')) return;
    await supabase.from('buildings').delete().eq('id', id);
    setEditB(null);
    loadAll();
  }

  return (
    <div>
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight">{t('buildings.title')}</h1>
          {/* A single-building admin needs no compound talk, search, or filters. */}
          {!isBuildingAdminOnly && (
            <p className="text-sm text-muted-foreground mt-0.5">
              {(search || activeFilterCount > 0)
                ? t('buildings.searchResults', { count: filtered.length, total: visibleBuildings.length })
                : t('buildings.subtitle')}
            </p>
          )}
        </div>
        {!isBuildingAdminOnly && (
          <div className="flex items-center gap-2">
            {activeFilterCount > 0 && (
              <button
                onClick={() => setFilters(EMPTY_FILTERS)}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
              >
                <X size={12} /> Clear filters ({activeFilterCount})
              </button>
            )}
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              <input
                type="search"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder={t('buildings.searchPlaceholder')}
                className="h-9 pl-8 pr-3 text-sm rounded-lg border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/50 w-52"
              />
            </div>
            {(isPlatformAdmin || isOrgAdmin || isCompoundAdmin) && (
              <Button variant="tinted" onClick={() => setModalOpen(true)}><Plus size={16} /> {t('buildings.addBuilding')}</Button>
            )}
          </div>
        )}
      </div>

      {/* Table */}
      {loading ? (
        <SkeletonCards count={3} />
      ) : visibleBuildings.length === 0 ? (
        <Card><CardBody>
          <p className="text-sm text-muted-foreground text-center py-10">{t('buildings.noBuildings')}</p>
        </CardBody></Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  {/* Name — search bar handles text search */}
                  <th className="text-start text-xs font-medium text-muted-foreground py-3 px-4">
                    {t('buildings.name')}
                  </th>

                  {/* City */}
                  <th className="text-start text-xs font-medium text-muted-foreground px-4 py-3 hidden sm:table-cell">
                    <div className="flex items-center gap-1.5">
                      <span>{t('buildings.city')}</span>
                      <SearchableColFilter
                        value={filters.city}
                        onChange={v => setFilter('city', v)}
                        options={cityOptions}
                      />
                    </div>
                  </th>

                  {/* Organization — platform admin only, searchable */}
                  {isPlatformAdmin && (
                    <th className="text-start text-xs font-medium text-muted-foreground px-4 py-3 hidden lg:table-cell">
                      <div className="flex items-center gap-1.5">
                        <span>{t('nav.organizations')}</span>
                        <SearchableColFilter
                          value={filters.org}
                          onChange={v => setFilter('org', v)}
                          options={orgOptions}
                        />
                      </div>
                    </th>
                  )}

                  {/* Compound — searchable */}
                  <th className="text-start text-xs font-medium text-muted-foreground px-4 py-3 hidden md:table-cell">
                    <div className="flex items-center gap-1.5">
                      <span>{t('nav.compounds')}</span>
                      <SearchableColFilter
                        value={filters.compound}
                        onChange={v => setFilter('compound', v)}
                        options={compoundOptions}
                      />
                    </div>
                  </th>

                  {/* Status */}
                  <th className="text-start text-xs font-medium text-muted-foreground px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <span>{t('common.status')}</span>
                      <SearchableColFilter
                        value={filters.status}
                        onChange={v => setFilter('status', v)}
                        options={statusOptions}
                      />
                    </div>
                  </th>

                  {/* Billing mode */}
                  <th className="text-start text-xs font-medium text-muted-foreground px-4 py-3 hidden lg:table-cell">
                    <div className="flex items-center gap-1.5">
                      <span>Billing</span>
                      <SearchableColFilter
                        value={filters.billing}
                        onChange={v => setFilter('billing', v)}
                        options={billingOptions}
                      />
                    </div>
                  </th>

                  <th className="py-3 px-4 w-16" />
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={isPlatformAdmin ? 7 : 6} className="py-12 text-center">
                      <Search size={20} className="mx-auto text-muted-foreground/40 mb-2" />
                      <p className="text-sm text-muted-foreground">No buildings match the current filters.</p>
                      <button
                        onClick={() => { setSearch(''); setFilters(EMPTY_FILTERS); }}
                        className="mt-2 text-xs text-primary hover:underline cursor-pointer"
                      >
                        Clear all
                      </button>
                    </td>
                  </tr>
                ) : filtered.map(b => (
                  <tr
                    key={b.id}
                    onClick={canEdit ? () => openEditB(b) : undefined}
                    className={cn('border-t border-border/60 transition-colors', canEdit && 'cursor-pointer hover:bg-accent')}
                  >
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2 min-w-0">
                        <Building2 size={14} className="text-primary/50 shrink-0" />
                        <span className="font-medium text-foreground truncate">{b.name}</span>
                      </div>
                      {b.address && (
                        <p className="text-xs text-muted-foreground mt-0.5 pl-5 hidden md:block truncate max-w-xs">{b.address}</p>
                      )}
                    </td>
                    <td className="py-3 px-4 text-muted-foreground hidden sm:table-cell whitespace-nowrap">
                      {b.city}
                    </td>
                    {isPlatformAdmin && (
                      <td className="py-3 px-4 hidden lg:table-cell">
                        {orgName(b.id)
                          ? <span className="text-xs text-violet-600 dark:text-violet-400 font-medium">{orgName(b.id)}</span>
                          : <span className="text-xs text-muted-foreground/30">—</span>}
                      </td>
                    )}
                    <td className="py-3 px-4 hidden md:table-cell">
                      {compoundName(b.compound_id)
                        ? <span className="text-xs text-primary font-medium">{compoundName(b.compound_id)}</span>
                        : <span className="text-xs text-muted-foreground/30">—</span>}
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      <Badge color={b.is_active ? 'green' : 'slate'}>
                        {b.is_active ? t('buildings.active') : t('buildings.inactive')}
                      </Badge>
                    </td>
                    <td className="py-3 px-4 hidden lg:table-cell whitespace-nowrap">
                      <span className={cn(
                        'text-xs font-medium',
                        effMode(b) === 'dues' ? 'text-primary' : 'text-muted-foreground'
                      )}>
                        {effMode(b) === 'dues' ? t('buildings.modeDues') : t('buildings.modeArrears')}
                        {b.compound_id && <span className="opacity-40 ml-1 text-[10px]">↑</span>}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center justify-end gap-1">
                        {b.maps_url && (
                          <button
                            onClick={e => { e.stopPropagation(); setMapBuilding(b); }}
                            title={t('buildings.map')}
                            className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent cursor-pointer transition-colors"
                          >
                            <MapPin size={13} />
                          </button>
                        )}
                        {canEdit && (
                          <button
                            onClick={e => { e.stopPropagation(); openEditB(b); }}
                            title={t('common.edit')}
                            className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent cursor-pointer transition-colors"
                          >
                            <Pencil size={13} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Add building modal */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={t('buildings.addBuilding')} size="lg">
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <Input label={t('buildings.name')} {...register('name', { required: true })} />
          <Input label={t('buildings.address')} {...register('address', { required: true })} />
          <div className="grid grid-cols-2 gap-3">
            <Controller
              name="city"
              control={control}
              rules={{ required: true }}
              render={({ field }) => (
                <CitySelect label={t('buildings.city')} value={field.value ?? ''} onChange={field.onChange} />
              )}
            />
            <SelectInput label={t('buildings.country')} defaultValue="Lebanon" {...register('country', { required: true })}>
              {COUNTRIES.map(c => <option key={c} value={c}>{c}</option>)}
            </SelectInput>
          </div>
          <Input label={t('buildings.contactEmail')} type="email" {...register('contact_email')} />
          <Controller
            name="contact_phone"
            control={control}
            render={({ field }) => (
              <PhoneInput label={t('buildings.contactPhone')} value={field.value ?? ''} onChange={field.onChange} />
            )}
          />
          {(isPlatformAdmin || isOrgAdmin || isCompoundAdmin) && visibleCompounds.length > 0 && (
            <Controller name="compound_id" control={control} render={({ field }) => (
              <SelectField label={t('buildings.compound')} value={field.value || (isCompoundAdmin ? myCompoundIds[0] : '__none__')} onValueChange={v => field.onChange(v === '__none__' ? '' : v)}>
                {!isCompoundAdmin && <SelectItem value="__none__">{t('buildings.noCompoundOption')}</SelectItem>}
                {visibleCompounds.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectField>
            )} />
          )}
          <Input label={t('buildings.mapsLink')} placeholder={t('buildings.mapsPlaceholder')} {...register('maps_url')} />
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setModalOpen(false)}>{t('common.cancel')}</Button>
            <Button type="submit" loading={isSubmitting}>{t('common.save')}</Button>
          </div>
        </form>
      </Modal>

      {/* Edit building modal */}
      <Modal open={!!editB} onClose={() => setEditB(null)} title={`${t('common.edit')} — ${editB?.name ?? ''}`} size="lg">
        <div className="space-y-4">
          <Input label={t('buildings.name')} value={ebForm.name} onChange={e => setEbForm({ ...ebForm, name: e.target.value })} />
          <Input label={t('buildings.address')} value={ebForm.address} onChange={e => setEbForm({ ...ebForm, address: e.target.value })} />
          <div className="grid grid-cols-2 gap-3">
            <CitySelect label={t('buildings.city')} value={ebForm.city} onChange={v => setEbForm({ ...ebForm, city: v })} />
            <SelectInput label={t('buildings.country')} value={ebForm.country} onChange={e => setEbForm({ ...ebForm, country: e.target.value })}>
              {COUNTRIES.map(c => <option key={c} value={c}>{c}</option>)}
            </SelectInput>
          </div>
          <Input label={t('buildings.contactEmail')} type="email" value={ebForm.contact_email} onChange={e => setEbForm({ ...ebForm, contact_email: e.target.value })} />
          <PhoneInput label={t('buildings.contactPhone')} value={ebForm.contact_phone} onChange={(v) => setEbForm({ ...ebForm, contact_phone: v })} />
          <Input label={t('buildings.mapsLink')} value={ebForm.maps_url} onChange={e => setEbForm({ ...ebForm, maps_url: e.target.value })} />
          {isPlatformAdmin && organizations.length > 0 && (
            <SelectField label={t('nav.organizations')} value={ebForm.org_id || '__none__'} onValueChange={v => setEbForm({ ...ebForm, org_id: v === '__none__' ? '' : v })}>
              <SelectItem value="__none__">{t('buildings.noOrgOption')}</SelectItem>
              {organizations.map(o => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
            </SelectField>
          )}
          {(isPlatformAdmin || isOrgAdmin || isCompoundAdmin) && visibleCompounds.length > 0 && (
            <SelectField label={t('buildings.compound')} value={ebForm.compound_id || '__none__'} onValueChange={v => setEbForm({ ...ebForm, compound_id: v === '__none__' ? '' : v })}>
              {!isCompoundAdmin && <SelectItem value="__none__">{t('buildings.noCompoundOption')}</SelectItem>}
              {visibleCompounds.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectField>
          )}
          {!ebForm.compound_id && (
            <SelectField label={t('buildings.billingMode')} value={ebForm.billing_mode} onValueChange={v => setEbForm({ ...ebForm, billing_mode: v })}>
              <SelectItem value="arrears">{t('buildings.modeArrears')}</SelectItem>
              <SelectItem value="dues">{t('buildings.modeDues')}</SelectItem>
            </SelectField>
          )}
          {/* Payment terms (0076). There is no billing cycle for arrears - the
              admin requests payment whenever it is needed - so the only thing
              to set is how long residents get. It also prefills the dues
              generator's due date. */}
          <div>
            <SelectField
              label={t('buildings.dueDays')}
              value={ebForm.payment_due_days || '7'}
              onValueChange={v => setEbForm({ ...ebForm, payment_due_days: v })}
            >
              {[3, 5, 7, 10, 14, 21, 30, 45, 60, 90].map(d => (
                <SelectItem key={d} value={String(d)}>{t('buildings.dueDaysN', { count: d })}</SelectItem>
              ))}
            </SelectField>
            <p className="text-xs text-muted-foreground mt-1">{t('buildings.dueDaysHint')}</p>
          </div>
          {/* Expense types (0085): the building's own catalog. Expenses, budget
              lines and metering all pick from it. A block inside a compound
              manages the COMPOUND's catalog — it governs, like billing_mode. */}
          {editB && (
            <ExpenseTypesManager
              scopeKind={editB.compound_id ? 'compound' : 'building'}
              scopeId={editB.compound_id ?? editB.id}
            />
          )}
          <div>
            <Input
              label={t('buildings.lbpRate')}
              type="number" step="0.01" min="0"
              value={ebForm.lbp_rate}
              onChange={e => setEbForm({ ...ebForm, lbp_rate: e.target.value })}
              placeholder="89500"
            />
            <p className="text-xs text-muted-foreground mt-1">{t('buildings.lbpRateHint')}</p>
          </div>
          <div>
            <Input
              label={t('buildings.whishNumber')}
              value={ebForm.whish_number}
              onChange={e => setEbForm({ ...ebForm, whish_number: e.target.value })}
              placeholder="03 123 456"
            />
            <p className="text-xs text-muted-foreground mt-1">{t('buildings.whishHint')}</p>
          </div>
          <label className="flex items-center gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={ebForm.is_active}
              onChange={e => setEbForm({ ...ebForm, is_active: e.target.checked })}
              className="w-4 h-4 rounded accent-primary cursor-pointer"
            />
            <span className="text-sm text-foreground">{t('buildings.active')}</span>
          </label>
          <div className="flex justify-between gap-2 pt-2">
            <Button variant="danger" onClick={() => editB && deleteB(editB.id)}><Trash2 size={15} /> {t('common.delete')}</Button>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setEditB(null)}>{t('common.cancel')}</Button>
              <Button onClick={saveEditB}>{t('common.save')}</Button>
            </div>
          </div>
        </div>
      </Modal>

      {/* Map modal */}
      <Modal open={!!mapBuilding} onClose={() => setMapBuilding(null)} title={mapBuilding?.name ?? ''} size="lg">
        {mapBuilding && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">{mapBuilding.address}, {mapBuilding.city}, {mapBuilding.country}</p>
            <div className="rounded-xl overflow-hidden border border-border" style={{ height: 360 }}>
              <iframe
                title="Building location"
                src={buildEmbedUrl(mapBuilding)}
                width="100%"
                height="100%"
                style={{ border: 0 }}
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
              />
            </div>
            {mapBuilding.maps_url && (
              <a href={mapBuilding.maps_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline">
                <ExternalLink size={14} /> Open in Google Maps
              </a>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}

/** The building's expense catalog: add, rename-free (name is identity), toggle
 *  metered, deactivate. Deactivation hides a type from pickers without touching
 *  the expenses already filed under it. */
function ExpenseTypesManager({ scopeKind, scopeId }: { scopeKind: 'compound' | 'building'; scopeId: string }) {
  const { t } = useTranslation();
  const { types, reload } = useExpenseTypes(scopeKind, scopeId);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);

  async function add() {
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    const { error } = await supabase.from('expense_types').insert({
      building_id: scopeKind === 'building' ? scopeId : null,
      compound_id: scopeKind === 'compound' ? scopeId : null,
      name, sort_order: 100,
    });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    setNewName(''); reload();
  }

  async function patch(id: string, fields: Partial<ExpenseType>) {
    const { error } = await supabase.from('expense_types').update(fields).eq('id', id);
    if (error) { toast.error(error.message); return; }
    reload();
  }

  return (
    <div className="rounded-xl border border-border p-3">
      <p className="text-sm font-medium text-foreground">{t('buildings.expenseTypes')}</p>
      <p className="text-xs text-muted-foreground mt-0.5 mb-2">{t('buildings.expenseTypesHint')}</p>
      <div className="max-h-44 overflow-y-auto divide-y divide-border/60 mb-2">
        {types.map((ty) => (
          <div key={ty.id} className={cn('flex items-center justify-between gap-2 py-1.5 text-sm', !ty.active && 'opacity-50')}>
            <span className="text-foreground truncate">{ty.key ? t(`finance.cats.${ty.key}`) : ty.name}</span>
            <span className="flex items-center gap-3 shrink-0 text-xs">
              <label className="flex items-center gap-1 cursor-pointer text-muted-foreground">
                <input type="checkbox" className="accent-primary" checked={ty.is_metered}
                  onChange={(e) => patch(ty.id, { is_metered: e.target.checked })} />
                {t('buildings.metered')}
              </label>
              <button type="button" onClick={() => patch(ty.id, { active: !ty.active })}
                className="text-primary hover:underline cursor-pointer">
                {ty.active ? t('buildings.typeDisable') : t('buildings.typeEnable')}
              </button>
            </span>
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <input value={newName} onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
          placeholder={t('buildings.newTypePlaceholder')}
          className="flex-1 rounded-lg border border-border bg-background text-foreground px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring/40" />
        <Button type="button" variant="secondary" size="sm" onClick={add} loading={busy} disabled={!newName.trim()}>
          {t('common.add')}
        </Button>
      </div>
    </div>
  );
}
