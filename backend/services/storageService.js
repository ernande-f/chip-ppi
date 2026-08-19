import { randomUUID } from 'crypto';
import { supabaseAdmin } from '../supabase.js';

const BUCKET = 'product-images';
const SUPABASE_URL = process.env.SUPABASE_URL;

const MIME_MAP = { jpeg: 'jpg', jpg: 'jpg', png: 'png', webp: 'webp', gif: 'gif' };

/**
 * Faz upload de uma imagem em data-URL Base64 para o Supabase Storage
 * e retorna a URL pública permanente.
 */
export async function uploadProductImage(base64DataUrl) {
    const match = base64DataUrl.match(/^data:image\/(png|jpe?g|webp|gif);base64,(.+)$/i);

    if (!match) {
        throw new Error('Formato de imagem inválido. Envie PNG, JPEG, WebP ou GIF.');
    }

    const mimeSubtype = match[1].toLowerCase();
    const ext = MIME_MAP[mimeSubtype] || mimeSubtype;
    const buffer = Buffer.from(match[2], 'base64');
    const fileName = `${randomUUID()}.${ext}`;

    const { error } = await supabaseAdmin.storage
        .from(BUCKET)
        .upload(fileName, buffer, {
            contentType: `image/${mimeSubtype}`,
            upsert: false
        });

    if (error) {
        throw new Error(`Erro ao enviar imagem: ${error.message}`);
    }

    return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${fileName}`;
}

/**
 * Remove uma imagem do Supabase Storage pela sua URL pública.
 * Falhas silenciosas: se a imagem não existir, não levanta erro.
 */
export async function deleteProductImage(publicUrl) {
    if (!publicUrl || !publicUrl.includes(`/${BUCKET}/`)) {
        return;
    }

    const fileName = publicUrl.split(`${BUCKET}/`).pop();

    if (fileName) {
        await supabaseAdmin.storage.from(BUCKET).remove([fileName]);
    }
}

/**
 * Verifica se um valor é um data-URL Base64 de imagem (vs. uma URL HTTP já armazenada).
 */
export function isBase64DataUrl(value) {
    return typeof value === 'string' && value.startsWith('data:image/');
}
