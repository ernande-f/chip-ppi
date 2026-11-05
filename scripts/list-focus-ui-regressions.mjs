import assert from 'node:assert/strict';
import { once } from 'node:events';
import express from 'express';
import { chromium } from 'playwright';

let cart = [];
let notifications = [];
const products = () => [1, 2, 3].map(id => ({ id_produto: id, nome: `Componente ${id}`, quantidade: 1, estoque_total: 3 }));
const notices = () => [1, 2, 3].map(id => ({ id_notificacao: id, mensagem: `Pedido ${id} atualizado.`, href: '/pedidos', criada_em: '2026-11-05T12:00:00Z', lida_em: null }));
const app = express();
app.use(express.json());
app.get('/api/session', (_req, res) => res.json({ user: { email: 'teste@example.invalid' }, profile: { nome: 'Teste de Foco', nivel_acesso: 0 } }));
app.get('/api/pedidos', (_req, res) => res.json({ pedidos: [] }));
app.get('/api/carrinho', (_req, res) => setTimeout(() => res.json({ itens: cart }), 40));
app.patch('/api/carrinho/itens/:id', (req, res) => {
    cart.find(item => item.id_produto === Number(req.params.id)).quantidade = req.body.quantity;
    setTimeout(() => res.json({}), 40);
});
app.delete('/api/carrinho/itens/:id', (req, res) => {
    cart = cart.filter(item => item.id_produto !== Number(req.params.id));
    setTimeout(() => res.json({}), 40);
});
app.get('/api/notificacoes', (req, res) => {
    const unread = notifications.filter(item => !item.lida_em);
    const items = req.query.unreadOnly === 'true' ? unread : notifications;
    setTimeout(() => res.json({ notificacoes: items, nao_lidas: unread.length, total: items.length, totalPages: 1 }), 40);
});
app.patch('/api/notificacoes/:id/lida', (req, res) => {
    notifications.find(item => item.id_notificacao === Number(req.params.id)).lida_em = '2026-11-05T13:00:00Z';
    setTimeout(() => res.json({}), 40);
});
app.patch('/api/notificacoes/lidas', (_req, res) => {
    notifications.forEach(item => { item.lida_em = '2026-11-05T13:00:00Z'; });
    setTimeout(() => res.json({}), 40);
});
app.use(express.static('frontend'));
const server = app.listen(0, '127.0.0.1');
await once(server, 'listening');
const base = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const waitFocus = selector => page.waitForFunction(selector => document.activeElement?.matches(selector), selector);
    for (const width of [320, 390, 1280]) {
        await page.setViewportSize({ width, height: 844 });
        cart = products();
        await page.goto(`${base}/pages/seus-pedidos.html`);
        await page.locator('#cartItems [data-product-id="3"]').waitFor();
        assert.equal(await page.evaluate(() => document.activeElement.tagName), 'BODY', 'Carregamento inicial não deve roubar o foco');
        const plus = '#cartItems [data-product-id="1"] [data-cart-action="plus"]';
        await page.locator(plus).focus();
        await page.keyboard.press('Enter');
        await page.waitForFunction(() => document.querySelector('[data-product-id="1"] .qty-value')?.textContent === '2');
        await waitFocus(plus);
        await page.keyboard.press('Enter');
        await page.waitForFunction(() => document.querySelector('[data-product-id="1"] .qty-value')?.textContent === '3');
        await waitFocus('[data-product-id="1"] [data-cart-action="minus"]');

        await page.locator('[data-product-id="1"] [data-cart-action="remove"]').focus();
        await page.keyboard.press('Enter');
        await waitFocus('[data-product-id="2"] [data-cart-action="remove"]');
        await page.locator('[data-product-id="3"] [data-cart-action="remove"]').focus();
        await page.keyboard.press('Enter');
        await waitFocus('[data-product-id="2"] [data-cart-action="remove"]');
        await page.keyboard.press('Enter');
        await waitFocus('#cartItems .empty-state');

        cart = products();
        await page.reload();
        await page.locator(plus).focus();
        await page.keyboard.press('Enter');
        await page.locator('#orderJustification').focus();
        await page.waitForFunction(() => document.querySelector('[data-product-id="1"] .qty-value')?.textContent === '2');
        await waitFocus('#orderJustification');

        notifications = notices();
        await page.goto(`${base}/pages/notificacoes.html`);
        await page.locator('[data-notification-id="3"]').waitFor();
        assert.equal(await page.evaluate(() => document.activeElement.tagName), 'BODY');
        await page.locator('#unreadOnly').focus();
        await page.keyboard.press('Space');
        await page.waitForFunction(() => document.querySelector('#unreadOnly')?.disabled === false);
        await waitFocus('#unreadOnly');
        await page.locator('[data-notification-id="1"] button').focus();
        await page.keyboard.press('Enter');
        await waitFocus('[data-notification-id="2"] button');
        await page.locator('[data-notification-id="3"] button').focus();
        await page.keyboard.press('Enter');
        await waitFocus('[data-notification-id="2"] button');
        await page.keyboard.press('Enter');
        await waitFocus('#notificationStatus');
        assert.equal(await page.locator('#notificationsList article').count(), 0);

        notifications = notices();
        await page.reload();
        await page.locator('[data-notification-id="1"] button').focus();
        await page.keyboard.press('Enter');
        await waitFocus('[data-notification-id="1"] a');
        await page.locator('#readAll').focus();
        await page.keyboard.press('Enter');
        await page.waitForFunction(() => document.querySelectorAll('#notificationsList button').length === 0);
        await waitFocus('#notificationStatus');
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Transbordamento em ${width}px`);
    }
    assert.deepEqual(errors, []);
    console.log('OK: carrinho e notificações preservam foco, escolhem vizinho/resumo e não roubam foco inicial ou movido durante a resposta em 320/390/1280px.');
} finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
}
