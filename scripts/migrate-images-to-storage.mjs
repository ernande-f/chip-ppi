import 'dotenv/config';
import sql from '../backend/db.js';
import { uploadProductImage, isBase64DataUrl } from '../backend/services/storageService.js';

async function migrateImages() {
    console.log('Iniciando migração de fotos de produtos em Base64 para Supabase Storage...');

    const products = await sql`
        SELECT id_produto, nome, foto_produto
        FROM produto
        WHERE foto_produto LIKE 'data:image/%'
    `;

    console.log(`Encontrados ${products.length} produtos com imagens em Base64.`);

    let successCount = 0;
    let errorCount = 0;

    for (const product of products) {
        try {
            if (isBase64DataUrl(product.foto_produto)) {
                console.log(`Enviando foto do produto #${product.id_produto} (${product.nome})...`);
                const publicUrl = await uploadProductImage(product.foto_produto);

                await sql`
                    UPDATE produto
                    SET foto_produto = ${publicUrl}
                    WHERE id_produto = ${product.id_produto}
                `;

                console.log(`✓ Produto #${product.id_produto} atualizado: ${publicUrl}`);
                successCount++;
            }
        } catch (error) {
            console.error(`✗ Erro no produto #${product.id_produto} (${product.nome}):`, error.message);
            errorCount++;
        }
    }

    console.log(`\nMigração finalizada: ${successCount} sucesso(s), ${errorCount} erro(s).`);
}

migrateImages()
    .catch((error) => {
        console.error('Falha fatal na migração:', error);
        process.exit(1);
    })
    .finally(() => {
        sql.end();
    });
