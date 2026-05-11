-- ============================================================================
-- Allow quiz collaborators (Editors/Viewers) to READ the quiz's email
-- provider config so the Email tab shows the same info for everyone on the
-- project. Only the owner can still INSERT/UPDATE/DELETE.
-- Safe to re-run.
-- ============================================================================

alter table public.email_provider_configs enable row level security;

drop policy if exists "Collaborators read email configs" on public.email_provider_configs;
create policy "Collaborators read email configs" on public.email_provider_configs
  for select
  using (
    owner_id = auth.uid()
    or (
      quiz_id is not null
      and exists (
        select 1 from public.quiz_collaborators c
        where c.quiz_id = email_provider_configs.quiz_id
          and c.user_id = auth.uid()
      )
    )
    or (
      quiz_id is not null
      and exists (
        select 1 from public.quizzes q
        where q.id = email_provider_configs.quiz_id
          and q.owner_id = auth.uid()
      )
    )
  );

-- Allow editors to update (but not insert/delete) the per-quiz config.
drop policy if exists "Editors update email configs" on public.email_provider_configs;
create policy "Editors update email configs" on public.email_provider_configs
  for update
  using (
    quiz_id is not null
    and exists (
      select 1 from public.quiz_collaborators c
      where c.quiz_id = email_provider_configs.quiz_id
        and c.user_id = auth.uid()
        and c.role = 'editor'
    )
  )
  with check (
    quiz_id is not null
    and exists (
      select 1 from public.quiz_collaborators c
      where c.quiz_id = email_provider_configs.quiz_id
        and c.user_id = auth.uid()
        and c.role = 'editor'
    )
  );
