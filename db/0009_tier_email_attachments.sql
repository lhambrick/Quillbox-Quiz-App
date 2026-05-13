-- ============================================================================
-- Per-tier email attachments. Stored as a JSONB array of
-- { filename: text, url: text } objects. Files live in the existing
-- `quiz-assets` public bucket (any uploader's own folder).
-- Safe to re-run.
-- ============================================================================

alter table public.result_tiers
  add column if not exists email_attachments jsonb not null default '[]'::jsonb;

-- Update the email payload RPC to include tier attachments.
create or replace function public.get_quiz_result_email_payload(_submission_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sub record;
  v_quiz record;
  v_tier record;
  v_cfg record;
begin
  select * into v_sub from public.submissions where id = _submission_id;
  if not found then raise exception 'Submission not found'; end if;

  select * into v_quiz from public.quizzes where id = v_sub.quiz_id;
  if not found then raise exception 'Quiz not found'; end if;

  if not (
    v_quiz.is_published
    or v_quiz.owner_id = auth.uid()
    or exists (
      select 1 from public.quiz_collaborators c
      where c.quiz_id = v_quiz.id and c.user_id = auth.uid()
    )
  ) then
    raise exception 'Not authorized';
  end if;

  if v_sub.tier_id is not null then
    select * into v_tier from public.result_tiers where id = v_sub.tier_id;
  end if;

  select * into v_cfg
  from public.email_provider_configs
  where provider = 'resend'
    and (quiz_id = v_quiz.id or (owner_id = v_quiz.owner_id and quiz_id is null))
  order by (quiz_id is not null) desc
  limit 1;

  return jsonb_build_object(
    'submission', to_jsonb(v_sub),
    'quiz', to_jsonb(v_quiz),
    'tier', to_jsonb(v_tier),
    'config', case when v_cfg.id is null then null else jsonb_build_object(
      'api_key', v_cfg.api_key,
      'from_email', v_cfg.from_email,
      'from_name', v_cfg.from_name
    ) end
  );
end;
$$;

grant execute on function public.get_quiz_result_email_payload(uuid) to anon, authenticated;
