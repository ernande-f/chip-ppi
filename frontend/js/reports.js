import { apiRequest, formatDate } from './api.js';

const number = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });
const dateTime = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' });

function renderRows(id, rows, columns, emptyMessage = 'Nenhum registro no período e situação selecionados.') {
    const body = document.getElementById(id);
    body.replaceChildren();
    for (const row of rows) {
        const tr = document.createElement('tr');
        for (const value of columns(row)) {
            const td = document.createElement('td');
            td.textContent = value ?? 'Não registrado';
            tr.appendChild(td);
        }
        body.appendChild(tr);
    }
    if (!rows.length) {
        const tr = document.createElement('tr');
        const td = document.createElement('td');
        td.colSpan = body.closest('table').querySelectorAll('thead th').length;
        td.textContent = emptyMessage;
        tr.appendChild(td);
        body.appendChild(tr);
    }
}

function renderMetrics(id, values) {
    const metrics = document.getElementById(id);
    metrics.replaceChildren();
    for (const [label, value, detail] of values) {
        const item = document.createElement('div');
        item.className = 'report-metric';
        const title = document.createElement('dt');
        title.textContent = label;
        const content = document.createElement('dd');
        content.textContent = value;
        item.append(title, content);
        if (detail) {
            const description = document.createElement('small');
            description.textContent = detail;
            content.appendChild(description);
        }
        metrics.appendChild(item);
    }
}

function renderReport(report) {
    document.getElementById('reportPeriod').textContent = `Período de ${formatDate(report.periodo.inicio)} a ${formatDate(report.periodo.fim)} · Pedidos: ${report.situacao || 'Todas as situações'}`;
    const { resumo, quantidades, utilizacao } = report;
    const usage = utilizacao.resumo;
    renderMetrics('reportUsageMetrics', [
        ['Empréstimos realizados', number.format(usage.emprestimos)],
        ['Unidades emprestadas', number.format(usage.unidades_emprestadas)],
        ['Itens diferentes emprestados', number.format(usage.itens_emprestados)],
        ['Itens no acervo atual', number.format(usage.itens_acervo), 'Exclui itens arquivados.'],
        ['Itens sem empréstimos', number.format(usage.itens_sem_emprestimo), 'Do acervo atual, sem retirada no período.'],
        ['Itens que chegaram a 100%', number.format(usage.itens_totalmente_emprestados), 'Todo o estoque em condições de uso emprestado ao mesmo tempo.']
    ]);
    document.getElementById('reportTrackingCoverage').textContent = utilizacao.acompanhamento_desde
        ? `O histórico de utilização do estoque começou em ${dateTime.format(new Date(utilizacao.acompanhamento_desde))}. O estado observado no início não comprova quando o item chegou a 100% e não é contado. Não é possível reconstruir essas mudanças antes do início do acompanhamento.`
        : 'Ainda não há histórico de utilização do estoque. Nenhuma conclusão sobre estoque 100% emprestado pode ser feita antes do início dos registros.';
    renderRows('reportFullUsage', utilizacao.totalmente_emprestados, row => [
        row.nome, number.format(row.unidades), dateTime.format(new Date(row.primeiro_registro)), dateTime.format(new Date(row.ultimo_registro)), number.format(row.registros)
    ], 'Nenhuma chegada a 100% do estoque emprestado foi registrada no período.');
    renderRows('reportUnusedItems', utilizacao.sem_emprestimo, row => [row.nome, number.format(row.disponiveis)], 'Nenhum item do acervo atual ficou sem empréstimo no período.');
    renderRows('reportBorrowedItems', utilizacao.emprestados, row => [row.nome, number.format(row.quantidade), number.format(row.pedidos)], 'Nenhum item foi retirado no período.');
    renderRows('reportLeastBorrowedItems', utilizacao.menos_emprestados, row => [row.nome, number.format(row.quantidade), number.format(row.pedidos)], 'Nenhum item foi retirado no período.');
    renderMetrics('reportMetrics', [
        ['Pedidos no período', number.format(resumo.total_pedidos)],
        ['Pedidos concluídos', number.format(resumo.pedidos_concluidos)],
        ['Usuários com pedidos', number.format(resumo.usuarios_ativos)],
        ['Unidades solicitadas', number.format(quantidades.solicitadas)],
        ['Unidades recebidas', number.format(quantidades.recebidas), 'Inclui unidades danificadas e devoluções parciais.'],
        ['Unidades danificadas', number.format(quantidades.danificadas)],
        ['Taxa de danos', quantidades.taxa_danos_percentual === null ? 'Sem dados' : `${number.format(quantidades.taxa_danos_percentual)}%`, 'Unidades danificadas ÷ unidades recebidas.'],
        ['Tempo médio de empréstimo', resumo.tempo_medio_emprestimo_dias === null ? 'Sem dados' : `${number.format(resumo.tempo_medio_emprestimo_dias)} dias`, 'Da retirada à devolução completa dos pedidos concluídos com ambas as datas registradas.']
    ]);
    renderRows('reportStatuses', report.status, row => [row.status, number.format(row.total)]);
    renderRows('reportItems', report.itens, row => [row.nome, number.format(row.quantidade), number.format(row.pedidos), number.format(row.recebidas), number.format(row.danificadas)]);
    renderRows('reportUsers', report.usuarios, row => [row.nome, row.email, number.format(row.pedidos)]);
    renderRows('reportOrders', report.pedidos, row => [`#${row.id_pedido}`, formatDate(row.data_pedido), row.usuario_nome, row.status, number.format(row.quantidade), row.data_retirada ? formatDate(row.data_retirada) : 'Não realizada', row.data_devolucao ? formatDate(row.data_devolucao) : 'Não concluída']);
}

document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('reportFilters');
    const message = document.getElementById('reportMessage');
    const content = document.getElementById('reportContent');
    const exportButton = document.getElementById('reportExport');
    let loadedQuery = '';
    async function loadReport(query = '') {
        document.getElementById('reportApply').disabled = true;
        content.hidden = true;
        content.setAttribute('aria-busy', 'true');
        message.dataset.error = 'false';
        message.textContent = 'Gerando relatório…';
        try {
            const { relatorio } = await apiRequest(`/api/gestao/relatorios${query ? `?${query}` : ''}`);
            document.getElementById('reportStart').value = relatorio.periodo.inicio;
            document.getElementById('reportEnd').value = relatorio.periodo.fim;
            loadedQuery = new URLSearchParams({ ...relatorio.periodo, status: relatorio.situacao }).toString();
            renderReport(relatorio);
            content.hidden = false;
            message.textContent = relatorio.resumo.total_pedidos ? `${relatorio.resumo.total_pedidos} pedido(s) no relatório.` : 'Nenhum pedido no período e situação selecionados.';
        } catch (error) {
            message.dataset.error = 'true';
            message.textContent = error.message;
        } finally {
            document.getElementById('reportApply').disabled = false;
            content.setAttribute('aria-busy', 'false');
        }
    }
    form.addEventListener('submit', event => {
        event.preventDefault();
        const start = document.getElementById('reportStart');
        const end = document.getElementById('reportEnd');
        if (start.value > end.value) {
            message.dataset.error = 'true';
            message.textContent = 'A data inicial deve ser anterior ou igual à data final.';
            start.focus();
            return;
        }
        void loadReport(new URLSearchParams(new FormData(form)).toString());
    });
    exportButton.addEventListener('click', async () => {
        exportButton.disabled = true;
        try {
            const response = await fetch(`/api/gestao/relatorios/exportar.csv?${loadedQuery}`, { credentials: 'same-origin' });
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.message || 'Não foi possível exportar o relatório.');
            }
            const url = URL.createObjectURL(await response.blob());
            const link = document.createElement('a');
            link.href = url;
            const period = new URLSearchParams(loadedQuery);
            link.download = `CHIP-relatorio-${period.get('inicio')}-${period.get('fim')}.csv`;
            link.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            message.dataset.error = 'false';
            message.textContent = 'CSV exportado. Abra o arquivo no Excel ou em outro editor de planilhas.';
        } catch (error) {
            message.dataset.error = 'true';
            message.textContent = error.message;
        } finally { exportButton.disabled = false; }
    });
    document.getElementById('reportPrint').addEventListener('click', () => window.print());
    void loadReport();
});
