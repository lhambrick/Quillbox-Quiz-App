-- ============================================================================
-- M4: Tier image URL for results page
-- Run AFTER 0003_m3.sql in Supabase SQL Editor. Safe to re-run.
-- ============================================================================

alter table public.result_tiers
  add column if not exists image_url text;
