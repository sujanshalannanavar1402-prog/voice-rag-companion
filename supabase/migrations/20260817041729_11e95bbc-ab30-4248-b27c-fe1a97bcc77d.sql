ALTER TABLE public.latency_logs
  ADD COLUMN IF NOT EXISTS refused boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS refusal_reason text,
  ADD COLUMN IF NOT EXISTS grounded boolean;