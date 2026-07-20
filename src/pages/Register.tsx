import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Logo } from '@/components/ui/Logo';
import { cn } from '@/lib/utils';
import { Building2, Layers, Network, Check, ChevronLeft } from 'lucide-react';

// ── Types ────────────────────────────────────────────────────────────────────

type AdminRole = 'building_admin' | 'compound_admin' | 'org_admin';

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
  const [step, setStep] = useState(0); // 0=role, 1=account, 2=entity, 3=pricing
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

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

  async function submit() {
    setLoading(true);
    setError('');

    // 1. Create auth account
    const { error: signUpErr } = await supabase.auth.signUp({
      email: state.email,
      password: state.password,
      options: { data: { full_name: state.fullName } },
    });
    if (signUpErr) { setError(signUpErr.message); setLoading(false); return; }

    // 2. Complete onboarding atomically via RPC
    const { error: rpcErr } = await supabase.rpc('complete_admin_onboarding', {
      p_scope_type:    scopeType(state.type as AdminRole),
      p_entity_name:   state.entityName,
      p_city:          state.city || '',
      p_unit_count:    state.unitCount,
      p_plan:          state.plan,
      p_billing_email: state.email,
    });

    setLoading(false);
    if (rpcErr) { setError(rpcErr.message); return; }
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
