CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE public.chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  text text NOT NULL,
  embedding vector(1536),
  source_doc_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.chunks TO service_role;
ALTER TABLE public.chunks ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.latency_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  query_text text,
  total_ms numeric,
  stt_ms numeric,
  retrieval_ms numeric,
  generation_ms numeric,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.latency_logs TO service_role;
ALTER TABLE public.latency_logs ENABLE ROW LEVEL SECURITY;

CREATE INDEX chunks_embedding_idx ON public.chunks
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

CREATE OR REPLACE FUNCTION public.match_chunks(query_embedding vector(1536), match_count int DEFAULT 5)
RETURNS TABLE (id uuid, text text, source_doc_id text, similarity float)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.id, c.text, c.source_doc_id, 1 - (c.embedding <=> query_embedding) AS similarity
  FROM public.chunks c
  WHERE c.embedding IS NOT NULL
  ORDER BY c.embedding <=> query_embedding
  LIMIT match_count;
$$;

REVOKE ALL ON FUNCTION public.match_chunks(vector, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.match_chunks(vector, int) TO service_role;