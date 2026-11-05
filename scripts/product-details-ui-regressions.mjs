import assert from 'node:assert/strict';
import { once } from 'node:events';
import express from 'express';
import { chromium } from 'playwright';

const product = { id_produto: 7, nome: 'Placa de desenvolvimento com conexões adicionais',
    descricao_produto: 'Placa para projetos de automação. '.repeat(18) + '<b>Características completas.</b>',
    estoque_total: 5, categorias: ['Componentes'], cor: 'Azul' };
assert.ok(product.nome.length <= 50);
const app = express();
let mutations = 0;
app.get('/api/session', (_req, res) => res.json({ user: { email: 'test@example.invalid' }, profile: { nome: 'Pessoa Teste', nivel_acesso: 0, recentOrders: [] } }));
app.get('/api/categorias', (_req, res) => res.json({ categorias: [] }));
app.get('/api/notificacoes', (_req, res) => res.json({ notificacoes: [], nao_lidas: 0 }));
app.get('/api/produtos', (_req, res) => res.json({ produtos: [product], hasMore: false }));
app.use('/api', (req, res) => { if (req.method !== 'GET') mutations++; res.status(404).json({ message: 'Operação inesperada.' }); });
app.use(express.static('frontend'));
const server = app.listen(0, '127.0.0.1');
await once(server, 'listening');
let browser;
try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    for (const width of [320, 390, 1280]) {
        await page.setViewportSize({ width, height: 844 });
        await page.goto(`http://127.0.0.1:${server.address().port}/pages/pagina-inicial.html`);
        const card = page.locator('#catalogGrid .item-card');
        const toggle = card.locator('.product-details-toggle');
        await toggle.waitFor();
        assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
        assert.equal(await card.locator('.desc').evaluate(node => getComputedStyle(node).webkitLineClamp), '2');
        assert.ok(await toggle.evaluate(node => node.getBoundingClientRect().height >= 44));
        await toggle.focus();
        await page.keyboard.press('Enter');
        assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
        assert.equal(await toggle.innerText(), 'Recolher detalhes');
        assert.equal(await toggle.evaluate(node => node === document.activeElement), true);
        assert.equal(await card.locator('h3').innerText(), product.nome);
        assert.equal(await card.locator('.desc').innerText(), product.descricao_produto);
        assert.equal(await card.locator('.desc b').count(), 0);
        const fullyVisible = async () => card.locator('h3, .desc').evaluateAll(nodes => nodes.every(node => {
            const rect = node.getBoundingClientRect();
            const cardRect = node.closest('.item-card').getBoundingClientRect();
            return getComputedStyle(node).webkitLineClamp === 'none' && node.scrollHeight <= node.clientHeight + 1
                && rect.left >= cardRect.left && rect.right <= cardRect.right + 1;
        }));
        assert.equal(await fullyVisible(), true, `${width}px: íntegra sem cortes`);
        const controlled = (await toggle.getAttribute('aria-controls')).split(' ');
        for (const id of controlled) assert.equal(await page.locator(`[id="${id}"]`).count(), 1);
        await page.keyboard.press('Space');
        assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
        assert.equal(await toggle.innerText(), 'Ver detalhes');
        await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
        await page.keyboard.press('Enter');
        assert.equal(await fullyVisible(), true, `${width}px: texto ampliado 200% sem cortes`);
        assert.equal(await card.locator('.add-btn').isVisible(), true);
        if (width === 390) await page.screenshot({ path: '/tmp/chip-product-details-390.png', fullPage: true });
    }
    assert.equal(mutations, 0, 'Consultar detalhes não altera o carrinho');
    assert.deepEqual(errors, []);
    console.log('OK: detalhes completos no cartão, teclado/aria-expanded/controls, texto seguro e ampliação 200% em 320/390/1280px.');
} finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
}
