import sql from '../backend/db.js';

const base = process.env.SUPABASE_URL;
if (!base) throw new Error('Defina SUPABASE_URL da origem para identificar as imagens antigas.');
const prefix = `${base.replace(/\/$/, '')}/storage/v1/object/public/product-images/`;
try {
    const products = await sql`SELECT id_produto, foto_produto FROM produto WHERE foto_produto LIKE ${`${prefix}%`}`;
    for (const product of products) {
        const response = await fetch(product.foto_produto, { signal: AbortSignal.timeout(15_000), redirect: 'error' });
        const type = response.headers.get('content-type')?.split(';')[0];
        if (!response.ok || !/^image\/(png|jpeg|webp|gif)$/.test(type)) throw new Error(`Imagem inválida: item ${product.id_produto}`);
        const chunks = [];
        let size = 0;
        for await (const chunk of response.body) {
            size += chunk.length;
            if (size > 2 * 1024 * 1024) throw new Error(`Imagem maior que 2 MB: item ${product.id_produto}`);
            chunks.push(chunk);
        }
        const dataUrl = `data:${type};base64,${Buffer.concat(chunks).toString('base64')}`;
        await sql`UPDATE produto SET foto_produto = ${dataUrl} WHERE id_produto = ${product.id_produto} AND foto_produto = ${product.foto_produto}`;
        console.log(`Imagem local: item ${product.id_produto}`);
    }
} finally {
    await sql.end();
}
