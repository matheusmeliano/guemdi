-- Tabela de Cache de Distâncias (Distance Matrix)
-- Guarda as distâncias calculadas entre uma origem (latitude/longitude arredondada) e um destino (place_id)

CREATE TABLE IF NOT EXISTS public.distance_cache (
    id UUID DEFAULT extensions.uuid_generate_v4() PRIMARY KEY,
    origin_key VARCHAR(50) NOT NULL, -- Ex: "-23.550,-46.633" (arredondado para 3 casas decimais)
    destination_place_id VARCHAR(255) NOT NULL, -- O place_id do Google do destino
    distance_value INTEGER NOT NULL, -- Distância em metros retornada pela API
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    
    -- Criar restrição única para evitar duplicatas da mesma rota
    CONSTRAINT unique_route UNIQUE (origin_key, destination_place_id)
);

-- Criar índices para busca rápida
CREATE INDEX IF NOT EXISTS idx_distance_cache_origin ON public.distance_cache(origin_key);
CREATE INDEX IF NOT EXISTS idx_distance_cache_destination ON public.distance_cache(destination_place_id);

-- Configurar RLS (Row Level Security) para permitir acesso anônimo (leitura e gravação) do servidor
ALTER TABLE public.distance_cache ENABLE ROW LEVEL SECURITY;

-- Política para permitir que o servidor (Service Role) faça tudo
CREATE POLICY "Enable all operations for service role" 
ON public.distance_cache 
FOR ALL 
USING (true) 
WITH CHECK (true);
