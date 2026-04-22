import sql from '../db.js';

function normalizeEmail(email) {
    return email?.trim().toLowerCase() || null;
}

function normalizeName(name, fallbackEmail) {
    const trimmedName = name?.trim();

    if (trimmedName) {
        return trimmedName;
    }

    if (fallbackEmail) {
        return fallbackEmail.split('@')[0];
    }

    return 'Usuario';
}

function normalizeCpf(cpf) {
    const digits = cpf?.replace(/\D/g, '') || null;
    return digits || null;
}

function normalizeDisplayName(name) {
    const trimmedName = name?.trim();
    return trimmedName || null;
}

export function getAccessLevelLabel(level) {
    if (level === 1 || level === 'tecnico') {
        return 'Tecnico';
    }

    if (level === 2 || level === 'adm' || level === 'administrador') {
        return 'Administrador';
    }

    return 'Estudante';
}

export async function getProfileByAuthUserId(authUserId) {
    const [profile] = await sql`
        SELECT id_usuario, auth_user_id, nome, email, cpf, nivel_acesso, status_conta
        FROM usuario
        WHERE auth_user_id = ${authUserId}
        LIMIT 1
    `;

    return profile ?? null;
}

export async function getProfileByEmail(email) {
    const normalizedEmail = normalizeEmail(email);

    if (!normalizedEmail) {
        return null;
    }

    const [profile] = await sql`
        SELECT id_usuario, auth_user_id, nome, email, cpf, nivel_acesso, status_conta
        FROM usuario
        WHERE lower(email) = ${normalizedEmail}
        LIMIT 1
    `;

    return profile ?? null;
}

export async function getProfileSummaryByAuthUserId(authUserId) {
    const profile = await getProfileByAuthUserId(authUserId);

    if (!profile) {
        return null;
    }

    const recentOrders = await sql`
        SELECT
            p.id_pedido,
            p.data_pedido,
            p.data_retirada,
            p.data_devolucao,
            p.motivo_recusa,
            COALESCE(sp.descricao_status, 'Pendente') AS status
        FROM pedido p
        INNER JOIN usuario u ON u.id_usuario = p.id_usuario
        LEFT JOIN status_pedido sp ON sp.id_status = p.id_status
        WHERE u.auth_user_id = ${authUserId}
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

export async function upsertUserProfile({ authUserId, email, name, cpf }) {
    const normalizedEmail = normalizeEmail(email);
    const normalizedCpf = normalizeCpf(cpf);
    const normalizedName = normalizeName(name, normalizedEmail);

    if (!authUserId || !normalizedEmail) {
        throw new Error('authUserId e email são obrigatórios para sincronizar o perfil.');
    }

    const existingByAuthId = await getProfileByAuthUserId(authUserId);
    if (existingByAuthId) {
        const [updatedProfile] = await sql`
            UPDATE usuario
            SET
                nome = CASE
                    WHEN nome IS NULL OR nome = '' THEN ${normalizedName}
                    ELSE nome
                END,
                email = COALESCE(${normalizedEmail}, email),
                cpf = COALESCE(${normalizedCpf}, cpf),
                status_conta = COALESCE(status_conta, true)
            WHERE auth_user_id = ${authUserId}
            RETURNING id_usuario, auth_user_id, nome, email, cpf, nivel_acesso, status_conta
        `;

        return updatedProfile;
    }

    const existingByEmail = await getProfileByEmail(normalizedEmail);
    if (existingByEmail) {
        const [updatedProfile] = await sql`
            UPDATE usuario
            SET
                auth_user_id = COALESCE(auth_user_id, ${authUserId}),
                nome = CASE
                    WHEN nome IS NULL OR nome = '' THEN ${normalizedName}
                    ELSE nome
                END,
                cpf = COALESCE(cpf, ${normalizedCpf}),
                status_conta = COALESCE(status_conta, true)
            WHERE id_usuario = ${existingByEmail.id_usuario}
            RETURNING id_usuario, auth_user_id, nome, email, cpf, nivel_acesso, status_conta
        `;

        return updatedProfile;
    }

    const [createdProfile] = await sql`
        INSERT INTO usuario (auth_user_id, nome, email, cpf, status_conta, nivel_acesso)
        VALUES (${authUserId}, ${normalizedName}, ${normalizedEmail}, ${normalizedCpf}, true, 0)
        RETURNING id_usuario, auth_user_id, nome, email, cpf, nivel_acesso, status_conta
    `;

    return createdProfile;
}
