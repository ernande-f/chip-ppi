import sql from '../db.js';
import { ORDER_STATUS } from './orderRules.js';

export class ReportValidationError extends Error {}

export function validateReportFilters(filters, defaults) {
    const inicio = filters.inicio ?? defaults.inicio;
    const fim = filters.fim ?? defaults.fim;
    const status = filters.status ?? '';
    for (const value of [inicio, fim]) {
        if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)
            || value.startsWith('0000') || !Number.isFinite(Date.parse(`${value}T00:00:00Z`))
            || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) {
            throw new ReportValidationError('Informe datas válidas no formato AAAA-MM-DD.');
        }
    }
    if (inicio > fim) throw new ReportValidationError('A data inicial deve ser anterior ou igual à data final.');
    if (typeof status !== 'string' || (status && !Object.values(ORDER_STATUS).includes(status))) {
        throw new ReportValidationError('Selecione uma situação de pedido válida.');
    }
    return { inicio, fim, status };
}

export async function getReport(filters = {}) {
    const [defaults] = await sql`SELECT to_char(current_date - 29, 'YYYY-MM-DD') AS inicio, to_char(current_date, 'YYYY-MM-DD') AS fim`;
    const { inicio, fim, status } = validateReportFilters(filters, defaults);
    const [result] = await sql`
        WITH selecionados AS (
            SELECT pedido.*, status_pedido.descricao_status AS status,
                usuario.nome AS usuario_nome, usuario.email AS usuario_email
            FROM pedido JOIN status_pedido USING (id_status) JOIN usuario USING (id_usuario)
            WHERE data_pedido BETWEEN ${inicio}::date AND ${fim}::date
                AND (${status} = '' OR status_pedido.descricao_status = ${status})
        ), itens AS (
            SELECT contem_lista.*, produto.nome
            FROM contem_lista JOIN selecionados USING (id_pedido) JOIN produto USING (id_produto)
        ), quantidades AS (
            SELECT COALESCE(sum(qnt_solicitada), 0) AS solicitadas,
                COALESCE(sum(qnt_devolvida), 0) AS recebidas,
                COALESCE(sum(qnt_danificada), 0) AS danificadas
            FROM itens
        ), acervo AS (
            SELECT produto.id_produto, produto.nome, produto.estoque_total AS disponiveis
            FROM produto JOIN status_produto USING (id_statusproduto)
            WHERE status_produto.status_produto <> 'Arquivado'
        ), retiradas AS (
            SELECT pedido.id_pedido, contem_lista.id_produto, contem_lista.qnt_solicitada
            FROM pedido JOIN status_pedido USING (id_status) JOIN contem_lista USING (id_pedido)
            WHERE pedido.data_retirada BETWEEN ${inicio}::date AND ${fim}::date
                AND status_pedido.descricao_status IN ('Retirado', 'Devolvido')
        ), emprestados AS (
            SELECT produto.id_produto, produto.nome, sum(retiradas.qnt_solicitada) AS quantidade,
                count(DISTINCT retiradas.id_pedido) AS pedidos
            FROM retiradas JOIN produto USING (id_produto)
            GROUP BY produto.id_produto, produto.nome
        ), sem_emprestimo AS (
            SELECT acervo.* FROM acervo
            WHERE NOT EXISTS (SELECT 1 FROM retiradas WHERE retiradas.id_produto = acervo.id_produto)
        ), leituras AS (
            SELECT historico_uso_estoque.*,
                disponiveis = 0 AND reservadas = 0 AND emprestadas > 0 AS completo,
                lag(disponiveis = 0 AND reservadas = 0 AND emprestadas > 0, 1, false)
                    OVER (PARTITION BY id_produto ORDER BY registrado_em, id_registro) AS anterior_completo
            FROM historico_uso_estoque
        ), entradas_completas AS (
            SELECT * FROM leituras WHERE completo AND NOT anterior_completo AND origem <> 'inicio'
                AND registrado_em >= ${inicio}::date::timestamptz
                AND registrado_em < (${fim}::date + 1)::timestamptz
        ), totalmente_emprestados AS (
            SELECT produto.id_produto, produto.nome, min(registrado_em) AS primeiro_registro,
                max(registrado_em) AS ultimo_registro, max(emprestadas) AS unidades,
                count(*) AS registros
            FROM entradas_completas JOIN produto USING (id_produto)
            GROUP BY produto.id_produto, produto.nome
        )
        SELECT json_build_object(
            'periodo', json_build_object('inicio', ${inicio}::text, 'fim', ${fim}::text),
            'situacao', ${status}::text,
            'utilizacao', json_build_object(
                'acompanhamento_desde', (SELECT min(registrado_em) FROM historico_uso_estoque),
                'resumo', json_build_object(
                    'emprestimos', (SELECT count(DISTINCT id_pedido) FROM retiradas),
                    'unidades_emprestadas', (SELECT COALESCE(sum(qnt_solicitada), 0) FROM retiradas),
                    'itens_emprestados', (SELECT count(*) FROM emprestados),
                    'itens_acervo', (SELECT count(*) FROM acervo),
                    'itens_sem_emprestimo', (SELECT count(*) FROM sem_emprestimo),
                    'itens_totalmente_emprestados', (SELECT count(*) FROM totalmente_emprestados)
                ),
                'totalmente_emprestados', COALESCE((SELECT json_agg(linha ORDER BY linha.ultimo_registro DESC, linha.nome, linha.id_produto)
                    FROM totalmente_emprestados linha), '[]'::json),
                'sem_emprestimo', COALESCE((SELECT json_agg(linha ORDER BY linha.nome, linha.id_produto)
                    FROM sem_emprestimo linha), '[]'::json),
                'emprestados', COALESCE((SELECT json_agg(linha ORDER BY linha.quantidade DESC, linha.nome, linha.id_produto)
                    FROM emprestados linha), '[]'::json),
                'menos_emprestados', COALESCE((SELECT json_agg(linha ORDER BY linha.quantidade, linha.nome, linha.id_produto)
                    FROM emprestados linha), '[]'::json)
            ),
            'resumo', (SELECT json_build_object(
                'total_pedidos', count(*),
                'pedidos_concluidos', count(*) FILTER (WHERE status = 'Devolvido'),
                'usuarios_ativos', count(DISTINCT id_usuario),
                'tempo_medio_emprestimo_dias', round(avg(data_devolucao - data_retirada)
                    FILTER (WHERE status = 'Devolvido' AND data_devolucao >= data_retirada), 2)
            ) FROM selecionados),
            'quantidades', (SELECT json_build_object(
                'solicitadas', solicitadas, 'recebidas', recebidas, 'danificadas', danificadas,
                'taxa_danos_percentual', round(danificadas * 100.0 / NULLIF(recebidas, 0), 2)
            ) FROM quantidades),
            'status', COALESCE((SELECT json_agg(linha ORDER BY linha.id_status) FROM (
                SELECT status_pedido.id_status, status_pedido.descricao_status AS status, count(selecionados.id_pedido) AS total
                FROM status_pedido LEFT JOIN selecionados USING (id_status)
                GROUP BY status_pedido.id_status, status_pedido.descricao_status
            ) linha), '[]'::json),
            'itens', COALESCE((SELECT json_agg(linha ORDER BY linha.quantidade DESC, linha.nome, linha.id_produto) FROM (
                SELECT id_produto, nome, sum(qnt_solicitada) AS quantidade, count(*) AS pedidos,
                    sum(qnt_devolvida) AS recebidas, sum(qnt_danificada) AS danificadas
                FROM itens GROUP BY id_produto, nome
            ) linha), '[]'::json),
            'usuarios', COALESCE((SELECT json_agg(linha ORDER BY linha.pedidos DESC, linha.nome, linha.id_usuario) FROM (
                SELECT id_usuario, usuario_nome AS nome, usuario_email AS email, count(*) AS pedidos
                FROM selecionados GROUP BY id_usuario, usuario_nome, usuario_email
            ) linha), '[]'::json),
            'pedidos', COALESCE((SELECT json_agg(linha ORDER BY linha.data_pedido DESC, linha.id_pedido DESC) FROM (
                SELECT id_pedido, to_char(data_pedido, 'YYYY-MM-DD') AS data_pedido, status,
                    usuario_nome, usuario_email, to_char(data_retirada, 'YYYY-MM-DD') AS data_retirada,
                    to_char(data_devolucao, 'YYYY-MM-DD') AS data_devolucao,
                    (SELECT COALESCE(sum(qnt_solicitada), 0) FROM itens WHERE itens.id_pedido = selecionados.id_pedido) AS quantidade
                FROM selecionados
            ) linha), '[]'::json)
        ) AS relatorio`;
    return result.relatorio;
}

export function reportToCsv(report) {
    const uso = report.utilizacao;
    const rows = [
        ['CHIP — Relatório de utilização e pedidos'],
        ['Período inclusivo', report.periodo.inicio, report.periodo.fim],
        ['Utilização: retiradas e entradas em 100% no período; independente do filtro de situação'],
        ['Acompanhamento do estoque desde', uso.acompanhamento_desde ?? 'Sem registros'],
        ['O estoque anterior ao acompanhamento não pode ser reconstruído. O estado inicial não conta como chegada a 100%.'],
        ['Métrica de utilização', 'Valor'],
        ['Empréstimos com retirada', uso.resumo.emprestimos],
        ['Unidades emprestadas', uso.resumo.unidades_emprestadas],
        ['Itens distintos emprestados, incluindo arquivados', uso.resumo.itens_emprestados],
        ['Itens no acervo atual', uso.resumo.itens_acervo],
        ['Itens do acervo atual sem retirada no período', uso.resumo.itens_sem_emprestimo],
        ['Itens que chegaram a 100% emprestado no período', uso.resumo.itens_totalmente_emprestados],
        [], ['Itens que chegaram a 100% emprestado no período'],
        ['Item', 'Maior quantidade ao atingir 100%', 'Primeiro registro', 'Último registro', 'Registros de entrada em 100%'],
        ...uso.totalmente_emprestados.map(row => [row.nome, row.unidades, row.primeiro_registro, row.ultimo_registro, row.registros]),
        [], ['Itens do acervo atual sem empréstimos no período (sem retirada)'],
        ['Item', 'Disponíveis agora'], ...uso.sem_emprestimo.map(row => [row.nome, row.disponiveis]),
        [], ['Empréstimos realizados por item, pela data de retirada'],
        ['Item', 'Unidades emprestadas', 'Pedidos'], ...uso.emprestados.map(row => [row.nome, row.quantidade, row.pedidos]),
        [], ['Itens menos emprestados no período'],
        ['Item', 'Unidades emprestadas', 'Pedidos'], ...uso.menos_emprestados.map(row => [row.nome, row.quantidade, row.pedidos]),
        [], ['Detalhes das solicitações'],
        ['Data da solicitação (inclusiva)', report.periodo.inicio, report.periodo.fim],
        ['Situação atual', report.situacao || 'Todas'],
        ['Métrica', 'Valor'],
        ['Pedidos', report.resumo.total_pedidos],
        ['Pedidos concluídos', report.resumo.pedidos_concluidos],
        ['Usuários com pedidos', report.resumo.usuarios_ativos],
        ['Tempo médio de empréstimo dos concluídos (dias)', report.resumo.tempo_medio_emprestimo_dias ?? 'Sem dados'],
        ['Unidades solicitadas', report.quantidades.solicitadas],
        ['Unidades recebidas, incluindo danificadas', report.quantidades.recebidas],
        ['Unidades danificadas', report.quantidades.danificadas],
        ['Taxa de danos (% das unidades recebidas)', report.quantidades.taxa_danos_percentual ?? 'Sem dados'],
        [], ['Situação atual', 'Pedidos'], ...report.status.map(row => [row.status, row.total]),
        [], ['Item', 'Unidades solicitadas', 'Pedidos', 'Recebidas', 'Danificadas'],
        ...report.itens.map(row => [row.nome, row.quantidade, row.pedidos, row.recebidas, row.danificadas]),
        [], ['Usuário', 'E-mail', 'Pedidos'], ...report.usuarios.map(row => [row.nome, row.email, row.pedidos]),
        [], ['Pedido', 'Solicitado em', 'Situação atual', 'Usuário', 'E-mail', 'Unidades', 'Retirado em', 'Devolvido em'],
        ...report.pedidos.map(row => [row.id_pedido, row.data_pedido, row.status, row.usuario_nome, row.usuario_email, row.quantidade, row.data_retirada, row.data_devolucao])
    ];
    return '\uFEFF' + rows.map(row => row.map(value => {
        let text = String(value ?? '').replaceAll('\0', '');
        if (typeof value === 'string' && (/^\s*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text))) text = `'${text}`;
        return `"${text.replaceAll('"', '""')}"`;
    }).join(';')).join('\r\n');
}
