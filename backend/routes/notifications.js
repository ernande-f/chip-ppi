import express from 'express';
import { verifySessionAuth } from '../middleware/authSession.js';
import { NotificationValidationError, listNotifications, markNotificationRead, markAllNotificationsRead, getNotificationDeliveryStatus } from '../services/notificationService.js';

const router = express.Router();
router.use(verifySessionAuth);
router.get('/', async (req, res, next) => {
    try { res.json({ success: true, ...await listNotifications(req.profile.id_usuario, req.query) }); } catch (error) { next(error); }
});
router.patch('/lidas', async (req, res, next) => {
    try { await markAllNotificationsRead(req.profile.id_usuario); res.json({ success: true }); } catch (error) { next(error); }
});
router.patch('/:id/lida', async (req, res, next) => {
    try {
        if (!await markNotificationRead(req.profile.id_usuario, req.params.id)) return res.status(404).json({ success: false, message: 'Notificação não encontrada.' });
        res.json({ success: true });
    } catch (error) { next(error); }
});
router.get('/envios', async (req, res, next) => {
    if (req.profile.nivel_acesso !== 2) return res.status(403).json({ success: false, message: 'Acesso reservado à administração.' });
    try { res.json({ success: true, ...await getNotificationDeliveryStatus() }); } catch (error) { next(error); }
});
router.use((error, req, res, next) => {
    if (error instanceof NotificationValidationError) return res.status(400).json({ success: false, message: error.message });
    console.error('Falha nas notificações:', error.code || error.name);
    res.status(500).json({ success: false, message: 'Não foi possível consultar ou atualizar as notificações.' });
});
export default router;
