-- ============================================================================
-- M3: Category descriptions, owner-test submissions, "Other" free-text option
-- Run AFTER 0002_m2.sql in Supabase SQL Editor. Safe to re-run.
-- ============================================================================

-- 1) Allow a new question type 'category_description' (informational section)
do $$ begin
  alter type question_type add value if not exists 'category_description';
exception when duplicate_object then null; end $$;

-- 2) Allow quiz owners (and editors) to insert submissions / answers even when
--    the quiz isn't published yet. This lets creators test their quiz end-to-end
--    from the editor preview without flipping the published flag.
drop policy if exists "Owners can insert test submissions" on public.submissions;
create policy "Owners can insert test submissions" on public.submissions
  for insert with check (
    public.can_edit_quiz(quiz_id, auth.uid())
  );

drop policy if exists "Owners can insert test answers" on public.submission_answers;
create policy "Owners can insert test answers" on public.submission_answers
  for insert with check (
    exists (
      select 1 from public.submissions s
      where s.id = submission_id
        and public.can_edit_quiz(s.quiz_id, auth.uid())
    )
  );
