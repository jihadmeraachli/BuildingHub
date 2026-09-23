import { createClient } from '@supabase/supabase-js';
import { sessionStorageAdapter } from '@/lib/sessionStore';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

/**
 * Where supabase-js keeps the session. This is EXACTLY the library's own default
 * (`sb-<project ref>-auth-token`), spelled out so the Face ID sign-out in
 * bioSession.ts can clear the local session by name. Changing the value would
 * sign every user out once — it is named here, not customised.
 */
export const AUTH_STORAGE_KEY = `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`;

// `storage` is undefined on the web, so Supabase keeps its own localStorage
// behaviour untouched there. In the native app it is Keychain-backed, because
// WKWebView localStorage did not survive the app being swiped away — see
// src/lib/sessionStore.ts.
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: sessionStorageAdapter,
    storageKey: AUTH_STORAGE_KEY,
    persistSession: true,
    autoRefreshToken: true,
  },
});
