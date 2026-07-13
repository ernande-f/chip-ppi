import 'dotenv/config';

const DEFAULT_AUTH_URL = 'https://www3.fw.iffarroupilha.edu.br/auth/index.php';
const ALLOWED_TYPES = new Set(['L', 'S']);

function normalizeCpf(cpf) {
    return String(cpf || '').replace(/\D/g, '');
}

function normalizeType(type) {
    return String(type || '').trim().toUpperCase();
}

function readResponseValue(data, keys) {
    for (const key of keys) {
        const value = data?.[key];

        if (typeof value === 'string' && value.trim()) {
            return value.trim();
        }
    }

    return null;
}

function isApprovedResponse(response, data) {
    if (!response.ok || !data || typeof data !== 'object') {
        return false;
    }

    const status = String(data.status || data.result || '').trim().toLowerCase();
    return data.authenticated === true || data.success === true || ['success', 'ok', 'authenticated'].includes(status);
}

async function readJsonResponse(response) {
    const contentType = response.headers.get('content-type') || '';

    if (!contentType.includes('application/json')) {
        return null;
    }

    try {
        return await response.json();
    } catch {
        return null;
    }
}

/**
 * Valida credenciais no serviço institucional. A senha existe somente durante
 * esta requisição e nunca é registrada ou persistida pelo CHIP.
 */
export async function authenticateInstitutional({ cpf, password, type }, fetchImpl = fetch) {
    const normalizedCpf = normalizeCpf(cpf);
    const normalizedType = normalizeType(type);

    if (normalizedCpf.length !== 11) {
        throw new Error('Informe um CPF válido.');
    }

    if (!password) {
        throw new Error('Informe a senha institucional.');
    }

    if (!ALLOWED_TYPES.has(normalizedType)) {
        throw new Error('Selecione LDAP ou SIGAA.');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    try {
        const response = await fetchImpl(process.env.IFFAR_AUTH_URL || DEFAULT_AUTH_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                Accept: 'application/json'
            },
            body: new URLSearchParams({
                user: normalizedCpf,
                pass: password,
                tipo: normalizedType
            }),
            signal: controller.signal
        });
        const data = await readJsonResponse(response);

        if (!isApprovedResponse(response, data)) {
            return null;
        }

        return {
            cpf: normalizedCpf,
            type: normalizedType,
            name: readResponseValue(data, ['nome', 'name']),
            email: readResponseValue(data, ['email', 'mail'])
        };
    } catch (error) {
        if (error.name === 'AbortError') {
            throw new Error('O serviço institucional demorou para responder. Tente novamente.');
        }

        throw new Error('Não foi possível acessar o serviço institucional no momento.');
    } finally {
        clearTimeout(timeout);
    }
}
