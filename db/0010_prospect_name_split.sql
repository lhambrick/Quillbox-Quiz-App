-- ============================================================================
-- Split prospect_name into first/last and add results_display to email payload
-- so the result email can render the score the same way as the results page.
-- Safe to re-run.
-- ============================================================================

alter table public.submissions
  add column if not exists prospect_first_name text,
  add column if not exists prospect_last_name  text;

-- Backfill from prospect_name where possible (first token = first name, rest = last).
update public.submissions
   set prospect_first_name = split_part(prospect_name, ' ', 1),
       prospect_last_name  = nullif(regexp_replace(prospect_name, '^\S+\s*', ''), '')
 where prospect_first_name is null
   and prospect_name is not null;

-- Re-create payload RPC to include quiz.settings.results_display in the
-- returned `quiz` object (already inside to_jsonb(v_quiz)) — nothing to do
-- since we already return to_jsonb(v_quiz). This migration exists mostly to
-- add the new columns; the email function reads settings directly.
