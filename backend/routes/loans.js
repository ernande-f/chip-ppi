import express from 'express';
import { verifySessionAuth } from '../middleware/authSession.js';
import { OrderValidationError, OrderConflictError } from '../services/orderRules.js';
import { OrderNotFoundError, requestOrderRenewal, decideOrderRenewal, repeatOrder } from '../services/orderService.js';
import { AccountAccessError } from '../services/accountValidation.js';

const router = express.Router();
const isStaff = profile => [1, 2].includes(profile.nivel_acesso);
function sendError(res, error) {
    if (error instanceof AccountAccessError) return res.status(403).json({ success: false, message: error.message });
    if (error instanceof OrderValidationError) return res.status(400).json({ success: false, message: error.message });
    if (error instanceof OrderNotFoundError) return res.status(404).json({ success: false, message: error.message });
    if (error instanceof OrderConflictError) return res.status(409).json({ success: false, message: error.message });
    console.error('Erro na renovação ou repetição de pedido:', error);
    return res.status(500).json({ success: false, message: 'Não foi possível concluir a operação do pedido.' });
}

router.post('/pedidos/:id/renovacoes', verifySessionAuth, async (req, res) => {
    if (isStaff(req.profile)) return res.status(403).json({ success: false, message: 'Somente solicitantes podem pedir renovação.' });
    try {
        const pedido = await requestOrderRenewal(req.profile.id_usuario, req.params.id,
            { requestedDate: req.body.requestedDate, justification: req.body.justification, ip: req.ip });
        return res.status(201).json({ success: true, pedido });
    } catch (error) { return sendError(res, error); }
});

router.patch('/gestao/pedidos/:id/renovacoes/:renewalId', verifySessionAuth, async (req, res) => {
    if (!isStaff(req.profile)) return res.status(403).json({ success: false, message: 'Acesso negado.' });
    try {
        const pedido = await decideOrderRenewal(req.profile.id_usuario, req.params.id, req.params.renewalId,
            { approved: req.body.approved, reason: req.body.reason, ip: req.ip });
        return res.json({ success: true, pedido });
    } catch (error) { return sendError(res, error); }
});

router.post('/pedidos/:id/repetir', verifySessionAuth, async (req, res) => {
    if (isStaff(req.profile)) return res.status(403).json({ success: false, message: 'Somente solicitantes utilizam o carrinho.' });
    try {
        return res.json({ success: true, ...await repeatOrder(req.profile.id_usuario, req.params.id, { ip: req.ip }) });
    } catch (error) { return sendError(res, error); }
});

export default router;
