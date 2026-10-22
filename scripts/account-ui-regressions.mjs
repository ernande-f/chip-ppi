import assert from 'node:assert/strict';
import { once } from 'node:events';
import express from 'express';
import { chromium } from 'playwright';

let level = 2;
const user = { id_usuario: '2', nome: 'Pessoa com nome extenso <img src=x onerror=alert(1)>', email: 'pessoa.com.email.extenso@aluno.iffar.edu.br', nivel_acesso: 0,
    status_conta: true, motivo_bloqueio: null, bloqueio_automatico_ativo: true, bloqueio_automatico_ate: '2026-10-25' };
const patches = [];
const app = express();
app.use(express.json());
app.get('/api/session', (_req, res) => res.json({ user: { email: 'admin@example.test' }, profile: { id_usuario: '1', nome: 'Equipe CHIP', nivel_acesso: level } }));
app.get('/api/notificacoes', (_req, res) => res.json({ notificacoes: [], nao_lidas: 0 }));
app.get('/api/gestao/usuarios', (_req, res) => res.json({ usuarios: [user], page: 1, totalPages: 2, total: 21 }));
app.get('/api/gestao/usuarios/2/pedidos', (_req, res) => res.json({ usuario: user, pedidos: [
    { id_pedido: 12, status: 'Retirado', data_pedido: '2026-10-20', data_retirada: '2026-10-21', data_prevista_devolucao: '2026-10-23', itens: [
        { nome: '<b>Arduino</b>', qnt_solicitada: 3, qnt_devolvida: 1, qnt_danificada: 1 }
    ] }
] }));
app.patch('/api/gestao/usuarios/2', (req, res) => {
    patches.push(req.body);
    user.nome = req.body.name;
    user.nivel_acesso = req.body.accessLevel;
    user.status_conta = req.body.active;
    if (req.body.clearAutomaticPenalty) user.bloqueio_automatico_ativo = false;
    res.json({ usuario: user, message: 'Usuário atualizado.' });
});
app.use(express.static('frontend'));
const server = app.listen(0, '127.0.0.1');
await once(server, 'listening');
let browser;
try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const base = `http://127.0.0.1:${server.address().port}`;
    for (const width of [320, 390, 1280]) {
        await page.setViewportSize({ width, height: 800 });
        await page.goto(`${base}/pages/usuarios.html`);
        await page.getByRole('button', { name: /^Ver conta e pedidos de/ }).click();
        await page.locator('#userHistorySummary').getByText('1 pedido(s).', { exact: false }).waitFor();
        assert.equal(await page.locator('#userDetailTitle').evaluate(node => node === document.activeElement), true);
        assert.equal(await page.locator('#userDetail img').count(), 0, 'HTML da API é tratado como texto');
        await page.locator('.management-order summary').click();
        assert.match(await page.locator('#userHistory').innerText(), /<b>Arduino<\/b>: 3 solicitada\(s\), 1 recebida\(s\), 1 danificada\(s\)/);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Gestão transborda em ${width}px`);
        await page.locator('#editUserName').fill('Nome Corrigido');
        await page.locator('#editUserRole').selectOption('1');
        await page.getByRole('button', { name: 'Salvar alterações' }).click();
        assert.match(await page.locator('#editUserMessage').innerText(), /Informe um motivo/);
        assert.equal(await page.locator('#editUserReason').evaluate(node => node === document.activeElement), true);
        await page.locator('#editUserReason').fill('Alteração de equipe');
        await page.getByRole('button', { name: 'Salvar alterações' }).click();
        await page.locator('#editUserMessage').getByText('Usuário atualizado.', { exact: true }).waitFor();
        assert.equal(patches.at(-1).accessLevel, 1);
        user.nivel_acesso = 0;
    }
    await page.getByRole('button', { name: 'Encerrar bloqueio por atraso' }).click();
    await page.locator('#editUserReason').fill('Penalidade revisada pela administração');
    await page.getByRole('button', { name: 'Encerrar bloqueio por atraso' }).click();
    await page.locator('#editUserMessage').getByText('Usuário atualizado.', { exact: true }).waitFor();
    assert.equal(patches.at(-1).clearAutomaticPenalty, true);
    assert.equal(await page.locator('#clearUserPenalty').isVisible(), false);
    level = 1;
    await page.reload();
    await page.getByRole('button', { name: /^Ver conta e pedidos de/ }).click();
    await page.locator('#userHistorySummary').getByText('1 pedido(s).', { exact: false }).waitFor();
    assert.equal(await page.locator('#userEdit').isVisible(), false, 'Técnicos consultam sem controles de edição');
    assert.deepEqual(errors, []);
    console.log('OK: usuários no desktop e 320/390px, foco/teclado, histórico/danos, HTML como texto, validação, alteração, liberação e consulta técnica.');
} finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
}
