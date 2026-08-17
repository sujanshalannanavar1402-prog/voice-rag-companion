ALTER TABLE public.chunks
  ADD COLUMN IF NOT EXISTS chunk_strategy text NOT NULL DEFAULT 'fixed_overlap',
  ADD COLUMN IF NOT EXISTS parent_text text;

CREATE INDEX IF NOT EXISTS chunks_chunk_strategy_idx ON public.chunks (chunk_strategy);

DROP FUNCTION IF EXISTS public.match_chunks(vector, integer);

CREATE OR REPLACE FUNCTION public.match_chunks(query_embedding vector, match_count integer DEFAULT 5)
RETURNS TABLE(id uuid, text text, source_doc_id text, chunk_strategy text, parent_text text, similarity double precision)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT c.id, c.text, c.source_doc_id, c.chunk_strategy, c.parent_text,
         1 - (c.embedding <=> query_embedding) AS similarity
  FROM public.chunks c
  WHERE c.embedding IS NOT NULL
  ORDER BY c.embedding <=> query_embedding
  LIMIT match_count;
$function$;