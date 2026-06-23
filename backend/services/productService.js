import sql from '../db.js';

export async function createProduct({ nome, estoque_total, cor, foto_produto, id_statusproduto, categorias }) {
    return await sql.begin(async (sql) => {
        // 1. Inserir o produto
        const [produto] = await sql`
            INSERT INTO produto (nome, estoque_total, cor, foto_produto, id_statusproduto)
            VALUES (${nome}, ${estoque_total}, ${cor}, ${foto_produto}, ${id_statusproduto})
            RETURNING id_produto, nome, estoque_total, cor, foto_produto, id_statusproduto
        `;

        // 2. Vincular categorias (se fornecidas)
        if (categorias && Array.isArray(categorias) && categorias.length > 0) {
            for (const catName of categorias) {
                // Verificar se a categoria existe ou criar
                let [categoria] = await sql`
                    SELECT id_categoria FROM categoria WHERE lower(nome_categoria) = lower(${catName.trim()})
                `;

                if (!categoria) {
                    [categoria] = await sql`
                        INSERT INTO categoria (nome_categoria)
                        VALUES (${catName.trim()})
                        RETURNING id_categoria
                    `;
                }

                // Vincular categoria ao produto
                await sql`
                    INSERT INTO categorizar (id_categoria, id_produto)
                    VALUES (${categoria.id_categoria}, ${produto.id_produto})
                `;
            }
        }

        return produto;
    });
}

export async function getAllStatuses() {
    return await sql`SELECT id_statusproduto, status_produto FROM status_produto`;
}

export async function getAllCategories() {
    return await sql`SELECT id_categoria, nome_categoria FROM categoria`;
}
