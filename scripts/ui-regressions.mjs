import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { once } from 'node:events';
import express from 'express';
import { chromium } from 'playwright';

const profile = { nome: 'Estudante com nome extenso para validar o layout', email: 'estudante.nome.extenso@aluno.iffar.edu.br', nivel_acesso: 0, recentOrders: [
    { id_pedido: 1, status: 'Devolvido', data_pedido: '2026-10-20', data_devolucao: '2026-10-22' },
    { id_pedido: 2, status: 'Retirado', data_pedido: '2026-10-20', data_retirada: '2026-10-21' },
    { id_pedido: 3, status: 'Pendente', data_pedido: '2026-10-20' }
] };
const item = { id_produto: 1, nome: 'Placa de desenvolvimento para projetos acadêmicos', cor: 'Azul', quantidade: 1, estoque_total: 2, qnt_solicitada: 3, qnt_devolvida: 2, qnt_danificada: 1 };
const order = { id_pedido: 12, status: 'Retirado', data_pedido: '2026-10-20', data_retirada: '2026-10-21', data_prevista_devolucao: '2026-10-28', itens: [item], devolucoes: [{ data: '2026-10-22', observacao: '<b>Conector danificado</b>', itens: [{ id_produto: '1', quantidade: 2, danificada: 1 }] }] };
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
let managedOrders = ['Pendente', 'Aprovado', 'Em separação', 'Pronto para retirada', 'Retirado'].map((status, index) => ({
    id_pedido: 501 + index, status, data_pedido: '2020-01-01', usuario_nome: `Pessoa ${index + 1}`, usuario_email: `pessoa${index + 1}@aluno.iffar.edu.br`,
    data_retirada: status === 'Retirado' ? today : null, data_prevista_devolucao: today,
    itens: [{ id_produto: 8, nome: 'Arduino', cor: 'Azul', qnt_solicitada: 5, qnt_devolvida: status === 'Retirado' ? 1 : 0, qnt_danificada: status === 'Retirado' ? 1 : 0 }], devolucoes: []
}));
managedOrders.push(...Array.from({ length: 28 }, (_, index) => ({
    id_pedido: 100 + index, status: ['Devolvido', 'Negado', 'Cancelado', 'Expirado'][index % 4], data_pedido: index < 8 ? today : '2020-01-01',
    usuario_nome: index === 27 ? 'Carlos Antigo' : `Histórico ${index}`, usuario_email: `historico${index}@aluno.iffar.edu.br`, itens: []
})));
const returnRequests = [];
const app = express();
app.use(express.json());
app.get('/api/session', (_req, res) => res.json({ user: { email: profile.email }, profile }));
app.get('/api/profile', (_req, res) => res.json({ profile }));
app.get('/api/carrinho', (_req, res) => res.json({ itens: [item] }));
app.get('/api/pedidos', (_req, res) => res.json({ pedidos: [order] }));
app.get('/api/gestao/pedidos', (_req, res) => res.json({ pedidos: managedOrders }));
app.patch('/api/gestao/pedidos/505', (req, res) => {
    returnRequests.push(req.body);
    const order = managedOrders.find(order => order.id_pedido === 505);
    const input = req.body.returnItems[0];
    const item = order.itens[0];
    if (input.expectedReturned !== item.qnt_devolvida) return res.status(409).json({ message: 'O recebimento foi alterado. Atualize a página.' });
    item.qnt_devolvida += input.quantity;
    item.qnt_danificada += input.damagedQuantity;
    order.devolucoes.push({ data: today, observacao: req.body.returnNotes, itens: [{ id_produto: '8', quantidade: input.quantity, danificada: input.damagedQuantity }] });
    if (item.qnt_devolvida === item.qnt_solicitada) {
        order.status = 'Devolvido';
        order.data_devolucao = today;
        managedOrders = [...managedOrders.filter(order => order.id_pedido !== 505), order];
    }
    res.json({ pedido: order });
});
app.use(express.static('frontend'));
const server = app.listen(0, '127.0.0.1');
await once(server, 'listening');
let browser;

try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ timezoneId: 'America/Sao_Paulo' });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const base = `http://127.0.0.1:${server.address().port}`;
    const publicTerms = await readFile('frontend/pages/termo_responsabilidade.html', 'utf8');
    const cart = await readFile('frontend/pages/seus-pedidos.html', 'utf8');
    const paragraphs = (source) => [...source.matchAll(/<p class="term-text">([\s\S]*?)<\/p>/g)].map((match) => match[1].replace(/\s+/g, ' ').trim());
    assert.equal(paragraphs(publicTerms).length, 7);
    assert.deepEqual(paragraphs(publicTerms), paragraphs(cart));
    assert.match(publicTerms, /data-terms-version="3"/);
    assert.match(cart, /data-terms-version="3"/);

    for (const width of [320, 390, 1280]) {
        await page.setViewportSize({ width, height: 800 });
        for (const file of ['termo_responsabilidade', 'perfil', 'editar-perfil', 'seus-pedidos']) {
            await page.goto(`${base}/pages/${file}.html`);
            await page.getByRole('link', { name: 'Explorar catálogo' }).waitFor();
            assert.equal(await page.locator('.icon-notification').count(), 0);
            if (file === 'perfil') {
                await page.locator('#ordersPreview').getByText('Devolvido em: 22/10/2026', { exact: true }).waitFor();
                assert.match(await page.locator('#ordersPreview').innerText(), /Retirado em: 21\/10\/2026/);
                assert.match(await page.locator('#ordersPreview').innerText(), /Retirada ainda não realizada/);
            }
            const overflow = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth ? [] : [...document.querySelectorAll('body *')].filter((node) => node.getBoundingClientRect().right > innerWidth + 1).map((node) => `${node.tagName}.${node.className}`));
            assert.deepEqual(overflow, [], `${file} transborda em ${width}px`);
        }
        await page.locator('.ongoing-status').filter({ hasText: 'Retirado' }).waitFor();
        await page.getByRole('link', { name: 'termo de responsabilidade', exact: true }).click();
        assert.equal(await page.locator('#closeTermsModal').evaluate((node) => node === document.activeElement), true);
        await page.keyboard.press('Shift+Tab');
        assert.equal(await page.locator('#btnCloseTermsModal').evaluate((node) => node === document.activeElement), true);
        await page.keyboard.press('Tab');
        assert.equal(await page.locator('#closeTermsModal').evaluate((node) => node === document.activeElement), true);
        assert.ok(await page.locator('.modal-terms-content').evaluate((node) => { const r = node.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight; }));
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('#openTermsModal').evaluate((node) => node === document.activeElement), true);
        await page.locator('#openTermsModal').click();
        await page.locator('#btnAcceptTermsModal').click();
        assert.equal(await page.locator('#acceptTerms').isChecked(), true);
        assert.equal(await page.evaluate(() => document.body.style.overflow), '');
        await page.locator('.ongoing-card').click();
        assert.match(await page.locator('#modalOrderItems').innerText(), /Recebidas: 2 · Danificadas: 1 · Pendentes: 1/);
        assert.match(await page.locator('#studentOrderReturns').innerText(), /<b>Conector danificado<\/b>/);
        assert.match(await page.locator('#studentOrderReturns').innerText(), /Placa de desenvolvimento para projetos acadêmicos: 2 recebida/);
        assert.equal(await page.locator('#studentOrderReturns b').count(), 0);
        assert.ok(await page.locator('#modalPedido .modal-content').evaluate((node) => { const r = node.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight; }));
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('.ongoing-card').evaluate((node) => node === document.activeElement), true);
    }

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`${base}/pages/pedidos.html`);
    await page.getByRole('button', { name: /Pedido #505, Retirado/ }).waitFor();
    assert.equal(await page.locator('.kanban-column').count(), 5);
    assert.equal(await page.locator('#ordersGrid .order-card').count(), 5);
    assert.equal(await page.locator('#ordersHistory').evaluate(node => node.open), false);
    assert.equal(await page.locator('#historyGrid .order-card').count(), 12);
    assert.equal(await page.locator('.sino-img').count(), 0);
    await page.locator('#ordersHistory summary').focus();
    await page.keyboard.press('Enter');
    await page.locator('#historyMore').click();
    assert.equal(await page.locator('#historyGrid .order-card').count(), 24);
    await page.locator('#historyMore').click();
    assert.equal(await page.locator('#historyGrid .order-card').count(), 28);
    assert.equal(await page.locator('#historyMore').isVisible(), false);
    await page.locator('#historyStatus').selectOption('Expirado');
    assert.equal(await page.locator('#historyGrid .order-card').count(), 7);
    await page.locator('#historyPeriod').selectOption('1');
    assert.equal(await page.locator('#historyGrid .order-card').count(), 2);
    assert.equal(await page.locator('#ordersGrid .order-card').count(), 5, 'Filtros do histórico devem preservar todos os pedidos ativos');
    await page.locator('#historyStatus').selectOption('all');
    await page.locator('#historyPeriod').selectOption('all');
    await page.locator('#ordersHistory summary').click();
    await page.getByRole('searchbox').fill('Carlos');
    await page.getByRole('button', { name: /Pedido #127, Expirado/ }).waitFor();
    assert.equal(await page.locator('#ordersHistory').evaluate(node => node.open), true);
    assert.equal(await page.locator('#ordersGrid .order-card').count(), 0);
    await page.getByRole('searchbox').fill('');

    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: /Pedido #505, Retirado/ }).focus();
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: 'Registrar devolução', exact: true }).click();
    const quantity = page.getByRole('spinbutton', { name: 'Recebidas agora: Arduino', exact: true });
    const damaged = page.getByRole('spinbutton', { name: 'Danificadas dentre as recebidas: Arduino', exact: true });
    const confirmReturn = page.getByRole('button', { name: 'Confirmar devolução', exact: true });
    assert.equal(await confirmReturn.isDisabled(), true);
    await quantity.fill('2');
    await damaged.fill('3');
    assert.equal(await confirmReturn.isDisabled(), true);
    await quantity.fill('5');
    await damaged.fill('1');
    assert.equal(await confirmReturn.isDisabled(), true);
    await quantity.fill('1.5');
    assert.equal(await confirmReturn.isDisabled(), true);
    await quantity.fill('-1');
    assert.equal(await confirmReturn.isDisabled(), true);
    await quantity.fill('2');
    assert.equal(await confirmReturn.isDisabled(), false);
    assert.equal(returnRequests.length, 0, 'Abrir ou preencher o formulário não deve registrar recebimentos');
    await page.locator('#returnNotes').fill('<b data-injected="yes">Carcaça quebrada</b>');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.equal(await page.evaluate(() => document.body.style.overflow), 'hidden');
    const scrollBefore = await page.evaluate(() => scrollY);
    await page.mouse.move(2, 400);
    await page.mouse.wheel(0, 500);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await page.evaluate(() => scrollY), scrollBefore, 'O fundo deve permanecer parado enquanto o modal está aberto');
    await confirmReturn.focus();
    assert.ok(await confirmReturn.evaluate(node => { const box = node.getBoundingClientRect(); return box.top >= 0 && box.bottom <= innerHeight; }));
    await page.locator('#modalClose').focus();
    assert.ok(await page.locator('#modalClose').evaluate(node => { const box = node.getBoundingClientRect(); return box.top >= 0 && box.bottom <= innerHeight; }));
    await page.keyboard.press('Shift+Tab');
    assert.equal(await confirmReturn.evaluate(node => node === document.activeElement), true);
    await page.keyboard.press('Tab');
    assert.equal(await page.locator('#modalClose').evaluate(node => node === document.activeElement), true);
    await confirmReturn.click();
    await page.locator('#orderModal').waitFor({ state: 'hidden' });
    assert.deepEqual(returnRequests[0], { action: 'register_return', reason: null, returnItems: [{ productId: 8, expectedReturned: 1, quantity: 2, damagedQuantity: 1 }], returnNotes: '<b data-injected="yes">Carcaça quebrada</b>' });
    assert.equal(await page.evaluate(() => document.body.style.overflow), '');
    await page.getByRole('button', { name: /Pedido #505, Retirado/ }).click();
    assert.match(await page.locator('#modalItems').innerText(), /Recebidos: 3 · Danificados: 2 · Faltam: 2/);
    assert.match(await page.locator('#returnLog').innerText(), /Arduino: 2 recebida/);
    assert.equal(await page.locator('#returnLog [data-injected]').count(), 0);
    assert.match(await page.locator('#returnLog').innerText(), /Carcaça quebrada/);
    await page.getByRole('button', { name: 'Registrar devolução', exact: true }).click();
    await quantity.fill('2');
    await confirmReturn.click();
    await page.getByRole('button', { name: /Pedido #505, Devolvido/ }).waitFor();
    assert.equal(returnRequests[1].returnItems[0].expectedReturned, 3);
    assert.equal(await page.locator('#ordersHistory').evaluate(node => node.open), true);
    assert.equal(await page.locator('#historyGrid .order-card').count(), 29, 'Pedido concluído deve continuar visível mesmo após a primeira página');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.getByRole('button', { name: /Pedido #505, Devolvido/ }).click();
    assert.match(await page.locator('#modalSubtitle').innerText(), /Devolvido em:/);
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => document.body.style.overflow), '');
    assert.deepEqual(errors, []);
    console.log('OK: termo consistente, navegação útil, telas responsivas, modais por teclado, Kanban com histórico/filtros/busca/Ver mais e devoluções parciais com danos.');
} finally {
    await browser?.close();
    server.close();
    await once(server, 'close');
}
