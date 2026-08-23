import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'sonner';
import { AuthProvider } from '@/contexts/AuthContext';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { BetaGate } from '@/components/BetaGate';
import { BioLock } from '@/components/BioLock';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { ProtectedRoute } from '@/routes/ProtectedRoute';
import { AppShell } from '@/components/layout/AppShell';
import { SkeletonCards } from '@/components/ui/Skeleton';
import Landing from '@/pages/Landing';
import { Privacy, Terms, Credits } from '@/pages/Legal';
import Waitlist from '@/pages/Waitlist';

// The ROOT domain serves the public pages (no beta gate, no auth) — the app
// lives on app.abniyah.com. Same build, same deploy; the hostname decides.
// Plain pathname switch, no router needed for three static pages.
const ROOT_HOSTS = new Set(['abniyah.com', 'www.abniyah.com']);

const Login           = lazy(() => import('@/pages/Login'));
const Register        = lazy(() => import('@/pages/Register'));
const NoLicense       = lazy(() => import('@/pages/NoLicense'));
const SetPassword     = lazy(() => import('@/pages/SetPassword'));
const DemoEntry       = lazy(() => import('@/pages/DemoEntry'));
const Dashboard  = lazy(() => import('@/pages/Dashboard'));
const GettingStarted = lazy(() => import('@/pages/GettingStarted'));
const Meetings   = lazy(() => import('@/pages/Meetings'));
const Finance    = lazy(() => import('@/pages/Finance'));
const Reports    = lazy(() => import('@/pages/Reports'));
const Dues       = lazy(() => import('@/pages/Dues'));
const Structure  = lazy(() => import('@/pages/Structure'));
const Bylaws     = lazy(() => import('@/pages/Bylaws'));
const Inspections = lazy(() => import('@/pages/Inspections'));
const Contracts  = lazy(() => import('@/pages/Contracts'));
const Projects   = lazy(() => import('@/pages/Projects'));
const Collect    = lazy(() => import('@/pages/Collect'));
const BuildingContacts = lazy(() => import('@/pages/BuildingContacts'));
const Issues     = lazy(() => import('@/pages/Issues'));
const Users      = lazy(() => import('@/pages/Users'));
const Security   = lazy(() => import('@/pages/Security'));
const Buildings      = lazy(() => import('@/pages/Buildings'));
const Organizations  = lazy(() => import('@/pages/Organizations'));
const Compounds      = lazy(() => import('@/pages/Compounds'));
const Import         = lazy(() => import('@/pages/Import'));
const Licenses       = lazy(() => import('@/pages/Licenses'));
const PlatformLicensing = lazy(() => import('@/pages/PlatformLicensing'));
const Settings       = lazy(() => import('@/pages/Settings'));

function PageFallback() {
  return <div className="p-6"><SkeletonCards count={3} /></div>;
}

export default function App() {
  if (ROOT_HOSTS.has(window.location.hostname)) {
    const path = window.location.pathname;
    // Legal pages stay public — App Store review and external policies link here.
    if (path.startsWith('/privacy')) return <Privacy />;
    if (path.startsWith('/terms')) return <Terms />;
    if (path.startsWith('/credits')) return <Credits />;
    // Outside the gate on purpose: the gate offers a code or nothing, so every
    // visitor arriving from a post without one had nowhere to land.
    if (path.startsWith('/waitlist')) return <Waitlist />;
    // Stealth: the marketing page sits behind the same beta gate as the app
    // (per-origin localStorage, so testers enter their code once per domain).
    return <BetaGate><Landing /></BetaGate>;
  }
  // The waitlist answers on the app host too. On abniyah.com it is handled
  // above; here it must come BEFORE the gate and the biometric lock, or a
  // link shared as app.abniyah.com/waitlist lands on the very passcode screen
  // it exists to route around. A shared URL should not depend on which of the
  // two domains it happened to be copied from.
  if (window.location.pathname.startsWith('/waitlist')) {
    return <ErrorBoundary><Waitlist /></ErrorBoundary>;
  }

  return (
    // Outermost on purpose: a crash in the gate, the theme or the auth
    // provider is exactly the kind that used to blank the whole screen.
    <ErrorBoundary>
    <BioLock>
    <BetaGate>
    <ThemeProvider>
    <AuthProvider>
      <Toaster position="top-center" richColors closeButton />
      <BrowserRouter>
        <Suspense fallback={<PageFallback />}>
          <Routes>
            <Route path="/" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/no-license" element={<NoLicense />} />
            <Route path="/set-password" element={<SetPassword />} />
            <Route path="/demo" element={<DemoEntry />} />
            <Route
              element={
                <ProtectedRoute>
                  <AppShell />
                </ProtectedRoute>
              }
            >
              <Route path="/getting-started" element={<GettingStarted />} />
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/meetings" element={<Meetings />} />
              <Route path="/finance" element={<Finance />} />
              <Route path="/reports" element={<Reports />} />
              <Route path="/dues" element={<Dues />} />
              <Route path="/structure" element={<Structure />} />
              <Route path="/bylaws" element={<Bylaws />} />
              <Route path="/inspections" element={<Inspections />} />
              <Route path="/contracts" element={<Contracts />} />
              <Route path="/projects" element={<Projects />} />
              <Route path="/collect" element={<Collect />} />
              <Route path="/contacts" element={<BuildingContacts />} />
              <Route path="/issues" element={<Issues />} />
              <Route path="/users" element={<Users />} />
              <Route path="/security" element={<Security />} />
              <Route path="/buildings"     element={<Buildings />} />
              <Route path="/organizations" element={<Organizations />} />
              <Route path="/compounds"     element={<Compounds />} />
              <Route path="/import"        element={<Import />} />
              <Route path="/licenses"      element={<Licenses />} />
              <Route path="/licensing-admin" element={<PlatformLicensing />} />
              {/* your own account — no capability gate, everyone has one */}
              <Route path="/settings" element={<Settings />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </AuthProvider>
    </ThemeProvider>
    </BetaGate>
    </BioLock>
    </ErrorBoundary>
  );
}
