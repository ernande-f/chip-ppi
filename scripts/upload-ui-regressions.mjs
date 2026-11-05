import assert from 'node:assert/strict';
import { once } from 'node:events';
import express from 'express';
import { chromium } from 'playwright';

const image = { name: 'componente.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jL1sAAAAASUVORK5CYII=', 'base64') };
const product = { id_produto: 1, nome: 'Arduino', descricao_produto: 'Placa para projetos', estoque_total: 5, categorias: ['Componentes'], status_produto: 'Disponível', cor: 'Azul' };
const writes = [];
const app = express();
app.use(express.json({ limit: '4mb' }));
app.get('/api/session', (_req, res) => res.json({ user: { email: 'admin@example.test' }, profile: { nome: 'Equipe CHIP', nivel_acesso: 2 } }));
app.get('/api/notificacoes', (_req, res) => res.json({ notificacoes: [], nao_lidas: 0 }));
app.get('/api/categorias', (_req, res) => res.json({ categorias: [{ nome_categoria: 'Componentes' }] }));
app.get('/api/produtos', (_req, res) => res.json({ produtos: [product], hasMore: false, isCatalogManager: true }));
app.get('/api/produtos/1', (_req, res) => res.json({ produto: product }));
app.post('/api/produtos', (req, res) => { writes.push(req.body); res.json({ produto: product }); });
app.patch('/api/produtos/1', (req, res) => { writes.push(req.body); res.json({ produto: product }); });
app.get('/', (_req, res) => res.send('<!doctype html><title>Cadastro concluído</title>'));
app.use(express.static('frontend'));
const server = app.listen(0, '127.0.0.1');
await once(server, 'listening');
const base = `http://127.0.0.1:${server.address().port}`;
let browser;

async function choosePhotoWithKeyboard(page, id) {
    assert.equal(await page.locator(`#${id}`).evaluate(node => node === document.activeElement), true, 'Tab deve alcançar o seletor nativo de foto');
    assert.ok(await page.locator(`#${id}`).evaluate(node => {
        const rect = node.getBoundingClientRect();
        return rect.width > 0 && rect.height >= 44 && getComputedStyle(node).outlineStyle !== 'none';
    }), 'Seletor deve estar visível, com foco e alvo de toque adequado');
    const chooser = page.waitForEvent('filechooser');
    await page.keyboard.press('Enter');
    await (await chooser).setFiles(image);
}

try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const errors = [];
    const alerts = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', dialog => { alerts.push(dialog.message()); void dialog.dismiss(); });

    for (const width of [320, 390, 1280]) {
        await page.setViewportSize({ width, height: 844 });
        await page.goto(`${base}/pages/cadastro-item.html`);
        await page.locator('.chip-header-ready').waitFor();
        await page.locator('#nome').fill('Arduino');
        await page.locator('#descricao').fill('Placa para projetos');
        await page.locator('#estoque').fill('5');
        await page.locator('#categoria-input').fill('Componentes');
        await page.keyboard.press('Enter');
        assert.equal(await page.locator('#btn-salvar').isDisabled(), true, 'Foto continua obrigatória');
        await page.locator('#cor').focus();
        await page.keyboard.press('Tab');
        await choosePhotoWithKeyboard(page, 'foto');
        await page.waitForFunction(() => !document.getElementById('btn-salvar').disabled);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Cadastro deve caber em ${width}px`);

        if (width === 320) {
            await page.locator('#foto').setInputFiles({ name: 'grande.png', mimeType: 'image/png', buffer: Buffer.alloc(2 * 1024 * 1024 + 1) });
            await page.waitForFunction(() => document.getElementById('foto').files.length === 0);
            assert.equal(await page.locator('#btn-salvar').isDisabled(), true);
            assert.match(alerts.at(-1), /máximo 2 MB/);
            await page.locator('#cor').focus();
            await page.keyboard.press('Tab');
            await choosePhotoWithKeyboard(page, 'foto');
            await page.waitForFunction(() => !document.getElementById('btn-salvar').disabled);
        }

        await page.locator('#btn-salvar').focus();
        const create = page.waitForResponse(response => response.url().endsWith('/api/produtos') && response.request().method() === 'POST');
        await page.keyboard.press('Enter');
        await create;
        await page.waitForURL(`${base}/`);
        assert.match(writes.at(-1).foto_produto, /^data:image\/png;base64,/);

        await page.goto(`${base}/pages/index-tec.html`);
        await page.locator('.btn-edit-item').first().click();
        await page.locator('#modalAlterar').waitFor({ state: 'visible' });
        await page.locator('#editColor').focus();
        await page.keyboard.press('Tab');
        await choosePhotoWithKeyboard(page, 'fileInput');
        await page.waitForFunction(() => document.getElementById('itemImagePreview').src.startsWith('data:image/png;base64,'));
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Editor deve caber em ${width}px`);
        const update = page.waitForResponse(response => response.url().endsWith('/api/produtos/1') && response.request().method() === 'PATCH');
        await page.locator('.btn-concluir').focus();
        await page.keyboard.press('Enter');
        await update;
        assert.match(writes.at(-1).foto_produto, /^data:image\/png;base64,/);
    }
    assert.deepEqual(errors, []);
    assert.equal(writes.length, 6);
    console.log('OK: foto por Tab/Enter, foco visível, cadastro obrigatório, limite de 2 MB e persistência no cadastro/editor em 320/390/1280px.');
} finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
}
