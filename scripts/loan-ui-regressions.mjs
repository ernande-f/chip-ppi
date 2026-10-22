import assert from 'node:assert/strict';
import { once } from 'node:events';
import express from 'express';
import { chromium } from 'playwright';

const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const shift = days => new Date(Date.parse(today) + days * 86_400_000).toISOString().slice(0, 10);
let staff = false, order, renewalRequests = [], repeatRequests = 0;
const reset = () => {
    order = { id_pedido: 34, id_usuario: 5, usuario_nome: 'Pessoa Teste', usuario_email: 'teste@aluno.iffar.edu.br',
        status: 'Retirado', data_pedido: today, data_retirada: today, data_prevista_devolucao: shift(7),
        renovacoes: [], devolucoes: [], itens: [{ id_produto: 3, nome: 'Placa de desenvolvimento', qnt_solicitada: 4, qnt_devolvida: 0, qnt_danificada: 0 }] };
};
const app = express();
app.use(express.json());
app.get('/api/session', (_req, res) => res.json({ user: { email: order.usuario_email }, profile: { nome: order.usuario_nome, email: order.usuario_email, nivel_acesso: staff ? 1 : 0 } }));
app.get('/api/carrinho', (_req, res) => res.json({ itens: [] }));
app.get('/api/pedidos', (_req, res) => res.json({ pedidos: [order] }));
app.get('/api/gestao/pedidos', (_req, res) => res.json({ pedidos: [order] }));
app.post('/api/pedidos/34/renovacoes', (req, res) => {
    renewalRequests.push(req.body);
    order.renovacoes.push({ id_renovacao: 6, data_estendida: req.body.requestedDate, justificativa_estendimento: req.body.justification,
        data_solicitacao: today, status: 'Pendente' });
    res.json({ pedido: order });
});
app.patch('/api/gestao/pedidos/34/renovacoes/6', (req, res) => {
    const renewal = order.renovacoes[0];
    renewal.status = req.body.approved ? 'Aprovada' : 'Negada';
    renewal.motivo_recusa = req.body.reason;
    if (req.body.approved) order.data_prevista_devolucao = renewal.data_estendida;
    res.json({ pedido: order });
});
app.post('/api/pedidos/34/repetir', (_req, res) => {
    repeatRequests++;
    res.json({ addedQuantity: 2, warnings: ['<b>Kit arquivado</b>: não adicionado.'] });
});
app.use(express.static('frontend'));
const server = app.listen(0, '127.0.0.1');
await once(server, 'listening');
let browser;
try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ timezoneId: 'America/Sao_Paulo' });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const base = `http://127.0.0.1:${server.address().port}`;
    for (const width of [320, 390, 1280]) {
        reset(); staff = false;
        await page.setViewportSize({ width, height: 844 });
        await page.goto(`${base}/pages/seus-pedidos.html`);
        await page.locator('.ongoing-card').click();
        await page.getByRole('button', { name: 'Solicitar renovação', exact: true }).click();
        assert.equal(await page.locator('#renewalDate').getAttribute('max'), shift(22));
        await page.locator('#renewalDate').fill(shift(10));
        await page.getByLabel('Justificativa', { exact: true }).fill('Terminar o protótipo <b>acadêmico</b>');
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        await page.getByRole('button', { name: 'Enviar renovação', exact: true }).click();
        await page.locator('#renewalFeedback').getByText(/Renovação enviada/).waitFor();
        assert.equal(order.data_prevista_devolucao, shift(7));
        assert.deepEqual(renewalRequests.at(-1), { requestedDate: shift(10), justification: 'Terminar o protótipo <b>acadêmico</b>' });
        assert.equal(await page.locator('#studentRenewals b').count(), 0);
        assert.equal(await page.getByRole('button', { name: 'Solicitar renovação', exact: true }).count(), 0);
        await page.getByRole('button', { name: 'Pedir novamente', exact: true }).click();
        await page.locator('#modalPedido').waitFor({ state: 'hidden' });
        assert.match(await page.locator('#cartFeedback').innerText(), /2 unidade/);
        assert.match(await page.locator('#cartFeedback').innerText(), /<b>Kit arquivado<\/b>/);
        assert.equal(await page.locator('#cartFeedback b').count(), 0);

        staff = true;
        await page.goto(`${base}/pages/pedidos.html`);
        await page.getByText('Renovação aguardando análise', { exact: true }).waitFor();
        await page.getByRole('button', { name: /Pedido #34/ }).click();
        await page.getByRole('button', { name: 'Aprovar renovação', exact: true }).click();
        await page.locator('#renewalDecisionFeedback').getByText(/Renovação aprovada/).waitFor();
        assert.equal(order.data_prevista_devolucao, shift(10));
        assert.equal(await page.locator('.renewal-badge').count(), 0);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        await page.keyboard.press('Escape');

        order.renovacoes[0].status = 'Pendente';
        await page.reload();
        await page.getByRole('button', { name: /Pedido #34/ }).click();
        await page.getByLabel('Motivo da negativa').fill('Prioridade para as próximas aulas');
        await page.getByRole('button', { name: 'Negar renovação', exact: true }).click();
        await page.locator('#renewalDecisionFeedback').getByText(/Renovação negada/).waitFor();
        assert.equal(order.renovacoes[0].motivo_recusa, 'Prioridade para as próximas aulas');
        assert.equal(order.data_prevista_devolucao, shift(10));
        await page.keyboard.press('Escape');
    }
    assert.equal(repeatRequests, 3);
    assert.deepEqual(errors, []);
    console.log('OK: renovação e repetição nas telas de estudante/equipe, justificativas seguras e formulários sem transbordamento em 320/390/1280px.');
} finally {
    await browser?.close();
    server.close();
    await once(server, 'close');
}
