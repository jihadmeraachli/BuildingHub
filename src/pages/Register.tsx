import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Logo } from '@/components/ui/Logo';
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
  // pricing
  unitCount: number;
  plan: 'monthly' | 'annual';
}

// ── Constants ─────────────────────────────────────────────────────────────────

const ROLE_CARDS = [
  {
    type: 'building_admin' as AdminRole,
    icon: Building2,
    label: 'Building Admin',
    description: 'You manage one building — one block, one set of units. Ideal for a standalone residential tower.',
    example: 'e.g. a 12-floor apartment building with 48 units',
  },
  {
    type: 'compound_admin' as AdminRole,
    icon: Layers,
    label: 'Compound Admin',
    description: 'You manage multiple blocks that share a compound. One subscription covers all blocks — add new blocks any time.',
    example: 'e.g. a gated community with Blocks A, B, C',
  },
  {
    type: 'org_admin' as AdminRole,
    icon: Network,
    label: 'Organisation Admin',
    description: 'You manage multiple properties under one company or management firm. Full visibility across all buildings and compounds.',
    example: 'e.g. a property management company overseeing 5 buildings',
  },
];

const PLAN_FEATURES = [
  'Unit & resident management',
  'Full finance module (expenses, charges, payments)',
  'Dues & prepayment schedules',
  'Contract management (lifts, cleaning, etc.)',
  'Inspections & issue tracking',
  'Meetings & minutes',
  'PDF reports',
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function scopeType(role: AdminRole): 'building' | 'compound' | 'org' {
  if (role === 'building_admin') return 'building';
  if (role === 'compound_admin') return 'compound';
  return 'org';
}

function entityNoun(role: AdminRole | null) {
  if (role === 'compound_admin') return 'compound';
  if (role === 'org_admin') return 'organisation';
  return 'building';
}

function stepLabels(role: AdminRole | null): string[] {
  const noun = entityNoun(role);
  return ['Your role', 'Account', noun.charAt(0).toUpperCase() + noun.slice(1), 'Plan'];
}

function monthlyEquivalent(plan: 'monthly' | 'annual', units: number) {
  const ppu = plan === 'monthly' ? 5 : 50 / 12;
  return (ppu * units).toFixed(2);
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
    entityName: '', city: '',
    unitCount: 10, plan: 'monthly',
  });

  const set = (patch: Partial<WizardState>) => setState(s => ({ ...s, ...patch }));

  // ── Step content (render functions, NOT components — keeps input focus) ──

  function renderRole() {
    return (
      <>
        <h2 className="text-2xl font-bold text-foreground mb-1">Get started</h2>
        <p className="text-muted-foreground text-sm mb-6">Tell us what you manage so we set you up correctly.</p>
        <div className="space-y-3">
          {ROLE_CARDS.map(({ type, icon: Icon, label, description, example }) => (
            <button
              key={type}
              type="button"
              onClick={() => { set({ type }); setStep(1); }}
              className={cn(
                'w-full text-left rounded-xl border p-4 transition-all cursor-pointer',
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
                  <p className="font-semibold text-foreground text-sm">{label}</p>
                  <p className="text-muted-foreground text-xs mt-0.5 leading-relaxed">{description}</p>
                  <p className="text-muted-foreground/60 text-xs mt-1 italic">{example}</p>
                </div>
              </div>
            </button>
          ))}
        </div>
        <p className="mt-5 text-xs text-muted-foreground text-center">
          A resident? Your building admin will create your account and send you an invite.
        </p>
      </>
    );
  }

  function renderAccount() {
    return (
      <>
        <h2 className="text-xl font-bold text-foreground mb-1">Create your account</h2>
        <p className="text-muted-foreground text-sm mb-6">30-day free trial — no payment required.</p>
        <div className="space-y-4">
          <Input
            label="Full name"
            value={state.fullName}
            onChange={e => set({ fullName: e.target.value })}
            autoComplete="name"
          />
          <Input
            label="Email"
            type="email"
            value={state.email}
            onChange={e => set({ email: e.target.value })}
            autoComplete="email"
          />
          <Input
            label="Password"
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
    const noun = entityNoun(role);
    const needsCity = role !== 'org_admin';
    return (
      <>
        <h2 className="text-xl font-bold text-foreground mb-1">About your {noun}</h2>
        <p className="text-muted-foreground text-sm mb-6">This is what your team and residents will see.</p>
        <div className="space-y-4">
          <Input
            label={`${noun.charAt(0).toUpperCase() + noun.slice(1)} name`}
            value={state.entityName}
            onChange={e => set({ entityName: e.target.value })}
            placeholder={role === 'building_admin' ? 'e.g. Résidence Les Pins' : role === 'compound_admin' ? 'e.g. Garden City Compound' : 'e.g. Meraachli Properties'}
          />
          {needsCity && (
            <Input
              label="City"
              value={state.city}
              onChange={e => set({ city: e.target.value })}
              placeholder="e.g. Beirut"
            />
          )}
        </div>
      </>
    );
  }

  function renderPricing() {
    return (
      <>
        <h2 className="text-xl font-bold text-foreground mb-1">Choose your plan</h2>
        <p className="text-muted-foreground text-sm mb-5">First 30 days are free. Cancel any time.</p>

        {/* Unit count */}
        <div className="mb-5">
          <label className="block text-sm font-medium text-foreground mb-1.5">
            How many units do you manage?
          </label>
          <div className="flex items-center gap-3">
            <input
              type="number"
              min={1}
              max={9999}
              value={state.unitCount}
              onChange={e => set({ unitCount: Math.max(1, Number(e.target.value)) })}
              className="w-24 rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            />
            <span className="text-sm text-muted-foreground">units</span>
          </div>
        </div>

        {/* Plan cards */}
        <div className="grid grid-cols-2 gap-3 mb-5">
          {(['monthly', 'annual'] as const).map(plan => {
            const selected = state.plan === plan;
            const ppu = plan === 'monthly' ? 5 : 50;
            const period = plan === 'monthly' ? '/unit/month' : '/unit/year';
            const saving = plan === 'annual' ? 'Save 17%' : null;
            return (
              <button
                key={plan}
                type="button"
                onClick={() => set({ plan })}
                className={cn(
                  'relative rounded-xl border p-4 text-left transition-all cursor-pointer',
                  selected ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'border-border bg-card hover:border-primary/40',
                )}
              >
                {saving && (
                  <span className="absolute -top-2.5 right-3 bg-primary text-primary-foreground text-[10px] font-bold px-2 py-0.5 rounded-full">
                    {saving}
                  </span>
                )}
                {selected && (
                  <Check size={14} className="absolute top-3 right-3 text-primary" />
                )}
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                  {plan === 'monthly' ? 'Monthly' : 'Annual'}
                </p>
                <p className="text-2xl font-bold text-foreground">${ppu}</p>
                <p className="text-xs text-muted-foreground">{period}</p>
              </button>
            );
          })}
        </div>

        {/* Features */}
        <div className="rounded-xl bg-muted/40 p-4 space-y-1.5 mb-5">
          {PLAN_FEATURES.map(f => (
            <div key={f} className="flex items-start gap-2 text-sm text-muted-foreground">
              <Check size={13} className="mt-0.5 shrink-0 text-primary" />
              {f}
            </div>
          ))}
        </div>

        {/* Live price summary */}
        <div className="rounded-lg bg-primary/5 border border-primary/20 px-4 py-3 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">After trial ends</span>
            <span className="font-semibold text-foreground">
              ${monthlyEquivalent(state.plan, state.unitCount)}/mo
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {state.unitCount} units × ${state.plan === 'monthly' ? 5 : '50/12'}{state.plan === 'annual' ? ' ≈ $4.17' : ''}/unit/month
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
    });
    return rpcErr;
  }

  // The user clicked the confirmation email and landed back here with a real
  // session. Their wizard answers are in user metadata — finish the setup now:
  // create the entity, start the trial, clear the metadata, go to dashboard.
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
      if (!state.fullName.trim()) { setError('Full name is required.'); return; }
      if (!state.email.trim()) { setError('Email is required.'); return; }
      if (state.password.length < 8) { setError('Password must be at least 8 characters.'); return; }
      setStep(2);
      return;
    }

    if (step === 2) {
      if (!state.entityName.trim()) { setError(`Please enter a name for your ${entityNoun(state.type)}.`); return; }
      setStep(3);
      return;
    }

    if (step === 3) {
      await submit();
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const nextLabel =
    step === 1 ? 'Continue' :
    step === 2 ? 'Continue' :
    step === 3 ? 'Start free trial' :
    null;

  // Post-confirmation finalize in progress — full-screen spinner.
  if (finalizing) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-background px-4">
        <Loader2 size={32} className="animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Setting up your {entityNoun(state.type)} and starting your free trial…</p>
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
            <span className="text-base font-bold text-foreground">Abniyah</span>
          </div>
          <div className="bg-card rounded-2xl border border-border p-8 shadow-sm text-center">
            <div className="w-14 h-14 rounded-full bg-primary/15 flex items-center justify-center mx-auto mb-4">
              <MailCheck size={26} className="text-primary" />
            </div>
            <h2 className="text-xl font-bold text-foreground mb-2">Confirm your email</h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              We sent a confirmation link to <span className="font-medium text-foreground">{state.email}</span>.
              Click it to activate your account — your {entityNoun(state.type)} and 30-day free trial
              will be created the moment you do.
            </p>
            <p className="text-xs text-muted-foreground mt-4">
              Nothing in your inbox? Check spam, or contact the Abniyah team.
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
          <span className="text-base font-bold text-foreground">Abniyah</span>
          <Link to="/" className="ms-auto text-sm text-muted-foreground hover:text-foreground">Sign in</Link>
        </div>

        {/* Named phase progress */}
        {step > 0 && <Steps current={step} labels={stepLabels(state.type)} />}

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
                <ChevronLeft size={14} /> Back
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
          Already have an account?{' '}
          <Link to="/" className="text-primary font-semibold hover:underline">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
