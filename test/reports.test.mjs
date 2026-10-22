import assert from 'node:assert/strict';
import test from 'node:test';

process.env.DATABASE_URL ||= 'postgresql://test:test@127.0.0.1:1/test';
const { validateReportFilters, ReportValidationError, reportToCsv } = await import('../backend/services/reportService.js');
const defaults = { inicio: '2026-10-01', fim: '2026-10-30' };

test('relatórios validam datas reais, intervalo, tipo e situação', () => {
    assert.deepEqual(validateReportFilters({}, defaults), { ...defaults, status: '' });
    assert.deepEqual(validateReportFilters({ inicio: '2024-02-29', fim: '2024-02-29', status: 'Devolvido' }, defaults), { inicio: '2024-02-29', fim: '2024-02-29', status: 'Devolvido' });
    for (const filters of [
        { inicio: '2026-02-29' }, { inicio: '2026-02-30' }, { inicio: '2026-13-01' },
        { inicio: '22/10/2026' }, { inicio: '0000-01-01' }, { inicio: ['2026-10-01'] },
        { inicio: '2026-10-31' }, { fim: '' }, { status: ['Retirado'] }, { status: 'inventado' }
    ]) assert.throws(() => validateReportFilters(filters, defaults), ReportValidationError);
});

test('CSV preserva nulos e protege campos textuais contra fórmulas do Excel', () => {
    const report = {
        periodo: defaults, situacao: '', resumo: { total_pedidos: 1, pedidos_concluidos: 0, usuarios_ativos: 1, tempo_medio_emprestimo_dias: null },
        quantidades: { solicitadas: 2, recebidas: 0, danificadas: 0, taxa_danos_percentual: null },
        status: [{ status: 'Pendente', total: 1 }],
        itens: [{ nome: '+SUM(1;2)', quantidade: 2, pedidos: 1, recebidas: 0, danificadas: 0 }],
        usuarios: [{ nome: '=HYPERLINK("x")', email: '\t@attacker', pedidos: 1 }],
        pedidos: [{ id_pedido: 1, data_pedido: defaults.inicio, status: 'Pendente', usuario_nome: '  -2+3', usuario_email: 'texto;com"aspas\ne linhas', quantidade: 2 }],
        utilizacao: {
            acompanhamento_desde: '2026-10-01T03:00:00Z',
            resumo: { emprestimos: 1, unidades_emprestadas: 3, itens_emprestados: 1, itens_acervo: 2, itens_sem_emprestimo: 1, itens_totalmente_emprestados: 1 },
            totalmente_emprestados: [{ nome: '@estoque esgotado', primeiro_registro: '2026-10-02T03:00:00Z', ultimo_registro: '2026-10-03T03:00:00Z', unidades: 3, registros: 2 }],
            sem_emprestimo: [{ nome: '\r=INDIRECT("A1")', disponiveis: 3 }],
            emprestados: [{ nome: ' -item retirado', quantidade: 3, pedidos: 1 }],
            menos_emprestados: [{ nome: ' -item retirado', quantidade: 3, pedidos: 1 }]
        }
    };
    const csv = reportToCsv(report);
    assert.equal(csv.charCodeAt(0), 0xFEFF);
    assert.match(csv, /"'\+SUM\(1;2\)"/);
    assert.match(csv, /"'=HYPERLINK\(""x""\)"/);
    assert.match(csv, /"'\t@attacker"/);
    assert.match(csv, /"'  -2\+3"/);
    assert.match(csv, /"texto;com""aspas\ne linhas"/);
    assert.match(csv, /"'@estoque esgotado"/);
    assert.match(csv, /"'\r=INDIRECT\(""A1""\)"/);
    assert.match(csv, /"' -item retirado"/);
    const leastBorrowed = csv.split('"Itens menos emprestados no período"\r\n')[1]?.split('\r\n\r\n')[0];
    assert.ok(leastBorrowed, 'CSV inclui a seção de itens menos emprestados.');
    assert.match(leastBorrowed, /"' -item retirado";"3";"1"/);
    assert.match(csv, /100%/);
    assert.match(csv, /sem empr[eé]stimo/i);
    assert.match(csv, /2026-10-01T03:00:00Z/);
    assert.match(csv, /"Sem dados"/);
    assert.match(csv, /\r\n/);
});
