import { Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, profile, loading, needsLicense, mfaPending } = useAuth();

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) return <Navigate to="/" replace />;

  // 2FA enrolled but this session hasn't passed the code yet — back to Login,
  // which detects the pending challenge and shows the code screen.
  if (mfaPending) return <Navigate to="/" replace />;

  // Resident-only account with no licensed unit (0031). Client-side UX gate only —
  // RLS in the database remains the real enforcement.
  if (needsLicense) return <Navigate to="/no-license" replace />;

  if (profile?.status === 'pending') {
    return (
      <div className="flex h-screen items-center justify-center p-6">
        <div className="max-w-sm text-center">
          <div className="w-12 h-12 bg-yellow-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <span className="text-2xl">⏳</span>
          </div>
          <h2 className="text-lg font-semibold text-slate-900 mb-2">Registration Pending</h2>
          <p className="text-slate-500 text-sm">Your registration is awaiting approval from the building admin. You'll be notified by email once approved.</p>
        </div>
      </div>
    );
  }

  if (profile?.status === 'rejected' || profile?.status === 'inactive') {
    return (
      <div className="flex h-screen items-center justify-center p-6">
        <div className="max-w-sm text-center">
          <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <span className="text-2xl">🚫</span>
          </div>
          <h2 className="text-lg font-semibold text-slate-900 mb-2">Access Denied</h2>
          <p className="text-slate-500 text-sm">Your account has been {profile.status}. Please contact the building admin.</p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
