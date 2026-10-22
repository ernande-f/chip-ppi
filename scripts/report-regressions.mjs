import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { once } from 'node:events';
import express from 'express';
import postgres from 'postgres';
import { chromium } from 'playwright';

const adminUrl = process.env.TEST_DATABASE_URL;
if (!adminUrl || !['localhost', '127.0.0.1'].includes(new URL(adminUrl).hostname)) {
    throw new Error('Defina TEST_DATABASE_URL para um PostgreSQL local de testes com permissão de criar bancos.');
}
const admin = postgres(adminUrl, { max: 1, onnotice() {} });
const name = `chip_reports_${randomUUID().replaceAll('-', '')}`;
const url = new URL(adminUrl);
url.pathname = `/${name}`;
let created = false, db, server, browser;
try {
    await admin`CREATE DATABASE ${admin(name)}`;
    created = true;
    process.env.DATABASE_URL = url.href;
    process.env.APP_SESSION_SECRET = 'report-regression-secret-at-least-32-characters';
    db = (await import('../backend/db.js')).default;
    const setup = await db.reserve();
    try {
        await setup.unsafe(await readFile(new URL('../database/schema.sql', import.meta.url), 'utf8'));
        const migrations = await readdir(new URL('../database/migrations/', import.meta.url));
        const established = ['google_login.sql', 'reservations.sql', 'google_only.sql', 'indexes.sql', 'session_version.sql', 'pickup_deadline.sql', 'return_conditions.sql'];
        for (const file of [...established, ...migrations.filter(file => file.endsWith('.sql') && !established.includes(file)).sort()]) {
            await setup.unsafe(await readFile(new URL(`../database/migrations/${file}`, import.meta.url), 'utf8'));
        }
    } finally { setup.release(); }
    const { getReport } = await import('../backend/services/reportService.js');
    const { createSessionToken } = await import('../backend/services/sessionAuth.js');
    const router = (await import('../backend/routes/reports.js')).default;
    async function user(level, nome, email) {
        const [row] = await db`INSERT INTO usuario (nome, email, nivel_acesso, google_sub, auth_user_id)
            VALUES (${nome}, ${email}, ${level}, ${randomUUID()}, ${randomUUID()}) RETURNING *`;
        return row;
    }
    const student = await user(0, '=2+2', 'student@aluno.iffar.edu.br');
    const other = await user(0, 'Usuário com nome extenso para verificar o relatório', 'other@aluno.iffar.edu.br');
    const tech = await user(1, 'Técnico', 'tech@iffarroupilha.edu.br');
    const manager = await user(2, 'Administrador', 'admin@iffarroupilha.edu.br');
    const [product] = await db`INSERT INTO produto (nome, estoque_total, id_statusproduto)
        SELECT '+SUM(1;1)', 20, id_statusproduto FROM status_produto LIMIT 1 RETURNING *`;
    async function order(owner, date, status, quantity, returned = 0, damaged = 0, pickup = null, completed = null, item = product) {
        const [row] = await db`INSERT INTO pedido (id_usuario, data_pedido, id_status, data_retirada, data_devolucao)
            SELECT ${owner.id_usuario}, ${date}, id_status, ${pickup}, ${completed} FROM status_pedido WHERE descricao_status = ${status} RETURNING *`;
        await db`INSERT INTO contem_lista (id_pedido, id_produto, qnt_solicitada, qnt_devolvida, qnt_danificada)
            VALUES (${row.id_pedido}, ${item.id_produto}, ${quantity}, ${returned}, ${damaged})`;
        return row;
    }
    await order(student, '2026-09-30', 'Devolvido', 2, 2, 0, '2026-10-01', '2026-10-02');
    await order(student, '2026-10-01', 'Devolvido', 4, 4, 1, '2026-10-02', '2026-10-09');
    await order(student, '2026-10-15', 'Retirado', 3, 1, 1, '2026-10-16');
    await order(other, '2026-10-31', 'Devolvido', 2, 2, 0, '2026-10-31', '2026-11-02');
    await order(student, '2026-10-20', 'Cancelado', 2);
    await order(other, '2026-11-01', 'Pendente', 10);
    const filters = { inicio: '2026-10-01', fim: '2026-10-31' };
    const report = await getReport(filters);
    assert.deepEqual(report.resumo, { total_pedidos: 4, pedidos_concluidos: 2, usuarios_ativos: 2, tempo_medio_emprestimo_dias: 4.5 });
    assert.deepEqual(report.quantidades, { solicitadas: 11, recebidas: 7, danificadas: 2, taxa_danos_percentual: 28.57 });
    assert.equal(report.status.reduce((n, row) => n + row.total, 0), report.pedidos.length);
    assert.equal(report.itens[0].quantidade, 11);
    assert.equal(report.usuarios[0].pedidos, 3);
    assert.equal((await getReport({ inicio: filters.inicio, fim: filters.inicio })).resumo.total_pedidos, 1);
    assert.equal((await getReport({ ...filters, status: 'Devolvido' })).resumo.total_pedidos, 2);
    const empty = await getReport({ inicio: '2030-01-01', fim: '2030-01-01' });
    assert.equal(empty.resumo.total_pedidos, 0);
    assert.equal(empty.resumo.tempo_medio_emprestimo_dias, null);
    assert.equal(empty.quantidades.taxa_danos_percentual, null);
    const [defaultPeriod] = await db`SELECT to_char(current_date - 29, 'YYYY-MM-DD') inicio, to_char(current_date, 'YYYY-MM-DD') fim`;
    assert.deepEqual((await getReport()).periodo, { inicio: defaultPeriod.inicio, fim: defaultPeriod.fim });

    async function item(nome, stock = 1, archived = false) {
        const [row] = await db`INSERT INTO produto (nome, estoque_total, id_statusproduto)
            SELECT ${nome}, ${stock}, id_statusproduto FROM status_produto
            WHERE status_produto = ${archived ? 'Arquivado' : 'Disponível'} RETURNING *`;
        return row;
    }
    const pickedInPeriod = await item('Retirado após a solicitação de setembro', 5);
    const neverRequested = await item('Nunca solicitado', 4);
    const reservedOnly = await item('Somente reservado', 0);
    const cancelledOnly = await item('Somente cancelado', 2);
    const pickedOutside = await item('Retirado fora do período', 9);
    const archived = await item('Arquivado sem empréstimo', 2, true);
    const archivedBorrowed = await item('Arquivado após o empréstimo', 0, true);
    const initialFull = await item('@100% na observação inicial', 0);
    const fullOutside = await item('100% alcançado fora do período', 0);
    const emptyStock = await item('Estoque vazio sem empréstimo', 0);
    await order(other, '2026-09-25', 'Devolvido', 5, 5, 0, '2026-10-10', '2026-10-11', pickedInPeriod);
    await order(student, '2026-09-25', 'Pendente', 4, 0, 0, null, null, reservedOnly);
    await order(student, '2026-09-25', 'Cancelado', 2, 0, 0, null, null, cancelledOnly);
    await order(other, '2026-09-20', 'Devolvido', 9, 9, 0, '2026-09-20', '2026-09-21', pickedOutside);
    await order(other, '2026-09-20', 'Devolvido', 4, 4, 0, '2026-10-20', '2026-10-21', archivedBorrowed);
    async function snapshot(item, at, available, reserved, loaned, origin = 'retirada') {
        await db`INSERT INTO historico_uso_estoque (id_produto, registrado_em, disponiveis, reservadas, emprestadas, origem)
            VALUES (${item.id_produto}, ${at}, ${available}, ${reserved}, ${loaned}, ${origin})`;
    }
    await snapshot(product, '2026-10-01T02:59:59.999Z', 20, 0, 0, 'inicio');
    await snapshot(product, '2026-10-01T03:00:00.000Z', 0, 0, 20);
    await snapshot(product, '2026-10-05T03:00:00.000Z', 0, 0, 20);
    await snapshot(product, '2026-10-20T03:00:00.000Z', 5, 0, 15, 'devolucao');
    await snapshot(product, '2026-11-01T02:59:59.999Z', 0, 0, 20);
    await snapshot(product, '2026-11-01T03:00:00.000Z', 0, 0, 20);
    await snapshot(initialFull, '2026-10-10T03:00:00.000Z', 0, 0, 3, 'inicio');
    await snapshot(initialFull, '2026-10-11T03:00:00.000Z', 0, 0, 3);
    await snapshot(initialFull, '2026-10-12T03:00:00.000Z', 1, 0, 2, 'devolucao');
    await snapshot(initialFull, '2026-10-13T03:00:00.000Z', 0, 0, 3);
    await snapshot(fullOutside, '2026-10-01T02:59:59.999Z', 0, 0, 4, 'inicio');
    await snapshot(fullOutside, '2026-10-02T03:00:00.000Z', 0, 0, 4);
    await snapshot(fullOutside, '2026-10-31T03:00:00.000Z', 1, 0, 3, 'devolucao');
    await snapshot(fullOutside, '2026-11-01T03:00:00.000Z', 0, 0, 4);
    await snapshot(reservedOnly, '2026-10-02T03:00:00.000Z', 0, 4, 0, 'reserva');
    await snapshot(reservedOnly, '2026-10-03T03:00:00.000Z', 0, 1, 3);
    await snapshot(emptyStock, '2026-10-02T03:00:00.000Z', 0, 0, 0, 'inicio');

    const usageReport = await getReport(filters);
    assert.deepEqual(usageReport.resumo, report.resumo, 'Retiradas de pedidos antigos não alteram as métricas por data da solicitação.');
    assert.deepEqual(usageReport.quantidades, report.quantidades);
    const usage = usageReport.utilizacao;
    assert.equal(new Date(usage.acompanhamento_desde).toISOString(), '2026-10-01T02:59:59.999Z');
    assert.deepEqual(usage.resumo, {
        emprestimos: 6, unidades_emprestadas: 20, itens_emprestados: 3,
        itens_acervo: 9, itens_sem_emprestimo: 7, itens_totalmente_emprestados: 2
    });
    const entry = (rows, item) => rows.find(row => String(row.id_produto) === String(item.id_produto));
    assert.equal(entry(usage.emprestados, product).quantidade, 11);
    assert.equal(entry(usage.emprestados, product).pedidos, 4);
    assert.equal(entry(usage.emprestados, pickedInPeriod).quantidade, 5);
    assert.equal(entry(usage.emprestados, archivedBorrowed).quantidade, 4, 'Arquivar o produto não apaga empréstimos anteriores.');
    assert.deepEqual(usage.menos_emprestados, [...usage.emprestados].reverse(), 'Menos emprestados usa as mesmas retiradas, em ordem crescente de unidades.');
    assert.deepEqual(usage.menos_emprestados.map(row => row.quantidade), [4, 5, 11]);
    assert.equal(entry(usage.menos_emprestados, neverRequested), undefined);
    assert.equal(entry(usage.menos_emprestados, reservedOnly), undefined);
    assert.ok(usage.menos_emprestados.every(row => row.quantidade > 0));
    assert.equal(entry(usage.sem_emprestimo, pickedInPeriod), undefined);
    assert.equal(entry(usage.sem_emprestimo, archived), undefined);
    assert.equal(entry(usage.sem_emprestimo, archivedBorrowed), undefined);
    for (const unused of [neverRequested, reservedOnly, cancelledOnly, pickedOutside, initialFull, fullOutside, emptyStock]) {
        assert.ok(entry(usage.sem_emprestimo, unused), `${unused.nome} precisa aparecer sem retirada no período.`);
    }
    assert.equal(entry(usage.sem_emprestimo, neverRequested).disponiveis, 4);
    const full = entry(usage.totalmente_emprestados, product);
    assert.equal(full.registros, 2, 'Snapshots repetidos não representam novas entradas em 100%.');
    assert.equal(full.unidades, 20);
    assert.equal(new Date(full.primeiro_registro).toISOString(), '2026-10-01T03:00:00.000Z');
    assert.equal(new Date(full.ultimo_registro).toISOString(), '2026-11-01T02:59:59.999Z');
    assert.equal(entry(usage.totalmente_emprestados, initialFull).registros, 1);
    assert.equal(new Date(entry(usage.totalmente_emprestados, initialFull).primeiro_registro).toISOString(), '2026-10-13T03:00:00.000Z');
    const baselineOnly = (await getReport({ inicio: '2026-10-10', fim: '2026-10-11' })).utilizacao;
    assert.equal(entry(baselineOnly.totalmente_emprestados, initialFull), undefined, 'Baseline e continuidade não comprovam chegada a 100% no período.');
    for (const excluded of [fullOutside, reservedOnly, emptyStock]) assert.equal(entry(usage.totalmente_emprestados, excluded), undefined);
    assert.deepEqual((await getReport({ ...filters, status: 'Pendente' })).utilizacao, usage, 'Situação atual filtra pedidos, não o uso físico do acervo.');
    const beforeTracking = (await getReport({ inicio: '2026-09-01', fim: '2026-09-30' })).utilizacao;
    assert.equal(beforeTracking.totalmente_emprestados.length, 0);
    const startDay = (await getReport({ inicio: filters.inicio, fim: filters.inicio })).utilizacao;
    assert.equal(entry(startDay.totalmente_emprestados, product).registros, 1);
    assert.equal(entry(startDay.totalmente_emprestados, fullOutside), undefined);
    const endDay = (await getReport({ inicio: filters.fim, fim: filters.fim })).utilizacao;
    assert.equal(entry(endDay.totalmente_emprestados, product).registros, 1);
    assert.equal(entry(endDay.totalmente_emprestados, fullOutside), undefined);
    const emptyUsage = (await getReport({ inicio: '2030-01-01', fim: '2030-01-01' })).utilizacao;
    assert.equal(emptyUsage.resumo.emprestimos, 0);
    assert.equal(emptyUsage.resumo.unidades_emprestadas, 0);
    assert.equal(emptyUsage.totalmente_emprestados.length, 0);
    assert.equal(emptyUsage.sem_emprestimo.length, 9);
    assert.deepEqual(emptyUsage.menos_emprestados, []);
    await db`UPDATE contem_lista SET qnt_solicitada = 5, qnt_devolvida = 5 WHERE id_produto = ${archivedBorrowed.id_produto}`;
    const tiedNames = (await getReport(filters)).utilizacao.menos_emprestados;
    assert.deepEqual(tiedNames.map(row => String(row.id_produto)), [archivedBorrowed, pickedInPeriod, product].map(row => String(row.id_produto)), 'Empate de quantidade usa nome crescente.');
    await db`UPDATE produto SET nome = ${pickedInPeriod.nome} WHERE id_produto = ${archivedBorrowed.id_produto}`;
    const tiedIds = (await getReport(filters)).utilizacao.menos_emprestados;
    assert.deepEqual(tiedIds.map(row => String(row.id_produto)), [pickedInPeriod, archivedBorrowed, product].map(row => String(row.id_produto)), 'Empate de quantidade e nome usa identificador crescente.');
    await db`UPDATE produto SET nome = ${archivedBorrowed.nome} WHERE id_produto = ${archivedBorrowed.id_produto}`;
    await db`UPDATE contem_lista SET qnt_solicitada = 4, qnt_devolvida = 4 WHERE id_produto = ${archivedBorrowed.id_produto}`;

    const app = express();
    app.use('/api/gestao/relatorios', router);
    app.get('/api/session', (_req, res) => res.json({ user: { email: tech.email }, profile: tech }));
    app.use(express.static('frontend'));
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const base = `http://127.0.0.1:${server.address().port}`;
    const auth = profile => ({ Authorization: `Bearer ${createSessionToken({ id: profile.auth_user_id, email: profile.email, auth_provider: 'google', session_version: profile.session_version })}` });
    for (const path of ['', '/exportar.csv']) {
        const target = `${base}/api/gestao/relatorios${path}?${new URLSearchParams(filters)}`;
        assert.equal((await fetch(target)).status, 401);
        assert.equal((await fetch(target, { headers: auth(student) })).status, 403);
        assert.equal((await fetch(target, { headers: auth(tech) })).status, 200);
        assert.equal((await fetch(target, { headers: auth(manager) })).status, 200);
    }
    const invalid = await fetch(`${base}/api/gestao/relatorios?inicio=2026-02-30`, { headers: auth(tech) });
    assert.equal(invalid.status, 400);
    const exported = await fetch(`${base}/api/gestao/relatorios/exportar.csv?${new URLSearchParams(filters)}`, { headers: auth(tech) });
    assert.match(exported.headers.get('content-type'), /^text\/csv/);
    const csv = Buffer.from(await exported.arrayBuffer());
    assert.equal(csv.subarray(0, 3).toString('hex'), 'efbbbf');
    assert.match(csv.toString(), /"'=2\+2"/);
    assert.match(csv.toString(), /"'@100% na observação inicial"/);
    assert.match(csv.toString(), /Nunca solicitado/);
    assert.match(csv.toString(), /Retirado após a solicitação de setembro/);
    const leastCsv = csv.toString().split('"Itens menos emprestados no período"\r\n')[1]?.split('\r\n\r\n')[0];
    assert.ok(leastCsv);
    assert.ok(leastCsv.indexOf(archivedBorrowed.nome) < leastCsv.indexOf(pickedInPeriod.nome));
    assert.ok(leastCsv.indexOf(pickedInPeriod.nome) < leastCsv.indexOf(product.nome));
    assert.match(leastCsv, /"'\+SUM\(1;1\)";"11";"4"/);
    assert.doesNotMatch(leastCsv, /Nunca solicitado|Somente reservado/);

    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ extraHTTPHeaders: auth(tech) });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    for (const width of [320, 390, 1280]) {
        await page.setViewportSize({ width, height: 800 });
        await page.goto(`${base}/pages/relatorios.html`);
        await page.locator('#reportContent').waitFor({ state: 'visible' });
        await page.locator('#reportStart').fill(filters.inicio);
        await page.locator('#reportEnd').fill(filters.fim);
        await page.getByRole('button', { name: 'Gerar relatório' }).click();
        await page.getByRole('status').filter({ hasText: '4 pedido(s) no relatório.' }).waitFor();
        assert.equal(await page.locator('#reportOrders tr').count(), 4);
        assert.match(await page.locator('#reportMetrics').innerText(), /28,57%/);
        assert.equal(await page.locator('#reportUsageMetrics > div').count(), 6);
        assert.equal(await page.locator('#reportFullUsage tr').count(), 2);
        assert.equal(await page.locator('#reportUnusedItems tr').count(), 7);
        assert.equal(await page.locator('#reportBorrowedItems tr').count(), 3);
        assert.deepEqual(await page.locator('#reportLeastBorrowedItems tr td:first-child').allTextContents(), usage.menos_emprestados.map(row => row.nome));
        assert.deepEqual(await page.locator('#reportLeastBorrowedItems tr td:nth-child(2)').allTextContents(), ['4', '5', '11']);
        assert.match(await page.locator('#reportFullUsage').innerText(), /100% na observação inicial/);
        assert.match(await page.locator('#reportUnusedItems').innerText(), /Nunca solicitado/);
        assert.match(await page.locator('#reportBorrowedItems').innerText(), /Retirado após a solicitação de setembro/);
        assert.ok((await page.locator('#reportTrackingCoverage').innerText()).length > 20);
        assert.ok((await page.locator('#reportFilterScope').innerText()).length > 20);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `Relatórios transbordam em ${width}px`);
        const download = page.waitForEvent('download');
        await page.getByRole('button', { name: 'Exportar CSV (Excel)' }).click();
        assert.match((await download).suggestedFilename(), /^CHIP-relatorio-2026-10-01-2026-10-31\.csv$/);
    }
    await page.locator('#reportStatus').selectOption('Pendente');
    await page.getByRole('button', { name: 'Gerar relatório' }).click();
    await page.getByRole('status').filter({ hasText: 'Nenhum pedido' }).waitFor();
    assert.equal(await page.locator('#reportFullUsage tr').count(), 2);
    assert.equal(await page.locator('#reportUnusedItems tr').count(), 7);
    assert.equal(await page.locator('#reportBorrowedItems tr').count(), 3);
    assert.equal(await page.locator('#reportLeastBorrowedItems tr').count(), 3);
    await page.locator('#reportStatus').selectOption('');
    await page.locator('#reportStart').fill('2030-01-01');
    await page.locator('#reportEnd').fill('2030-01-01');
    await page.getByRole('button', { name: 'Gerar relatório' }).click();
    await page.getByRole('status').filter({ hasText: 'Nenhum pedido' }).waitFor();
    assert.match(await page.locator('#reportMetrics').innerText(), /Sem dados/);
    assert.equal(await page.locator('#reportUnusedItems tr').count(), 9);
    assert.equal(await page.locator('#reportLeastBorrowedItems tr').count(), 1);
    assert.equal(await page.locator('#reportLeastBorrowedItems td').getAttribute('colspan'), '3');
    assert.match(await page.locator('#reportLeastBorrowedItems').innerText(), /Nenhum/);
    for (const width of [320, 390, 1280]) {
        await page.setViewportSize({ width, height: 800 });
        assert.equal(await page.locator('#reportLeastBorrowedItems tr').count(), 1);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `Relatório vazio transborda em ${width}px`);
        await page.emulateMedia({ media: 'print' });
        assert.equal(await page.locator('.report-filters').isVisible(), false);
        assert.equal(await page.locator('#reportContent').isVisible(), true);
        assert.equal(await page.locator('#reportLeastBorrowedItems').isVisible(), true);
        await page.emulateMedia({ media: 'screen' });
    }
    assert.deepEqual(errors, []);
    console.log('OK: relatórios agregam pedidos e uso físico por período, entradas históricas em 100% sem duplicação, limites São Paulo, itens sem retirada, menos emprestados com desempate estável, danos parciais, CSV seguro, autorização e interface em 320/390/1280px.');
} finally {
    if (browser) await browser.close();
    if (server) await new Promise(resolve => server.close(resolve));
    if (db) await db.end({ timeout: 2 });
    if (created) await admin`DROP DATABASE ${admin(name)}`;
    await admin.end();
}
