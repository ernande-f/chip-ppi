async function parseJsonSafely(response) {
    const text = await response.text();

    if (!text) {
        return {};
    }

    try {
        return JSON.parse(text);
    } catch {
        return { message: text };
    }
}

export async function apiRequest(url, options = {}) {
    const config = {
        credentials: 'same-origin',
        headers: {
            'Content-Type': 'application/json',
            ...(options.headers || {})
        },
        ...options
    };

    if (config.body && typeof config.body !== 'string') {
        config.body = JSON.stringify(config.body);
    }

    const response = await fetch(url, config);
    const data = await parseJsonSafely(response);

    if (!response.ok) {
        throw new Error(data.message || data.error || 'Erro na comunicação com o servidor.');
    }

    return data;
}

export function maskCpf(cpf) {
    const digits = (cpf || '').replace(/\D/g, '').slice(0, 11);

    if (digits.length !== 11) {
        return cpf || '';
    }

    return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
}

export function getInitials(name) {
    return (name || '')
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0]?.toUpperCase() || '')
        .join('') || 'CH';
}

export function formatDate(dateString) {
    if (!dateString) {
        return 'Nao informado';
    }

    return new Intl.DateTimeFormat('pt-BR').format(new Date(`${dateString}T00:00:00`));
}

export function getStatusClass(status) {
    const normalizedStatus = (status || '').toLowerCase();

    if (normalizedStatus.includes('neg')) {
        return 'status-negado';
    }

    if (
        normalizedStatus.includes('apro') ||
        normalizedStatus.includes('pronto') ||
        normalizedStatus.includes('retirado') ||
        normalizedStatus.includes('devolvido')
    ) {
        return 'status-aceito';
    }

    return 'status-pendente';
}

export async function getSession() {
    return apiRequest('/api/session');
}

export async function login(payload) {
    return apiRequest('/api/login', {
        method: 'POST',
        body: payload
    });
}

export async function register(payload) {
    return apiRequest('/api/register', {
        method: 'POST',
        body: payload
    });
}

export async function sendPasswordResetEmail(email) {
    return apiRequest('/api/forgot-password', {
        method: 'POST',
        body: { email }
    });
}

export async function updatePassword(password, headers = {}) {
    return apiRequest('/api/update-password', {
        method: 'POST',
        headers,
        body: { password }
    });
}

export async function logout() {
    return apiRequest('/api/logout', {
        method: 'POST'
    });
}

export async function getProfile() {
    return apiRequest('/api/profile');
}

export async function updateProfile(payload) {
    return apiRequest('/api/profile', {
        method: 'PATCH',
        body: payload
    });
}
