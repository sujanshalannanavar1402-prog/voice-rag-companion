REVOKE EXECUTE ON FUNCTION public.match_chunks(vector, int) FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.match_chunks(vector, int) TO service_role;