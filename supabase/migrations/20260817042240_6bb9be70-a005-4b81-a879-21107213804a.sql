REVOKE EXECUTE ON FUNCTION public.match_chunks(vector, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.match_chunks(vector, integer) TO service_role;