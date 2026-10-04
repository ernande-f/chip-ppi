import sql from '../db.js';
import { randomUUID } from 'crypto';

export async function upsertGoogleUserProfile({ sub, email, name }) {
    return sql.begin(async (db) => {
        // Serializa primeiros logins da mesma conta; preserva perfil e permissões existentes.
        await db`SELECT pg_advisory_xact_lock(hashtext(${sub}))`;
        const [existing] = await db`
            SELECT * FROM usuario WHERE google_sub = ${sub} OR lower(email) = ${email}
            ORDER BY (google_sub = ${sub}) DESC NULLS LAST FOR UPDATE
        `;
        if (existing) {
            if (existing.google_sub && existing.google_sub !== sub) throw new Error('Conta Google já vinculada.');
            const [profile] = await db`
                UPDATE usuario SET google_sub = ${sub}, auth_provider = 'google',
                    auth_user_id = COALESCE(auth_user_id, ${randomUUID()}), email = ${email}
                WHERE id_usuario = ${existing.id_usuario} RETURNING *
            `;
            return profile;
        }
        const [profile] = await db`
            INSERT INTO usuario (google_sub, auth_user_id, auth_provider, nome, email, nivel_acesso, status_conta)
            VALUES (${sub}, ${randomUUID()}, 'google', ${name || 'Usuário'}, ${email}, 0, true)
            RETURNING *
        `;
        return profile;
    });
}

function normalizeDisplayName(name) {
    const trimmedName = name?.trim();
    return trimmedName || null;
}

export function getAccessLevelLabel(level) {
    if (level === 1 || level === 'tecnico' || level === 'técnico') {
        return 'Técnico';
    }

    if (level === 2 || level === 'adm' || level === 'administrador') {
        return 'Administrador';
    }

    return 'Estudante';
}

export async function getProfileByAuthUserId(authUserId) {
    const [profile] = await sql`
        SELECT id_usuario, auth_user_id, google_sub, auth_provider, nome, email, cpf, nivel_acesso, status_conta
        FROM usuario
        WHERE auth_user_id = ${authUserId}
        LIMIT 1
    `;

    return profile ?? null;
}

export async function getProfileSummaryByAuthUserId(authUserId, existingProfile = null) {
    const profile = existingProfile || await getProfileByAuthUserId(authUserId);

    if (!profile) {
        return null;
    }

    const isTechnical = profile.nivel_acesso === 1 || profile.nivel_acesso === 2 ||
                        profile.nivel_acesso === 'tecnico' || profile.nivel_acesso === 'adm' ||
                        profile.nivel_acesso === 'administrador';

    const recentOrders = isTechnical ? [] : await sql`
        SELECT
            p.id_pedido,
            p.data_pedido,
            p.data_retirada,
            p.data_devolucao,
            p.motivo_recusa,
            COALESCE(sp.descricao_status, 'Pendente') AS status
        FROM pedido p
        LEFT JOIN status_pedido sp ON sp.id_status = p.id_status
        WHERE p.id_usuario = ${profile.id_usuario}
        ORDER BY p.data_pedido DESC, p.id_pedido DESC
        LIMIT 5
    `;

    return {
        ...profile,
        nivel_acesso_label: getAccessLevelLabel(profile.nivel_acesso),
        recentOrders
    };
}

export async function updateProfileByAuthUserId(authUserId, { name }) {
    const normalizedName = normalizeDisplayName(name);

    if (!authUserId) {
        throw new Error('authUserId é obrigatório para atualizar o perfil.');
    }

    if (!normalizedName || normalizedName.length < 3) {
        throw new Error('Informe um nome válido com pelo menos 3 caracteres.');
    }

    const [updatedProfile] = await sql`
        UPDATE usuario
        SET nome = ${normalizedName}
        WHERE auth_user_id = ${authUserId}
        RETURNING id_usuario, auth_user_id, nome, email, cpf, nivel_acesso, status_conta
    `;

    return updatedProfile ?? null;
}
