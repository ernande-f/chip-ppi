import sql from '../db.js';

export class ProductValidationError extends Error {}
export class ProductConflictError extends Error {}
export class ProductNotFoundError extends Error {}

const STATUS = {
    AVAILABLE: 'Disponível',
    UNAVAILABLE: 'Indisponível',
    ARCHIVED: 'Arquivado'
};

function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function normalizeId(value) {
    const id = Number(value);

    if (!Number.isSafeInteger(id) || id < 1) {
        throw new ProductValidationError('Item inválido.');
    }

    return id;
}

function normalizeQuantity(value) {
    const quantity = Number(value);

    if (!Number.isInteger(quantity) || quantity < 0) {
        throw new ProductValidationError('Informe uma quantidade inteira igual ou maior que zero.');
    }

    return quantity;
}

function normalizeCategories(categories) {
    if (!Array.isArray(categories)) {
        return [];
    }

    const normalized = categories
        .map(normalizeText)
        .filter(Boolean)
        .map((category) => category.slice(0, 100));

    const unique = new Map();
    normalized.forEach((category) => {
        const key = category.toLocaleLowerCase('pt-BR');
        if (!unique.has(key)) {
            unique.set(key, category);
        }
    });

    return [...unique.values()];
}

function isSupportedPhoto(value) {
    if (/^data:image\/(png|jpe?g|webp|gif);base64,/i.test(value)) {
        return true;
    }

    try {
        const url = new URL(value);
        return url.protocol === 'https:' || url.protocol === 'http:';
    } catch {
        return false;
    }
}

function normalizeProductData(data, { partial = false } = {}) {
    const nome = normalizeText(data.nome);
    const descricaoProduto = normalizeText(data.descricao_produto);
    const cor = normalizeText(data.cor);
    const fotoProduto = normalizeText(data.foto_produto);
    const categorias = normalizeCategories(data.categorias);

    if (!partial || data.nome !== undefined) {
        if (nome.length < 2 || nome.length > 50) {
            throw new ProductValidationError('Informe um nome entre 2 e 50 caracteres.');
        }
    }

    if (!partial || data.descricao_produto !== undefined) {
        if (descricaoProduto.length < 3) {
            throw new ProductValidationError('Informe uma descrição do item.');
        }
    }

    if (!partial || data.cor !== undefined) {
        if (!cor || cor.length > 20) {
            throw new ProductValidationError('Informe uma cor de até 20 caracteres.');
        }
    }

    if (!partial || data.estoque_total !== undefined) {
        normalizeQuantity(data.estoque_total);
    }

    if (!partial || data.foto_produto !== undefined) {
        if (!fotoProduto) {
            throw new ProductValidationError('Adicione uma foto do item.');
        }

        if (fotoProduto.length > 3_000_000) {
            throw new ProductValidationError('A foto é muito grande. Envie uma imagem de até 2 MB.');
        }

        if (!isSupportedPhoto(fotoProduto)) {
            throw new ProductValidationError('Envie uma imagem válida em PNG, JPEG, WEBP ou GIF.');
        }
    }

    if (!partial || data.categorias !== undefined) {
        if (categorias.length === 0) {
            throw new ProductValidationError('Informe ao menos uma categoria.');
        }
    }

    return {
        nome,
        descricao_produto: descricaoProduto,
        estoque_total: data.estoque_total === undefined ? undefined : normalizeQuantity(data.estoque_total),
        cor,
        foto_produto: fotoProduto,
        categorias
    };
}

export function validateProductPayload(data, options) {
    return normalizeProductData(data, options);
}

async function ensureStatuses(db) {
    for (const status of Object.values(STATUS)) {
        const [existing] = await db`
            SELECT id_statusproduto
            FROM status_produto
            WHERE lower(status_produto) = lower(${status})
            LIMIT 1
        `;

        if (!existing) {
            await db`INSERT INTO status_produto (status_produto) VALUES (${status})`;
        }
    }
}

async function getStatusId(db, status) {
    const [row] = await db`
        SELECT id_statusproduto
        FROM status_produto
        WHERE lower(status_produto) = lower(${status})
        LIMIT 1
    `;

    if (!row) {
        throw new Error(`Status de produto não encontrado: ${status}`);
    }

    return row.id_statusproduto;
}

async function replaceCategories(db, productId, categories) {
    await db`DELETE FROM categorizar WHERE id_produto = ${productId}`;

    for (const categoryName of categories) {
        let [category] = await db`
            SELECT id_categoria
            FROM categoria
            WHERE lower(nome_categoria) = lower(${categoryName})
            LIMIT 1
        `;

        if (!category) {
            [category] = await db`
                INSERT INTO categoria (nome_categoria)
                VALUES (${categoryName})
                RETURNING id_categoria
            `;
        }

        await db`
            INSERT INTO categorizar (id_categoria, id_produto)
            VALUES (${category.id_categoria}, ${productId})
            ON CONFLICT DO NOTHING
        `;
    }
}

function productQueryFilters(filters = {}) {
    return {
        search: normalizeText(filters.search || filters.q).slice(0, 100),
        category: normalizeText(filters.category || filters.categoria).slice(0, 100),
        color: normalizeText(filters.color || filters.cor).slice(0, 20),
        availableOnly: filters.availableOnly === true || filters.availableOnly === 'true',
        includeArchived: filters.includeArchived === true || filters.includeArchived === 'true'
    };
}

export async function listProducts(filters = {}) {
    const { search, category, color, availableOnly, includeArchived } = productQueryFilters(filters);

    return sql`
        SELECT
            p.id_produto,
            p.nome,
            p.descricao_produto,
            p.estoque_total,
            p.cor,
            p.foto_produto,
            sp.status_produto,
            COALESCE(categories.categorias, '[]'::json) AS categorias
        FROM produto p
        INNER JOIN status_produto sp ON sp.id_statusproduto = p.id_statusproduto
        LEFT JOIN LATERAL (
            SELECT json_agg(category_row.nome_categoria ORDER BY category_row.nome_categoria) AS categorias
            FROM (
                SELECT DISTINCT c.nome_categoria
                FROM categorizar cz
                INNER JOIN categoria c ON c.id_categoria = cz.id_categoria
                WHERE cz.id_produto = p.id_produto
            ) AS category_row
        ) AS categories ON true
        WHERE
            (${includeArchived} OR lower(sp.status_produto) <> lower(${STATUS.ARCHIVED}))
            AND (NOT ${availableOnly} OR (lower(sp.status_produto) = lower(${STATUS.AVAILABLE}) AND p.estoque_total > 0))
            AND (
                ${search} = ''
                OR p.nome ILIKE ${`%${search}%`}
                OR p.cor ILIKE ${`%${search}%`}
                OR EXISTS (
                    SELECT 1
                    FROM categorizar search_cz
                    INNER JOIN categoria search_c ON search_c.id_categoria = search_cz.id_categoria
                    WHERE search_cz.id_produto = p.id_produto
                      AND search_c.nome_categoria ILIKE ${`%${search}%`}
                )
            )
            AND (
                ${category} = ''
                OR EXISTS (
                    SELECT 1
                    FROM categorizar category_cz
                    INNER JOIN categoria category_c ON category_c.id_categoria = category_cz.id_categoria
                    WHERE category_cz.id_produto = p.id_produto
                      AND category_c.nome_categoria ILIKE ${`%${category}%`}
                )
            )
            AND (${color} = '' OR p.cor ILIKE ${`%${color}%`})
        ORDER BY lower(p.nome), p.id_produto
    `;
}

export async function getProductById(id) {
    const productId = normalizeId(id);
    const products = await sql`
        SELECT
            p.id_produto,
            p.nome,
            p.descricao_produto,
            p.estoque_total,
            p.cor,
            p.foto_produto,
            sp.status_produto,
            COALESCE(categories.categorias, '[]'::json) AS categorias
        FROM produto p
        INNER JOIN status_produto sp ON sp.id_statusproduto = p.id_statusproduto
        LEFT JOIN LATERAL (
            SELECT json_agg(category_row.nome_categoria ORDER BY category_row.nome_categoria) AS categorias
            FROM (
                SELECT DISTINCT c.nome_categoria
                FROM categorizar cz
                INNER JOIN categoria c ON c.id_categoria = cz.id_categoria
                WHERE cz.id_produto = p.id_produto
            ) AS category_row
        ) AS categories ON true
        WHERE p.id_produto = ${productId}
    `;

    return products[0] || null;
}

export async function createProduct(data) {
    const product = normalizeProductData(data);

    return sql.begin(async (db) => {
        await ensureStatuses(db);

        const [duplicate] = await db`
            SELECT id_produto
            FROM produto
            WHERE lower(nome) = lower(${product.nome})
            LIMIT 1
        `;

        if (duplicate) {
            throw new ProductConflictError('Já existe um item cadastrado com esse nome.');
        }

        const status = product.estoque_total > 0 ? STATUS.AVAILABLE : STATUS.UNAVAILABLE;
        const statusId = await getStatusId(db, status);
        const [createdProduct] = await db`
            INSERT INTO produto (nome, descricao_produto, estoque_total, cor, foto_produto, id_statusproduto)
            VALUES (
                ${product.nome},
                ${product.descricao_produto},
                ${product.estoque_total},
                ${product.cor},
                ${product.foto_produto},
                ${statusId}
            )
            RETURNING id_produto, nome, descricao_produto, estoque_total, cor, foto_produto
        `;

        await replaceCategories(db, createdProduct.id_produto, product.categorias);
        return createdProduct;
    });
}

export async function updateProduct(id, data) {
    const productId = normalizeId(id);
    const updates = normalizeProductData(data, { partial: true });
    const archived = data.archived === true;

    return sql.begin(async (db) => {
        await ensureStatuses(db);

        const [existing] = await db`
            SELECT p.id_produto, p.nome, p.descricao_produto, p.estoque_total, p.cor, p.foto_produto, sp.status_produto
            FROM produto p
            INNER JOIN status_produto sp ON sp.id_statusproduto = p.id_statusproduto
            WHERE p.id_produto = ${productId}
            FOR UPDATE OF p
        `;

        if (!existing) {
            throw new ProductNotFoundError('Item não encontrado.');
        }

        const next = {
            nome: data.nome === undefined ? existing.nome : updates.nome,
            descricao_produto: data.descricao_produto === undefined ? existing.descricao_produto : updates.descricao_produto,
            estoque_total: data.estoque_total === undefined ? existing.estoque_total : updates.estoque_total,
            cor: data.cor === undefined ? existing.cor : updates.cor,
            foto_produto: data.foto_produto === undefined ? existing.foto_produto : updates.foto_produto
        };

        const [duplicate] = await db`
            SELECT id_produto
            FROM produto
            WHERE lower(nome) = lower(${next.nome})
              AND id_produto <> ${productId}
            LIMIT 1
        `;

        if (duplicate) {
            throw new ProductConflictError('Já existe um item cadastrado com esse nome.');
        }

        const status = (data.archived === undefined ? existing.status_produto === STATUS.ARCHIVED : archived)
            ? STATUS.ARCHIVED
            : (next.estoque_total > 0 ? STATUS.AVAILABLE : STATUS.UNAVAILABLE);
        const statusId = await getStatusId(db, status);

        const [updatedProduct] = await db`
            UPDATE produto
            SET
                nome = ${next.nome},
                descricao_produto = ${next.descricao_produto},
                estoque_total = ${next.estoque_total},
                cor = ${next.cor},
                foto_produto = ${next.foto_produto},
                id_statusproduto = ${statusId}
            WHERE id_produto = ${productId}
            RETURNING id_produto, nome, descricao_produto, estoque_total, cor, foto_produto
        `;

        if (data.categorias !== undefined) {
            await replaceCategories(db, productId, updates.categorias);
        }

        return updatedProduct;
    });
}

export async function deleteProduct(id) {
    const productId = normalizeId(id);

    try {
        return await sql.begin(async (db) => {
            const [existing] = await db`
                SELECT id_produto, nome
                FROM produto
                WHERE id_produto = ${productId}
                FOR UPDATE
            `;

            if (!existing) {
                throw new ProductNotFoundError('Item não encontrado.');
            }

            await db`DELETE FROM categorizar WHERE id_produto = ${productId}`;
            const [deletedProduct] = await db`
                DELETE FROM produto
                WHERE id_produto = ${productId}
                RETURNING id_produto, nome
            `;

            return deletedProduct;
        });
    } catch (error) {
        if (error.code === '23503') {
            throw new ProductConflictError('Este item possui histórico de pedidos e não pode ser excluído. Arquive-o para removê-lo do catálogo.');
        }

        throw error;
    }
}

export async function getAllCategories() {
    return sql`
        SELECT id_categoria, nome_categoria
        FROM categoria
        ORDER BY lower(nome_categoria)
    `;
}
