import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'sonner';
import { AuthProvider } from '@/contexts/AuthContext';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { BetaGate } from '@/components/BetaGate';
import { ProtectedRoute } from '@/routes/ProtectedRoute';
import { AppShell } from '@/components/layout/AppShell';
import { SkeletonCards } from '@/components/ui/Skeleton';
import Landing from '@/pages/Landing';
import { Privacy, Terms } from '@/pages/Legal';

// The ROOT domain serves the public pages (no beta gate, no auth) — the app
// lives on app.abniyah.com. Same build, same deploy; the hostname decides.
// Plain pathname switch, no router needed for three static pages.
const ROOT_HOSTS = new Set(['abniyah.com', 'www.abniyah.com']);

const Login           = lazy(() => import('@/pages/Login'));
const Register        = lazy(() => import('@/pages/Register'));
const NoLicense       = lazy(() => import('@/pages/NoLicense'));
const SetPassword     = lazy(() => import('@/pages/SetPassword'));
const Dashboard  = lazy(() => import('@/pages/Dashboard'));
const Meetings   = lazy(() => import('@/pages/Meetings'));
const Finance    = lazy(() => import('@/pages/Finance'));
const Dues       = lazy(() => import('@/pages/Dues'));
const Structure  = lazy(() => import('@/pages/Structure'));
const Inspections = lazy(() => import('@/pages/Inspections'));
const Contracts  = lazy(() => import('@/pages/Contracts'));
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
    if (path.startsWith('/privacy')) return <Privacy />;
    if (path.startsWith('/terms')) return <Terms />;
    return <Landing />;
  }
  return (
    <BetaGate>
    <ThemeProvider>
    <AuthProvider>
      <Toaster position="top-right" richColors closeButton />
      <BrowserRouter>
        <Suspense fallback={<PageFallback />}>
          <Routes>
            <Route path="/" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/no-license" element={<NoLicense />} />
            <Route path="/set-password" element={<SetPassword />} />
            <Route
              element={
                <ProtectedRoute>
                  <AppShell />
                </ProtectedRoute>
              }
            >
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/meetings" element={<Meetings />} />
              <Route path="/finance" element={<Finance />} />
              <Route path="/dues" element={<Dues />} />
              <Route path="/structure" element={<Structure />} />
              <Route path="/inspections" element={<Inspections />} />
              <Route path="/contracts" element={<Contracts />} />
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
  );
}
