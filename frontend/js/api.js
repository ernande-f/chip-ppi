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

export async function getProdutos(filters = {}) {
    const params = new URLSearchParams();

    Object.entries(filters).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
            params.set(key, String(value));
        }
    });

    const suffix = params.size > 0 ? `?${params.toString()}` : '';
    const data = await apiRequest(`/api/produtos${suffix}`);
    const list = data.produtos || [];
    list.total = data.total ?? list.length;
    list.page = data.page ?? 1;
    list.limit = data.limit ?? list.length;
    list.totalPages = data.totalPages ?? 1;
    list.hasMore = data.hasMore ?? false;
    list.isCatalogManager = data.isCatalogManager ?? false;
    return list;
}

export async function getProduto(id) {
    const data = await apiRequest(`/api/produtos/${encodeURIComponent(id)}`);
    return data.produto;
}

export async function getCategorias() {
    const data = await apiRequest('/api/categorias');
    return data.categorias || [];
}

export async function createProduto(payload) {
    return apiRequest('/api/produtos', {
        method: 'POST',
        body: payload
    });
}

export async function updateProduto(id, payload) {
    return apiRequest(`/api/produtos/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: payload
    });
}

export async function deleteProduto(id) {
    return apiRequest(`/api/produtos/${encodeURIComponent(id)}`, {
        method: 'DELETE'
    });
}

export async function getCarrinho() {
    const data = await apiRequest('/api/carrinho');
    return data.itens || [];
}

export async function addItemCarrinho(productId, quantity = 1) {
    return apiRequest('/api/carrinho/itens', {
        method: 'POST',
        body: { productId, quantity }
    });
}

export async function updateItemCarrinho(productId, quantity) {
    return apiRequest(`/api/carrinho/itens/${encodeURIComponent(productId)}`, {
        method: 'PATCH',
        body: { quantity }
    });
}

export async function removeItemCarrinho(productId) {
    return apiRequest(`/api/carrinho/itens/${encodeURIComponent(productId)}`, {
        method: 'DELETE'
    });
}

export async function checkoutCarrinho(durationDays, acceptedTerms, justification = null) {
    return apiRequest('/api/pedidos', {
        method: 'POST',
        body: { durationDays, acceptedTerms, justification }
    });
}

export async function getPedidos() {
    const data = await apiRequest('/api/pedidos');
    return data.pedidos || [];
}

export async function cancelPedido(id) {
    return apiRequest(`/api/pedidos/${encodeURIComponent(id)}/cancelar`, {
        method: 'POST'
    });
}

export async function getPedidosGestao(status = '') {
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    const suffix = params.size > 0 ? `?${params.toString()}` : '';
    const data = await apiRequest(`/api/gestao/pedidos${suffix}`);
    return data.pedidos || [];
}

export async function transitionPedido(id, action, reason = null) {
    return apiRequest(`/api/gestao/pedidos/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: { action, reason }
    });
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
        return 'Não informado';
    }

    const dateParts = typeof dateString === 'string'
        ? dateString.match(/^(\d{4})-(\d{2})-(\d{2})(?:T|$)/)
        : null;
    const date = dateParts
        ? new Date(Number(dateParts[1]), Number(dateParts[2]) - 1, Number(dateParts[3]))
        : new Date(dateString);

    if (Number.isNaN(date.getTime())) {
        return 'Data inválida';
    }

    return new Intl.DateTimeFormat('pt-BR').format(date);
}

export function getStatusClass(status) {
    const normalizedStatus = (status || '').toLowerCase();

    if (normalizedStatus.includes('neg') || normalizedStatus.includes('cancel')) {
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

export function isUserTechnical(profile) {
    if (!profile) return false;
    const level = profile.nivel_acesso;
    const label = String(profile.nivel_acesso_label || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const strLevel = String(level || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

    return level === 1 || level === 2 ||
           strLevel === '1' || strLevel === '2' ||
           strLevel === 'tecnico' || strLevel === 'adm' || strLevel === 'administrador' ||
           label === 'tecnico' || label === 'adm' || label === 'administrador';
}

export function updateNavbarForRole(profile) {
    if (!profile) return;
    const isTechnical = isUserTechnical(profile);

    if (isTechnical) {
        const cartIcons = document.querySelectorAll('.navbar .nav-cart-icon');
        cartIcons.forEach((icon) => {
            icon.style.display = 'none';
        });

        const navPedidosLinks = document.querySelectorAll('.nav-links a[href="/pedidos"], .nav-links a[href="/pedidos.html"]');
        navPedidosLinks.forEach((link) => {
            link.href = '/pedidos.html';
            const textEl = link.querySelector('.nav-text-bold, span');
            if (textEl) {
                textEl.textContent = 'Pedidos';
            }
        });
    }
}

let _sessionPromise = null;

export async function getSession() {
    if (!_sessionPromise) {
        _sessionPromise = apiRequest('/api/session');
        // Limpar o cache após resolver, para que a próxima navegação busque dados frescos.
        _sessionPromise.finally(() => { setTimeout(() => { _sessionPromise = null; }, 5000); });
    }
    return _sessionPromise;
}

export async function login(payload) {
    return apiRequest('/api/login', {
        method: 'POST',
        body: payload
    });
}

export async function institutionalLogin(payload) {
    return apiRequest('/api/institutional-login', {
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
