import express from 'express';
import { verifySessionAuth } from '../middleware/authSession.js';
import { getReport, reportToCsv, ReportValidationError } from '../services/reportService.js';

const router = express.Router();

router.use(verifySessionAuth, (req, res, next) => {
    if (![1, 2, 'tecnico', 'adm', 'administrador'].includes(req.profile?.nivel_acesso)) {
        return res.status(403).json({ success: false, message: 'Acesso restrito a técnicos e administradores.' });
    }
    next();
});

router.get(['/', '/exportar.csv'], async (req, res) => {
    try {
        const relatorio = await getReport(req.query);
        if (req.path === '/exportar.csv') {
            res.attachment(`CHIP-relatorio-${relatorio.periodo.inicio}-${relatorio.periodo.fim}.csv`);
            return res.type('text/csv; charset=utf-8').send(reportToCsv(relatorio));
        }
        return res.json({ success: true, relatorio });
    } catch (error) {
        if (error instanceof ReportValidationError) return res.status(400).json({ success: false, message: error.message });
        console.error('Erro ao gerar relatório:', error.code || error.name);
        return res.status(500).json({ success: false, message: 'Não foi possível gerar o relatório. Tente novamente.' });
    }
});

export default router;
