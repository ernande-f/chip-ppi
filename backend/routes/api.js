import express from 'express';
import { verifySessionAuth, optionalSessionAuth } from '../middleware/authSession.js';
import {
    getProfileSummaryByAuthUserId,
    updateProfileByAuthUserId,
    upsertGoogleUserProfile
} from '../services/userProfile.js';
import {
    ProductConflictError,
    ProductNotFoundError,
    ProductValidationError,
    createProduct,
    deleteProduct,
    getAllCategories,
    getProductById,
    listProducts,
    updateProduct
} from '../services/productService.js';
import { startGoogleLogin, completeGoogleLogin } from '../services/googleAuth.js';
import { clearSessionCookie, setSessionCookie } from '../services/sessionAuth.js';
import {
    assertAccountIsActive
} from '../services/accountValidation.js';
import {
    OrderConflictError,
    OrderNotFoundError,
    addCartItem,
    cancelUserOrder,
    checkoutCart,
    getCart,
    listManagedOrders,
    listUserOrders,
    removeCartItem,
    transitionOrder,
    updateCartItem
} from '../services/orderService.js';
import { OrderValidationError } from '../services/orderRules.js';

const router = express.Router();

function hasCatalogManagementAccess(level) {
    return level === 1 || level === 2 || level === 'tecnico' || level === 'adm' || level === 'administrador';
}

async function getCatalogManagerProfile(req) {
    if (!hasCatalogManagementAccess(req.profile?.nivel_acesso)) {
        return null;
    }

    return req.profile;
}

function sendProductError(res, error) {
    if (error instanceof ProductValidationError) {
        return res.status(400).json({ success: false, message: error.message });
    }

    if (error instanceof ProductNotFoundError) {
        return res.status(404).json({ success: false, message: error.message });
    }

    if (error instanceof ProductConflictError) {
        return res.status(409).json({ success: false, message: error.message });
    }

    console.error('Erro no catálogo:', error);
    return res.status(500).json({ success: false, message: 'Não foi possível concluir a operação no catálogo.' });
}

function sendOrderError(res, error) {
    if (error instanceof OrderValidationError) {
        return res.status(400).json({ success: false, message: error.message });
    }

    if (error instanceof OrderNotFoundError) {
        return res.status(404).json({ success: false, message: error.message });
    }

    if (error instanceof OrderConflictError) {
        return res.status(409).json({ success: false, message: error.message });
    }

    console.error('Erro no fluxo de pedidos:', error);
    return res.status(500).json({ success: false, message: 'Não foi possível concluir a operação do pedido.' });
}

router.get('/auth/google', (req, res) => {
    try {
        startGoogleLogin(res);
    } catch {
        res.status(503).send('Login Google não configurado. Consulte a administração.');
    }
});

router.get('/auth/google/callback', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
        const identity = await completeGoogleLogin(req, res);
        const profile = await upsertGoogleUserProfile(identity);
        assertAccountIsActive(profile);
        setSessionCookie(res, {
            id: profile.auth_user_id,
            email: profile.email,
            user_metadata: { name: profile.nome },
            auth_provider: 'google'
        });
        return res.redirect('/');
    } catch (error) {
        console.error('Falha no login Google:', error.name);
        return res.redirect('/login?error=google');
    }
});

// Endpoints antigos não podem contornar a restrição institucional do Google.
router.post(['/login', '/institutional-login', '/register', '/forgot-password', '/update-password'], (req, res) => {
    res.status(410).json({ success: false, message: 'Use Entrar com Google com sua conta institucional.' });
});

router.get('/status', (req, res) => {
    res.json({ message: 'API do CHIP-PPI está funcionando!' });
});

router.get('/session', optionalSessionAuth, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!req.user) return res.json({ success: true, user: null, profile: null });
    try {
        const profile = await getProfileSummaryByAuthUserId(req.user.id, req.profile);

        if (!profile) {
            return res.status(404).json({ success: false, message: 'Perfil não encontrado.' });
        }

        res.json({
            success: true,
            user: req.user,
            profile
        });
    } catch (error) {
        console.error('Erro ao consultar sessão:', error);
        res.status(500).json({ success: false, message: 'Erro ao consultar sessão' });
    }
});

router.get('/profile', verifySessionAuth, async (req, res) => {
    try {
        const profile = await getProfileSummaryByAuthUserId(req.user.id, req.profile);

        if (!profile) {
            return res.status(404).json({ success: false, message: 'Perfil não encontrado.' });
        }

        res.json({
            success: true,
            profile
        });
    } catch (error) {
        console.error('Erro ao consultar perfil:', error);
        res.status(500).json({ success: false, message: 'Erro ao consultar perfil.' });
    }
});

router.patch('/profile', verifySessionAuth, async (req, res) => {
    const { name } = req.body;

    try {
        const profile = await updateProfileByAuthUserId(req.user.id, { name });

        if (!profile) {
            return res.status(404).json({ success: false, message: 'Perfil não encontrado.' });
        }

        res.json({
            success: true,
            message: 'Perfil atualizado com sucesso.',
            profile
        });
    } catch (error) {
        console.error('Erro ao atualizar perfil:', error);

        const isValidationError = error.message?.includes('nome válido') || error.message?.includes('obrigatório');
        const status = isValidationError ? 400 : 500;

        res.status(status).json({
            success: false,
            message: isValidationError ? error.message : 'Erro ao atualizar perfil.'
        });
    }
});

router.post('/logout', async (req, res) => {
    try {
        clearSessionCookie(res);
        res.json({ success: true, message: 'Desconectado com sucesso' });
    } catch (error) {
        console.error('Erro ao fazer logout:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

router.get('/carrinho', verifySessionAuth, async (req, res) => {
    try {
        const itens = await getCart(req.profile.id_usuario);
        return res.json({ success: true, itens });
    } catch (error) {
        return sendOrderError(res, error);
    }
});

router.post('/carrinho/itens', verifySessionAuth, async (req, res) => {
    try {
        if (hasCatalogManagementAccess(req.profile?.nivel_acesso)) {
            return res.status(403).json({ success: false, message: 'Administradores e técnicos não utilizam carrinho de compras.' });
        }

        const item = await addCartItem(req.profile.id_usuario, req.body.productId, req.body.quantity ?? 1);
        return res.status(201).json({ success: true, message: 'Item adicionado ao carrinho.', item });
    } catch (error) {
        return sendOrderError(res, error);
    }
});

router.patch('/carrinho/itens/:productId', verifySessionAuth, async (req, res) => {
    try {
        const item = await updateCartItem(req.profile.id_usuario, req.params.productId, req.body.quantity);
        return res.json({ success: true, message: 'Quantidade atualizada.', item });
    } catch (error) {
        return sendOrderError(res, error);
    }
});

router.delete('/carrinho/itens/:productId', verifySessionAuth, async (req, res) => {
    try {
        const item = await removeCartItem(req.profile.id_usuario, req.params.productId);
        return res.json({ success: true, message: 'Item removido do carrinho.', item });
    } catch (error) {
        return sendOrderError(res, error);
    }
});

router.get('/pedidos', verifySessionAuth, async (req, res) => {
    try {
        const pedidos = await listUserOrders(req.profile.id_usuario);
        return res.json({ success: true, pedidos });
    } catch (error) {
        return sendOrderError(res, error);
    }
});

router.post('/pedidos', verifySessionAuth, async (req, res) => {
    try {
        if (hasCatalogManagementAccess(req.profile?.nivel_acesso)) {
            return res.status(403).json({ success: false, message: 'Administradores e técnicos não realizam pedidos.' });
        }

        const pedido = await checkoutCart(req.profile.id_usuario, {
            durationDays: req.body.durationDays,
            acceptedTerms: req.body.acceptedTerms,
            justification: req.body.justification ?? req.body.justificativa,
            reservationStart: req.body.reservationStart,
            reservationEnd: req.body.reservationEnd
        });
        return res.status(201).json({ success: true, message: 'Pedido enviado para aprovação.', pedido });
    } catch (error) {
        return sendOrderError(res, error);
    }
});

router.post('/pedidos/:id/cancelar', verifySessionAuth, async (req, res) => {
    try {
        const pedido = await cancelUserOrder(req.profile.id_usuario, req.params.id, { ip: req.ip });
        return res.json({ success: true, message: 'Pedido cancelado.', pedido });
    } catch (error) {
        return sendOrderError(res, error);
    }
});

router.get('/gestao/pedidos', verifySessionAuth, async (req, res) => {
    if (!hasCatalogManagementAccess(req.profile.nivel_acesso)) {
        return res.status(403).json({ success: false, message: 'Acesso negado.' });
    }

    try {
        const pedidos = await listManagedOrders(req.query.status);
        return res.json({ success: true, pedidos });
    } catch (error) {
        return sendOrderError(res, error);
    }
});

router.patch('/gestao/pedidos/:id', verifySessionAuth, async (req, res) => {
    if (!hasCatalogManagementAccess(req.profile.nivel_acesso)) {
        return res.status(403).json({ success: false, message: 'Acesso negado.' });
    }

    try {
        const pedido = await transitionOrder(
            req.profile.id_usuario,
            req.params.id,
            req.body.action,
            { reason: req.body.reason, ip: req.ip }
        );
        return res.json({ success: true, message: 'Status do pedido atualizado.', pedido });
    } catch (error) {
        return sendOrderError(res, error);
    }
});


// Consulta pública; itens arquivados continuam restritos à gestão.
router.get('/produtos', optionalSessionAuth, async (req, res) => {
    try {
        const managerProfile = await getCatalogManagerProfile(req);
        const result = await listProducts({
            ...req.query,
            availableOnly: managerProfile ? req.query.availableOnly : true,
            includeArchived: managerProfile && req.query.includeArchived === 'true'
        });

        return res.json({
            success: true,
            produtos: result.produtos,
            total: result.total,
            page: result.page,
            limit: result.limit,
            totalPages: result.totalPages,
            hasMore: result.hasMore,
            isCatalogManager: Boolean(managerProfile)
        });
    } catch (error) {
        console.error('Erro na rota /produtos:', error);
        res.status(500).json({ success: false, message: 'Erro interno ao buscar produtos.' });
    }
});

router.post('/produtos', verifySessionAuth, async (req, res) => {
    try {
        const profile = await getCatalogManagerProfile(req);

        if (!profile) {
            return res.status(403).json({ success: false, message: 'Acesso negado. Apenas técnicos podem cadastrar itens.' });
        }

        const produto = await createProduct(req.body);

        return res.status(201).json({ success: true, message: 'Item cadastrado com sucesso!', produto });
    } catch (error) {
        return sendProductError(res, error);
    }
});

router.get('/produtos/:id', optionalSessionAuth, async (req, res) => {
    try {
        const produto = await getProductById(req.params.id);

        if (!produto) {
            return res.status(404).json({ success: false, message: 'Item não encontrado.' });
        }

        const managerProfile = await getCatalogManagerProfile(req);
        if (!managerProfile && (produto.status_produto !== 'Disponível' || produto.estoque_total < 1)) {
            return res.status(404).json({ success: false, message: 'Item não encontrado.' });
        }

        return res.json({ success: true, produto });
    } catch (error) {
        return sendProductError(res, error);
    }
});

router.patch('/produtos/:id', verifySessionAuth, async (req, res) => {
    try {
        const profile = await getCatalogManagerProfile(req);

        if (!profile) {
            return res.status(403).json({ success: false, message: 'Acesso negado. Apenas técnicos e administradores podem alterar itens.' });
        }

        const produto = await updateProduct(req.params.id, req.body);
        return res.json({ success: true, message: 'Item atualizado com sucesso!', produto });
    } catch (error) {
        return sendProductError(res, error);
    }
});

router.delete('/produtos/:id', verifySessionAuth, async (req, res) => {
    try {
        const profile = await getCatalogManagerProfile(req);

        if (!profile) {
            return res.status(403).json({ success: false, message: 'Acesso negado. Apenas técnicos e administradores podem remover itens.' });
        }

        const produto = await deleteProduct(req.params.id);
        return res.json({ success: true, message: 'Item removido do catálogo.', produto });
    } catch (error) {
        return sendProductError(res, error);
    }
});

router.get('/categorias', optionalSessionAuth, async (req, res) => {
    try {
        const categorias = await getAllCategories();
        return res.json({ success: true, categorias });
    } catch (error) {
        console.error('Erro ao listar categorias:', error);
        return res.status(500).json({ success: false, message: 'Não foi possível listar as categorias.' });
    }
});


// ÚLTIMA LINHA ABAIXO!!!
export default router;
