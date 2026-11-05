import assert from 'node:assert/strict';
import { once } from 'node:events';
import express from 'express';
import { chromium } from 'playwright';

process.env.DATABASE_URL = 'postgresql://test:test@127.0.0.1:1/test';
const { isNotificationHref } = await import('../backend/services/notificationService.js');
for (const href of ['/pedidos', '/pedidos.html', '/perfil', '/usuarios.html', '/pedidos?id_pedido=12', '/pedidos.html?id_pedido=17', '/usuarios.html?id_usuario=22']) {
    assert.equal(isNotificationHref(href), true, href);
}
for (const href of ['https://evil.invalid/pedidos', '//evil.invalid/pedidos', 'javascript:alert(1)', '/pedidos?id_pedido=0', '/pedidos?id_pedido=-1', '/pedidos?id_pedido=1&next=https://evil.invalid', '/pedidos?id_usuario=1', '/usuarios.html?id_usuario=9007199254740992', '/perfil?id_usuario=1', null]) {
    assert.equal(isNotificationHref(href), false, String(href));
}

let staff = false;
const profile = () => ({ id_usuario: '1', nome: 'Pessoa Teste', email: 'teste@aluno.iffar.edu.br', nivel_acesso: staff ? 2 : 0 });
const orders = [12, 17].map(id => ({ id_pedido: id, id_usuario: 1, usuario_nome: 'Pessoa Teste', usuario_email: 'teste@aluno.iffar.edu.br',
    status: id === 12 ? 'Retirado' : 'Expirado', data_pedido: '2026-10-20', data_retirada: id === 12 ? '2026-10-22' : null,
    data_prevista_devolucao: '2026-11-10', itens: [], renovacoes: [], devolucoes: [] }));
const hrefs = ['/pedidos?id_pedido=12', '/pedidos.html?id_pedido=17', '/usuarios.html?id_usuario=22', 'https://evil.invalid/pedidos'];
const detailRequests = [];
const app = express();
app.use((req, _res, next) => { req.profile = profile(); req._authVerified = true; next(); });
app.get('/api/session', (_req, res) => res.json({ user: { email: profile().email }, profile: profile() }));
app.get('/api/carrinho', (_req, res) => res.json({ itens: [] }));
app.get('/api/pedidos', (_req, res) => res.json({ pedidos: orders }));
app.get('/api/gestao/pedidos', (_req, res) => res.json({ pedidos: orders }));
app.get('/api/notificacoes', (_req, res) => res.json({ notificacoes: hrefs.map((href, index) => ({ id_notificacao: index + 1,
    mensagem: `Atualização ${index + 1}`, href, criada_em: '2026-11-01T12:00:00Z', lida_em: '2026-11-01T12:00:00Z' })), total: 4, nao_lidas: 0, totalPages: 1 }));
app.get('/api/notificacoes/envios', (_req, res) => res.json({ habilitado: false, fila: [] }));
app.get('/api/gestao/usuarios', (_req, res) => res.json({ usuarios: [], total: 0, totalPages: 0 }));
app.get('/api/gestao/usuarios/:id/pedidos', (req, res) => {
    detailRequests.push(req.params.id);
    res.json({ usuario: { id_usuario: req.params.id, nome: 'Conta vinculada', email: 'conta@example.invalid', nivel_acesso: 0, status_conta: true }, pedidos: [] });
});
app.use(express.static('frontend'));
app.use((await import('../backend/routes/pages.js')).default);
const server = app.listen(0, '127.0.0.1');
await once(server, 'listening');
const base = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    for (const width of [320, 390, 1280]) {
        await page.setViewportSize({ width, height: 844 });
        staff = false;
        await page.goto(`${base}/notificacoes.html`);
        await page.locator('.notification-card').last().waitFor();
        assert.deepEqual(await page.locator('.notification-controls a').evaluateAll(nodes => nodes.map(node => node.getAttribute('href'))), [...hrefs.slice(0, 3), '/pedidos']);
        await page.locator('.notification-controls a').first().click();
        await page.waitForURL('**/pages/seus-pedidos.html?id_pedido=12');
        await page.locator('#modalPedido').waitFor({ state: 'visible' });
        assert.match(await page.locator('#modalPedido').innerText(), /Pedido #12/);
        await page.keyboard.press('Escape');
        await page.goto(`${base}/pedidos?id_pedido=999`);
        await page.getByText('O pedido desta notificação não está disponível para sua conta.', { exact: true }).waitFor();
        assert.equal(await page.locator('#modalPedido').isVisible(), false);
        staff = true;
        await page.goto(`${base}/pedidos?id_pedido=17`);
        await page.waitForURL('**/pedidos.html?id_pedido=17');
        await page.locator('#orderModal').waitFor({ state: 'visible' });
        assert.equal(await page.locator('#modalTitle').innerText(), 'Pedido #17');
        await page.keyboard.press('Escape');
        await page.goto(`${base}/usuarios.html?id_usuario=22`);
        await page.locator('#userDetailTitle').getByText('Conta vinculada', { exact: true }).waitFor();
        assert.equal(detailRequests.at(-1), '22', 'Conta pode estar fora da primeira página da lista');
        assert.equal(await page.locator('#userDetailTitle').evaluate(node => node === document.activeElement), true);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    }
    assert.deepEqual(errors, []);
    console.log('OK: destinos internos validados, redirects preservam pedido, detalhes aluno/técnico/usuário em 320/390/1280px e pedido alheio ausente não é aberto.');
} finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
}
