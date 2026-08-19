-- Bucket público para fotos de produtos (imagens acessíveis sem autenticação).
INSERT INTO storage.buckets (id, name, public)
VALUES ('product-images', 'product-images', true)
ON CONFLICT (id) DO NOTHING;

-- Qualquer utilizador pode ler imagens do bucket público.
CREATE POLICY "Acesso público de leitura"
    ON storage.objects FOR SELECT
    USING (bucket_id = 'product-images');

-- Apenas o backend (service_role) pode inserir, atualizar e deletar imagens.
CREATE POLICY "Upload apenas via backend"
    ON storage.objects FOR INSERT
    WITH CHECK (bucket_id = 'product-images');

CREATE POLICY "Update apenas via backend"
    ON storage.objects FOR UPDATE
    USING (bucket_id = 'product-images');

CREATE POLICY "Delete apenas via backend"
    ON storage.objects FOR DELETE
    USING (bucket_id = 'product-images');
