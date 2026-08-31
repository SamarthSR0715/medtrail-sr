import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';

const SUPABASE_URL =
  (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env['VITE_SUPABASE_URL']) ||
  (typeof process !== 'undefined' && process.env && process.env['VITE_SUPABASE_URL']) ||
  'https://jgurginsphlfdzwkitso.supabase.co';
const SUPABASE_PUBLISHABLE_KEY =
  (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env['VITE_SUPABASE_KEY']) ||
  (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env['VITE_SUPABASE_PUBLISHABLE_KEY']) ||
  (typeof process !== 'undefined' && process.env && process.env['VITE_SUPABASE_PUBLISHABLE_KEY']) ||
  'sb_publishable_gwsMa0bqUMIf2u_opKYieg_s8N47B7E';

if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
  throw new Error('Missing Supabase environment variables: VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY');
}

export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    storage: typeof window !== 'undefined' ? localStorage : undefined,
    persistSession: true,
    autoRefreshToken: true,
  },
});
