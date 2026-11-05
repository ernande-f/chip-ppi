import assert from 'node:assert/strict';
import { once } from 'node:events';
import express from 'express';
import { chromium } from 'playwright';

let cart;
let quantityRequests;
let profileRequests;
let failCart;
let failProfile;
const delay = callback => setTimeout(callback, 350);
const profile = { nome: 'Pessoa Teste', email: 'teste@example.invalid', nivel_acesso: 0 };
const app = express();
app.use(express.json());
app.get('/api/session', (_req, res) => res.json({ user: { email: profile.email }, profile }));
app.get('/api/profile', (_req, res) => res.json({ profile }));
app.get('/api/notificacoes', (_req, res) => res.json({ notificacoes: [], nao_lidas: 0, total: 0, totalPages: 1 }));
app.get('/api/pedidos', (_req, res) => res.json({ pedidos: [] }));
app.get('/api/carrinho', (_req, res) => res.json({ itens: cart }));
app.patch('/api/carrinho/itens/:id', (req, res) => {
    quantityRequests.push(req.body.quantity);
    const reject = failCart;
    delay(() => {
        if (reject) return res.status(409).json({ message: 'Falha temporária no carrinho. Tente novamente.' });
        cart[0].quantidade = req.body.quantity;
        res.json({});
    });
});
app.delete('/api/carrinho/itens/:id', (_req, res) => delay(() => { cart = []; res.json({}); }));
app.patch('/api/profile', (req, res) => {
    profileRequests.push(req.body);
    const reject = failProfile;
    delay(() => reject ? res.status(500).json({ message: 'Falha temporária no perfil. Tente novamente.' }) : res.json({ profile: { ...profile, nome: req.body.name } }));
});
app.get('/perfil', (_req, res) => res.send('<!doctype html><html lang="pt-br"><title>Perfil</title><h1>Perfil atualizado</h1></html>'));
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
    for (const width of [320, 390, 1280]) {
        await page.setViewportSize({ width, height: 844 });
        cart = [{ id_produto: 1, nome: 'Componente de teste', quantidade: 1, estoque_total: 5 }];
        quantityRequests = [];
        profileRequests = [];
        failCart = false;
        failProfile = true;
        await page.goto(`${base}/pages/seus-pedidos.html`);
        const plus = page.locator('[data-cart-action="plus"]');
        await plus.dblclick();
        assert.equal(await plus.isDisabled(), true, 'Carrinho bloqueia cliques enquanto salva');
        assert.equal(await page.locator('#checkoutButton').isDisabled(), true);
        assert.match(await page.locator('#cartFeedback').innerText(), /Atualizando/);
        await page.waitForFunction(() => document.querySelector('.qty-value')?.textContent === '2');
        assert.deepEqual(quantityRequests, [2], 'Duplo clique envia uma única alteração');
        assert.equal(await plus.evaluate(node => node === document.activeElement), true);
        await plus.click();
        await page.waitForFunction(() => document.querySelector('.qty-value')?.textContent === '3');
        assert.deepEqual(quantityRequests, [2, 3], 'Próximo clique usa quantidade atualizada');

        failCart = true;
        await plus.click();
        await page.locator('#cartFeedback').getByText('Falha temporária no carrinho. Tente novamente.', { exact: true }).waitFor();
        assert.equal(await page.locator('.qty-value').innerText(), '3');
        assert.equal(await plus.isDisabled(), false);
        assert.equal(await plus.evaluate(node => node === document.activeElement), true);
        failCart = false;
        await plus.click();
        await page.waitForFunction(() => document.querySelector('.qty-value')?.textContent === '4');
        await page.locator('[data-cart-action="remove"]').dblclick();
        await page.locator('#cartItems .empty-state').waitFor();
        assert.equal(await page.locator('#checkoutButton').isDisabled(), true, 'Carrinho vazio mantém checkout desabilitado');

        await page.goto(`${base}/pages/editar-perfil.html`);
        await page.waitForFunction(() => document.querySelector('#profileNameInput')?.value === 'Pessoa Teste');
        await page.locator('#profileNameInput').fill('Pessoa Nome Corrigido');
        const save = page.locator('.btn-save');
        await save.dblclick();
        assert.equal(await save.isDisabled(), true);
        assert.equal(await save.innerText(), 'Salvando…');
        assert.match(await page.locator('#profileMessage').innerText(), /Salvando/);
        await page.locator('#profileMessage').getByText('Falha temporária no perfil. Tente novamente.', { exact: true }).waitFor();
        assert.equal(profileRequests.length, 1, 'Duplo clique não duplica PATCH de perfil');
        assert.equal(await page.locator('#profileNameInput').inputValue(), 'Pessoa Nome Corrigido');
        assert.equal(await save.isDisabled(), false);
        assert.equal(await save.evaluate(node => node === document.activeElement), true);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Layout em ${width}px`);
        failProfile = false;
        await save.dblclick();
        await page.waitForURL(`${base}/perfil`);
        assert.equal(profileRequests.length, 2, 'Retry envia somente uma nova requisição');
        assert.equal(profileRequests[1].name, 'Pessoa Nome Corrigido');
    }
    assert.deepEqual(errors, []);
    console.log('OK: carrinho e perfil impedem envios duplicados, comunicam processamento, preservam foco/dados em erro e permitem retry em 320/390/1280px.');
} finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
}
