import { createClient } from '@supabase/supabase-js';
import { sessionStorageAdapter } from '@/lib/sessionStore';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

// `storage` is undefined on the web, so Supabase keeps its own localStorage
// behaviour untouched there. In the native app it is Keychain-backed, because
// WKWebView localStorage did not survive the app being swiped away — see
// src/lib/sessionStore.ts.
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: sessionStorageAdapter,
    persistSession: true,
    autoRefreshToken: true,
  },
});
