import crypto from 'crypto';
import postgres from 'postgres';
import 'dotenv/config';
import { supabaseAdmin } from '../backend/supabase.js';

const sql = postgres(process.env.DATABASE_URL_POOLER, { max: 1 });

function generateTemporaryPassword() {
    return crypto.randomBytes(24).toString('base64url');
}

try {
    const unlinkedProfiles = await sql`
        SELECT id_usuario, nome, email
        FROM public.usuario
        WHERE auth_user_id IS NULL
          AND email IS NOT NULL
        ORDER BY id_usuario
    `;

    for (const profile of unlinkedProfiles) {
        const existingAuthUser = await sql`
            SELECT id, email
            FROM auth.users
            WHERE lower(email) = lower(${profile.email})
            LIMIT 1
        `;

        let authUserId = existingAuthUser[0]?.id;

        if (!authUserId) {
            const { data, error } = await supabaseAdmin.auth.admin.createUser({
                email: profile.email,
                password: generateTemporaryPassword(),
                email_confirm: true,
                user_metadata: {
                    name: profile.nome,
                    migrated_from_legacy: true,
                    needs_password_reset: true
                }
            });

            if (error) {
                throw error;
            }

            authUserId = data.user.id;
        }

        await sql`
            UPDATE public.usuario
            SET auth_user_id = ${authUserId}
            WHERE id_usuario = ${profile.id_usuario}
        `;
    }

    console.log(`Perfis legados sincronizados: ${unlinkedProfiles.length}`);
} finally {
    await sql.end();
}
