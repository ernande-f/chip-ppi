import express from 'express';
import { verifySessionAuth } from '../middleware/authSession.js';
import { listUserOrders } from '../services/orderService.js';
import { AccountValidationError, AccountPermissionError, AccountNotFoundError, AccountConflictError,
    listManagedUsers, getManagedUser, updateManagedUser } from '../services/accountService.js';

const router = express.Router();
router.use('/gestao/usuarios', verifySessionAuth, (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (![1, 2].includes(req.profile.nivel_acesso)) return res.status(403).json({ success: false, message: 'Acesso restrito à equipe do laboratório.' });
    next();
});

function sendError(res, error) {
    const status = error instanceof AccountValidationError ? 400 : error instanceof AccountPermissionError ? 403
        : error instanceof AccountNotFoundError ? 404 : error instanceof AccountConflictError ? 409 : 500;
    if (status === 500) console.error('Erro na gestão de usuários:', error);
    return res.status(status).json({ success: false, message: status === 500 ? 'Não foi possível concluir a operação de usuários.' : error.message });
}

router.get('/gestao/usuarios', async (req, res) => {
    try { return res.json({ success: true, ...await listManagedUsers(req.query) }); }
    catch (error) { return sendError(res, error); }
});

router.get('/gestao/usuarios/:id/pedidos', async (req, res) => {
    try {
        const usuario = await getManagedUser(req.params.id);
        return res.json({ success: true, usuario, pedidos: await listUserOrders(usuario.id_usuario) });
    } catch (error) { return sendError(res, error); }
});

router.patch('/gestao/usuarios/:id', async (req, res) => {
    if (req.profile.nivel_acesso !== 2) return res.status(403).json({ success: false, message: 'Somente administradores podem alterar usuários.' });
    try {
        const usuario = await updateManagedUser(req.profile.id_usuario, req.params.id, req.body, { ip: req.ip });
        return res.json({ success: true, message: 'Usuário atualizado.', usuario });
    } catch (error) { return sendError(res, error); }
});

export default router;
