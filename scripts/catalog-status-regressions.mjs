import assert from 'node:assert/strict';
import { once } from 'node:events';
import express from 'express';
import { chromium } from 'playwright';

// A situação inválida é rejeitada antes de abrir uma conexão com o banco.
process.env.DATABASE_URL = 'postgresql://test:test@127.0.0.1:1/test';
const { listProducts, ProductValidationError } = await import('../backend/services/productService.js');
await assert.rejects(listProducts({ status: 'Inexistente' }), ProductValidationError);

const products = [
    ...Array.from({ length: 20 }, (_, i) => ({ id_produto: i + 1, nome: `Disponível ${i + 1}`, estoque_total: 5, status_produto: 'Disponível' })),
    ...Array.from({ length: 25 }, (_, i) => ({ id_produto: i + 21, nome: `Arquivado ${i === 24 ? 'Especial' : i + 1}`, estoque_total: 0, status_produto: 'Arquivado' })),
    ...Array.from({ length: 23 }, (_, i) => ({ id_produto: i + 46, nome: `Indisponível ${i + 1}`, estoque_total: 0, status_produto: 'Indisponível' }))
].map(product => ({ ...product, categorias: ['Componentes'], descricao_produto: 'Item para verificar filtros entre páginas.' }));
const queries = [];
const app = express();
app.get('/api/session', (_req, res) => res.json({ user: { email: 'admin@example.invalid' }, profile: { nome: 'Equipe CHIP', nivel_acesso: 2 } }));
app.get('/api/categorias', (_req, res) => res.json({ categorias: [] }));
app.get('/api/notificacoes', (_req, res) => res.json({ notificacoes: [], nao_lidas: 0 }));
app.get('/api/produtos', (req, res) => {
    queries.push({ ...req.query });
    const matches = products.filter(product => (!req.query.status || product.status_produto === req.query.status)
        && (!req.query.search || product.nome.toLocaleLowerCase('pt-BR').includes(String(req.query.search).toLocaleLowerCase('pt-BR'))));
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 20;
    res.json({ produtos: matches.slice((page - 1) * limit, page * limit), total: matches.length, page, limit, hasMore: page * limit < matches.length });
});
app.use(express.static('frontend'));
const server = app.listen(0, '127.0.0.1');
await once(server, 'listening');
let browser;
try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/pages/index-tec.html`);
    await page.locator('#itemsGrid .item-card').first().waitFor();
    const cards = page.locator('#itemsGrid .item-card');
    assert.equal(await cards.count(), 20);

    for (const [status, total] of [['Arquivado', 25], ['Indisponível', 23]]) {
        const response = page.waitForResponse(response => {
            const url = new URL(response.url());
            return url.pathname === '/api/produtos' && url.searchParams.get('status') === status && url.searchParams.get('page') === '1';
        });
        await page.locator('#managementStatus').selectOption(status);
        await response;
        await page.waitForFunction(expected => document.querySelector('#itemsGrid .status-badge')?.textContent === expected && document.querySelectorAll('#itemsGrid .item-card').length >= 20, status);
        assert.match(await cards.first().innerText(), new RegExp(status));
        await page.evaluate(() => document.querySelector('#itemsSentinel')?.scrollIntoView());
        await page.waitForFunction(expected => document.querySelectorAll('#itemsGrid .item-card').length === expected, total);
        assert.equal(await cards.count(), total);
        assert.equal(await page.locator('#itemsSentinel').count(), 0);
        assert.equal(new Set(await cards.locator('h3').allTextContents()).size, total);
        assert.ok(queries.some(query => query.status === status && query.page === '2'));
    }

    await page.locator('#managementStatus').selectOption('Arquivado');
    await page.waitForFunction(() => document.querySelector('#itemsGrid .status-badge')?.textContent === 'Arquivado');
    await page.locator('#managementSearch').fill('Especial');
    await page.getByRole('heading', { name: 'Arquivado Especial', exact: true }).waitFor();
    await page.waitForFunction(() => document.querySelectorAll('#itemsGrid .item-card').length === 1);
    assert.equal(await cards.count(), 1);
    assert.ok(queries.some(query => query.status === 'Arquivado' && query.search === 'Especial' && query.page === '1'));
    await page.locator('#managementSearch').fill('não existe');
    await page.getByText('Nenhum item encontrado.', { exact: true }).waitFor();
    assert.equal(await cards.count(), 0);
    assert.deepEqual(errors, []);
    console.log('OK: filtros por situação reiniciam a consulta, preservam busca e percorrem todas as páginas, sem falso vazio ou duplicação.');
} finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
}
