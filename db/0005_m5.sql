-- ============================================================================
-- M5: Allow quiz owners/editors to delete submissions (and cascading answers)
-- Run AFTER 0004_m4.sql in Supabase SQL Editor. Safe to re-run.
-- ============================================================================

drop policy if exists "Owners can delete submissions" on public.submissions;
create policy "Owners can delete submissions" on public.submissions
  for delete using ( public.can_edit_quiz(quiz_id, auth.uid()) );
