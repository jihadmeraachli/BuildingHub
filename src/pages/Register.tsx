import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/lib/supabase';
import { LICENSE_CAPS } from '@/lib/licenseCaps';
import { monthlyPriceCents, effectivePerUnitCents, fmtPerUnit, ANNUAL_MONTHS_CHARGED } from '@/lib/pricing';
import { useAuth } from '@/contexts/AuthContext';
import { betaScope } from '@/lib/demo';
import { LanguagePicker } from '@/components/ui/LanguagePicker';
import { Input } from '@/components/ui/Input';
import { CitySelect } from '@/components/ui/CitySelect';
import { Button } from '@/components/ui/Button';
import { Logo } from '@/components/ui/Logo';
import { Wordmark } from '@/components/ui/Wordmark';
import { cn } from '@/lib/utils';
import { Building2, Layers, Network, Check, ChevronLeft, MailCheck, Loader2 } from 'lucide-react';

// ── Types ────────────────────────────────────────────────────────────────────

type AdminRole = 'building_admin' | 'compound_admin' | 'org_admin';

/** Wizard answers stashed in auth user metadata at signUp; the entity + trial
 *  are only created AFTER the email is confirmed (see the finalize effect). */
interface PendingOnboarding {
  scope_type: 'building' | 'compound' | 'org';
  entity_name: string;
  city: string;
  unit_count: number;
  plan: 'monthly' | 'annual';
  billing_email: string;
  /** 0152: a compound's blocks, named in the wizard - born with the compound. */
  blocks?: string[];
}

interface WizardState {
  type: AdminRole | null;
  // account
  fullName: string;
  email: string;
  password: string;
  // entity
  entityName: string;
  city: string;
  blocks: string[];   // compound admins name their blocks up front (0152)
  // pricing
  unitCount: number;
  plan: 'monthly' | 'annual';
}

// ── Constants ─────────────────────────────────────────────────────────────────

// Copy lives in i18n under register.roles.<type>.{label,description,example}
const ROLE_CARDS: { type: AdminRole; icon: typeof Building2 }[] = [
  { type: 'building_admin', icon: Building2 },
  { type: 'compound_admin', icon: Layers },
  { type: 'org_admin', icon: Network },
];

const FEATURE_KEYS = ['f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7'];

// ── Helpers ───────────────────────────────────────────────────────────────────

function scopeType(role: AdminRole): 'building' | 'compound' | 'org' {
  if (role === 'building_admin') return 'building';
  if (role === 'compound_admin') return 'compound';
  return 'org';
}

function nounKey(role: AdminRole | null): 'building' | 'compound' | 'org' {
  if (role === 'compound_admin') return 'compound';
  if (role === 'org_admin') return 'org';
  return 'building';
}

/** What this building pays a month (0100). Annual bills 10 months for 12, so
 *  the monthly EQUIVALENT of the annual plan is the band divided by 1.2.
 *  Returns null above the top band: that price is agreed, not calculated. */
function monthlyEquivalentCents(plan: 'monthly' | 'annual', units: number): number | null {
  const m = monthlyPriceCents(units);
  if (m === null) return null;
  return plan === 'monthly' ? m : Math.round((m * ANNUAL_MONTHS_CHARGED) / 12);
}

// ── Steps progress bar (named phases) ─────────────────────────────────────────

function Steps({ current, labels }: { current: number; labels: string[] }) {
  return (
    <div className="flex items-start gap-1.5 mb-8">
      {labels.map((label, i) => (
        <div key={label} className="flex-1">
          <div
            className={cn(
              'h-1.5 rounded-full transition-all duration-300',
              i <= current ? 'bg-primary' : 'bg-border',
            )}
          />
          <p
            className={cn(
              'mt-1.5 text-[11px] font-medium truncate',
              i === current ? 'text-primary' : i < current ? 'text-foreground/70' : 'text-muted-foreground/60',
            )}
          >
            {label}
          </p>
        </div>
      ))}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function Register() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user, refreshProfile } = useAuth();
  const [step, setStep] = useState(0); // 0=role, 1=account, 2=entity, 3=pricing
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [awaitConfirm, setAwaitConfirm] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const finalizeOnce = useRef(false);

  const [state, setState] = useState<WizardState>({
    type: null,
    fullName: '', email: '', password: '',
    entityName: '', city: '', blocks: [''],
    unitCount: 10, plan: 'monthly',
  });

  const set = (patch: Partial<WizardState>) => setState(s => ({ ...s, ...patch }));

  // The user clicked the confirmation email and landed back here with a real
  // session. Their wizard answers are in user metadata — finish the setup now:
  // create the entity, start the trial, clear the metadata, go to dashboard.
  // Declared before any early return so hook order is stable (rules-of-hooks);
  // runOnboarding is a hoisted function declaration below.
  useEffect(() => {
    const pending = user?.user_metadata?.pending_onboarding as PendingOnboarding | undefined;
    if (!pending || finalizeOnce.current) return;
    finalizeOnce.current = true;
    (async () => {
      setFinalizing(true);
      const rpcErr = await runOnboarding(pending);
      if (rpcErr) {
        setFinalizing(false);
        finalizeOnce.current = false;
        setError(rpcErr.message);
        return;
      }
      await supabase.auth.updateUser({ data: { pending_onboarding: null } });
      await refreshProfile();
      navigate('/dashboard');
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // 0126: a demo-scoped beta code (partner reviews) unlocks the site and the
  // demo, never registration — the pricing model stays private until launch.
  if (betaScope() === 'demo') return <Navigate to="/demo" replace />;

  /** lowercase noun for sentences ("About your building") */
  const noun = (role: AdminRole | null) => t(`register.nouns.${nounKey(role)}`);
  /** title-case noun for labels and step names */
  const nounTitle = (role: AdminRole | null) => t(`register.nounsTitle.${nounKey(role)}`);

  const stepLabels = [
    t('register.stepRole'), t('register.stepAccount'), nounTitle(state.type), t('register.stepPlan'),
  ];

  // ── Step content (render functions, NOT components — keeps input focus) ──

  function renderRole() {
    return (
      <>
        <h2 className="text-2xl font-bold text-foreground mb-1">{t('register.getStarted')}</h2>
        <p className="text-muted-foreground text-sm mb-6">{t('register.roleSubtitle')}</p>
        <div className="space-y-3">
          {ROLE_CARDS.map(({ type, icon: Icon }) => (
            <button
              key={type}
              type="button"
              onClick={() => { set({ type }); setStep(1); }}
              className={cn(
                'w-full text-start rounded-xl border p-4 transition-all cursor-pointer',
                'hover:border-primary/50 hover:bg-primary/5',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                state.type === type ? 'border-primary bg-primary/5' : 'border-border bg-card',
              )}
            >
              <div className="flex items-start gap-3">
                <div className="mt-0.5 w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                  <Icon size={16} className="text-primary" />
                </div>
                <div>
                  <p className="font-semibold text-foreground text-sm">{t(`register.roles.${type}.label`)}</p>
                  <p className="text-muted-foreground text-xs mt-0.5 leading-relaxed">{t(`register.roles.${type}.description`)}</p>
                  <p className="text-muted-foreground/60 text-xs mt-1 italic">{t(`register.roles.${type}.example`)}</p>
                </div>
              </div>
            </button>
          ))}
        </div>
        <p className="mt-5 text-xs text-muted-foreground text-center">
          {t('register.residentNote')}
        </p>
      </>
    );
  }

  function renderAccount() {
    return (
      <>
        <h2 className="text-xl font-bold text-foreground mb-1">{t('register.createAccount')}</h2>
        <p className="text-muted-foreground text-sm mb-6">{t('register.trialNote')}</p>
        <div className="space-y-4">
          <Input
            label={t('auth.fullName')}
            value={state.fullName}
            onChange={e => set({ fullName: e.target.value })}
            autoComplete="name"
          />
          <Input
            label={t('auth.email')}
            type="email"
            value={state.email}
            onChange={e => set({ email: e.target.value })}
            autoComplete="email"
          />
          <Input
            label={t('auth.password')}
            type="password"
            value={state.password}
            onChange={e => set({ password: e.target.value })}
            autoComplete="new-password"
          />
        </div>
      </>
    );
  }

  function renderEntity() {
    const role = state.type as AdminRole;
    const needsCity = role !== 'org_admin';
    return (
      <>
        <h2 className="text-xl font-bold text-foreground mb-1">{t('register.aboutEntity', { noun: noun(role) })}</h2>
        <p className="text-muted-foreground text-sm mb-6">{t('register.entitySubtitle')}</p>
        <div className="space-y-4">
          <Input
            label={t('register.entityNameLabel', { noun: nounTitle(role) })}
            value={state.entityName}
            onChange={e => set({ entityName: e.target.value })}
            placeholder={t(`register.entityPlaceholder.${nounKey(role)}`)}
          />
          {/* Same picker as Buildings/Compounds — free text here was the main
              source of inconsistent city values (0060-era records have
              "beirut", "Beirut" and "Bayrut" all meaning one place). */}
          {needsCity && (
            <CitySelect label={t('register.city')} value={state.city} onChange={v => set({ city: v })} />
          )}
          {role === 'compound_admin' && (
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">{t('register.blocksLabel')}</label>
              <p className="text-xs text-muted-foreground mb-2">{t('register.blocksHint')}</p>
              <div className="space-y-2">
                {state.blocks.map((b, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input
                      value={b}
                      onChange={e => set({ blocks: state.blocks.map((x, j) => j === i ? e.target.value : x) })}
                      placeholder={t('register.blockPlaceholder', { n: i + 1 })}
                      className="flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                    {state.blocks.length > 1 && (
                      <button
                        type="button"
                        onClick={() => set({ blocks: state.blocks.filter((_, j) => j !== i) })}
                        aria-label={t('common.delete')}
                        className="shrink-0 w-8 h-8 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition cursor-pointer"
                      >×</button>
                    )}
                  </div>
                ))}
              </div>
              <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => set({ blocks: [...state.blocks, ''] })}>
                {t('register.addBlock')}
              </Button>
            </div>
          )}
        </div>
      </>
    );
  }

  function renderPricing() {
    // License cap per scope (0071, DB-enforced): mirror of license_cap() SQL.
    const unitCap = LICENSE_CAPS[scopeType(state.type as AdminRole)];
    const summaryCents = monthlyEquivalentCents(state.plan, state.unitCount);
    return (
      <>
        <h2 className="text-xl font-bold text-foreground mb-1">{t('register.choosePlan')}</h2>
        <p className="text-muted-foreground text-sm mb-5">{t('register.planSubtitle')}</p>

        {/* Unit count */}
        <div className="mb-5">
          <label className="block text-sm font-medium text-foreground mb-1.5">
            {t('register.unitCountLabel')}
          </label>
          <div className="flex items-center gap-3">
            <input
              type="number"
              min={1}
              max={unitCap}
              value={state.unitCount}
              onChange={e => set({ unitCount: Math.min(unitCap, Math.max(1, Number(e.target.value))) })}
              className="w-24 rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            />
            <span className="text-sm text-muted-foreground">
              {t('register.unitsWord')} <span className="text-xs opacity-70">· {t('register.upToUnits', { max: unitCap })}</span>
            </span>
          </div>
        </div>

        {/* Plan cards */}
        <div className="grid grid-cols-2 gap-3 mb-5">
          {(['monthly', 'annual'] as const).map(plan => {
            const selected = state.plan === plan;
            // The plan card shows THIS building's price, not a rate: the band
            // is already known from the unit count they just entered.
            const planCents = monthlyEquivalentCents(plan, state.unitCount);
            const period = plan === 'monthly' ? t('register.perMonthShort') : t('register.perMonthBilledYearly');
            const saving = plan === 'annual' ? t('register.save17') : null;
            return (
              <button
                key={plan}
                type="button"
                onClick={() => set({ plan })}
                className={cn(
                  'relative rounded-xl border p-4 text-start transition-all cursor-pointer',
                  selected ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'border-border bg-card hover:border-primary/40',
                )}
              >
                {saving && (
                  <span className="absolute -top-2.5 end-3 bg-primary text-primary-foreground text-[10px] font-bold px-2 py-0.5 rounded-full">
                    {saving}
                  </span>
                )}
                {selected && (
                  <Check size={14} className="absolute top-3 end-3 text-primary" />
                )}
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                  {plan === 'monthly' ? t('register.monthly') : t('register.annual')}
                </p>
                <p className="text-2xl font-bold text-foreground">
                  {planCents === null ? t('register.planTalk') : `$${(planCents / 100).toFixed(0)}`}
                </p>
                <p className="text-xs text-muted-foreground">{planCents === null ? '' : period}</p>
              </button>
            );
          })}
        </div>

        {/* Features */}
        <div className="rounded-xl bg-muted/40 p-4 space-y-1.5 mb-5">
          {FEATURE_KEYS.map(f => (
            <div key={f} className="flex items-start gap-2 text-sm text-muted-foreground">
              <Check size={13} className="mt-0.5 shrink-0 text-primary" />
              {t(`register.features.${f}`)}
            </div>
          ))}
        </div>

        {/* Live price summary — recalculates as they change the unit count,
            so the band is discovered by moving the number, not by reading a
            table. */}
        <div className="rounded-lg bg-primary/5 border border-primary/20 px-4 py-3 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">{t('register.afterTrial')}</span>
            <span className="font-semibold text-foreground">
              {summaryCents === null
                ? t('register.planTalk')
                : `$${(summaryCents / 100).toFixed(2)}${t('register.perMonthShort')}`}
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {summaryCents === null
              ? t('register.planTalkSub')
              : t('register.priceBanded', {
                  count: state.unitCount,
                  rate: fmtPerUnit(effectivePerUnitCents(state.unitCount)),
                })}
          </p>
        </div>
      </>
    );
  }

  // ── Submission ────────────────────────────────────────────────────────────

  async function runOnboarding(p: PendingOnboarding) {
    const { error: rpcErr } = await supabase.rpc('complete_admin_onboarding', {
      p_scope_type:    p.scope_type,
      p_entity_name:   p.entity_name,
      p_city:          p.city,
      p_unit_count:    p.unit_count,
      p_plan:          p.plan,
      p_billing_email: p.billing_email,
      p_blocks:        p.scope_type === 'compound' ? (p.blocks ?? null) : null,
    });
    return rpcErr;
  }


  async function submit() {
    setLoading(true);
    setError('');

    const payload: PendingOnboarding = {
      scope_type:    scopeType(state.type as AdminRole),
      entity_name:   state.entityName,
      city:          state.city || '',
      unit_count:    state.unitCount,
      plan:          state.plan,
      billing_email: state.email,
      blocks: state.type === 'compound_admin'
        ? state.blocks.map(b => b.trim()).filter(Boolean)
        : undefined,
    };

    // Create the auth account. The wizard answers ride along in metadata so the
    // entity + trial can be created after the email is confirmed — even if the
    // link is opened on a different device.
    const { data, error: signUpErr } = await supabase.auth.signUp({
      email: state.email,
      password: state.password,
      options: {
        data: { full_name: state.fullName, pending_onboarding: payload },
        emailRedirectTo: window.location.origin + '/register',
      },
    });
    if (signUpErr) { setError(signUpErr.message); setLoading(false); return; }

    // Existing email: Supabase anti-enumeration returns a FAKE success (user
    // with zero identities, no email sent) instead of an error — without this
    // check the person stares at "check your inbox" forever.
    if (data.user && (data.user.identities?.length ?? 0) === 0) {
      setError(t('register.emailExists'));
      setLoading(false);
      return;
    }

    // Email confirmation ON → no session yet. Entity creation is deferred;
    // show the "check your inbox" screen.
    if (!data.session) {
      setLoading(false);
      setAwaitConfirm(true);
      return;
    }

    // Confirmation OFF → we're signed in already, complete immediately.
    const rpcErr = await runOnboarding(payload);
    setLoading(false);
    if (rpcErr) { setError(rpcErr.message); return; }
    await supabase.auth.updateUser({ data: { pending_onboarding: null } });
    navigate('/dashboard');
  }

  async function handleNext() {
    setError('');

    if (step === 1) {
      if (state.fullName.trim().length < 3) { setError(t('register.fullNameRequired')); return; }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(state.email.trim())) { setError(t('register.emailInvalid')); return; }
      if (state.password.length < 8) { setError(t('auth.passwordTooShort')); return; }
      setStep(2);
      return;
    }

    if (step === 2) {
      if (!state.entityName.trim()) { setError(t('register.entityNameRequired', { noun: noun(state.type) })); return; }
      setStep(3);
      return;
    }

    if (step === 3) {
      await submit();
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const nextLabel =
    step === 1 ? t('register.continue') :
    step === 2 ? t('register.continue') :
    step === 3 ? t('register.startTrial') :
    null;

  const langToggle = <LanguagePicker />;

  // Post-confirmation finalize in progress — full-screen spinner.
  if (finalizing) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-background px-4">
        <Loader2 size={32} className="animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">{t('register.finalizing', { noun: noun(state.type) })}</p>
      </div>
    );
  }

  // Account created, waiting for the email link to be clicked.
  if (awaitConfirm) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4 py-12 bg-background">
        <div className="w-full max-w-md">
          <div className="flex items-center gap-2.5 mb-8">
            <Logo size={32} />
            <Wordmark className="text-sm text-foreground" />
          </div>
          <div className="bg-card rounded-2xl border border-border p-8 shadow-sm text-center">
            <div className="w-14 h-14 rounded-full bg-primary/15 flex items-center justify-center mx-auto mb-4">
              <MailCheck size={26} className="text-primary" />
            </div>
            <h2 className="text-xl font-bold text-foreground mb-2">{t('register.confirmTitle')}</h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {t('register.confirmPre')} <span className="font-medium text-foreground">{state.email}</span>.{' '}
              {t('register.confirmPost', { noun: noun(state.type) })}
            </p>
            <p className="text-xs text-muted-foreground mt-4">
              {t('register.noEmailHint2')}{' '}
              <a href="mailto:support@abniyah.com" className="underline text-primary hover:text-primary/80">
                {t('register.contactTeam')}
              </a>
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-12 bg-background">
      <div className="w-full max-w-md">

        {/* Header */}
        <div className="flex items-center gap-2.5 mb-8">
          <Logo size={32} />
          <Wordmark className="text-sm text-foreground" />
          <div className="ms-auto flex items-center gap-4">
            {langToggle}
            <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">{t('auth.loginHere')}</Link>
          </div>
        </div>

        {/* Named phase progress */}
        {step > 0 && <Steps current={step} labels={stepLabels} />}

        {/* Card */}
        <div className="bg-card rounded-2xl border border-border p-6 shadow-sm">
          {step === 0 && renderRole()}
          {step === 1 && renderAccount()}
          {step === 2 && renderEntity()}
          {step === 3 && renderPricing()}

          {error && (
            <div className="mt-4 rounded-lg bg-destructive/10 border border-destructive/30 px-4 py-3 text-sm text-destructive">
              {error}
            </div>
          )}

          {/* Navigation */}
          {nextLabel && (
            <div className="flex items-center gap-3 mt-6">
              <button
                type="button"
                onClick={() => { setError(''); setStep(s => s - 1); }}
                className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground cursor-pointer"
              >
                <ChevronLeft size={14} className="rtl:rotate-180" /> {t('common.back')}
              </button>
              <Button
                type="button"
                onClick={handleNext}
                loading={loading}
                className="ms-auto"
              >
                {nextLabel}
              </Button>
            </div>
          )}
        </div>

        <p className="mt-5 text-center text-xs text-muted-foreground">
          {t('auth.hasAccount')}{' '}
          <Link to="/" className="text-primary font-semibold hover:underline">{t('auth.loginHere')}</Link>
        </p>
      </div>
    </div>
  );
}
