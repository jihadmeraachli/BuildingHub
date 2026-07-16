import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'sonner';
import { AuthProvider } from '@/contexts/AuthContext';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { ProtectedRoute } from '@/routes/ProtectedRoute';
import { AppShell } from '@/components/layout/AppShell';
import { SkeletonCards } from '@/components/ui/Skeleton';

const Login       = lazy(() => import('@/pages/Login'));
const Register    = lazy(() => import('@/pages/Register'));
const SetPassword = lazy(() => import('@/pages/SetPassword'));
const Dashboard  = lazy(() => import('@/pages/Dashboard'));
const Meetings   = lazy(() => import('@/pages/Meetings'));
const Billing    = lazy(() => import('@/pages/Billing'));
const Finance    = lazy(() => import('@/pages/Finance'));
const Dues       = lazy(() => import('@/pages/Dues'));
const Structure  = lazy(() => import('@/pages/Structure'));
const Inspections = lazy(() => import('@/pages/Inspections'));
const Contracts  = lazy(() => import('@/pages/Contracts'));
const Issues     = lazy(() => import('@/pages/Issues'));
const Users      = lazy(() => import('@/pages/Users'));
const Buildings  = lazy(() => import('@/pages/Buildings'));
const Settings   = lazy(() => import('@/pages/Settings'));

function PageFallback() {
  return <div className="p-6"><SkeletonCards count={3} /></div>;
}

export default function App() {
  return (
    <ThemeProvider>
    <AuthProvider>
      <Toaster position="top-right" richColors closeButton />
      <BrowserRouter>
        <Suspense fallback={<PageFallback />}>
          <Routes>
            <Route path="/" element={<Login />} />
            <Route path="/register" element={<Register />} />
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
              <Route path="/billing" element={<Billing />} />
              <Route path="/issues" element={<Issues />} />
              <Route path="/users" element={<Users />} />
              <Route path="/buildings" element={<Buildings />} />
              {/* your own account — no capability gate, everyone has one */}
              <Route path="/settings" element={<Settings />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </AuthProvider>
    </ThemeProvider>
  );
}
