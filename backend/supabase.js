import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const supabaseUrl = process.env.SUPABASE_URL;
const publicKey =
    process.env.SUPABASE_ANON_KEY ||
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    process.env.SUPABASE_KEY;
const adminKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_KEY;

if (!supabaseUrl || !publicKey) {
    throw new Error('SUPABASE_URL e uma chave pública do Supabase são obrigatórias.');
}

if (!adminKey) {
    throw new Error('Uma chave administrativa do Supabase é obrigatória para operações de registro.');
}

export const supabaseAuth = createClient(supabaseUrl, publicKey, {
    auth: {
        autoRefreshToken: false,
        persistSession: false
    }
});

export const supabaseAdmin = createClient(supabaseUrl, adminKey, {
    auth: {
        autoRefreshToken: false,
        persistSession: false
    }
});
