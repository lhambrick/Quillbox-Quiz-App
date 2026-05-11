-- ============================================================================
-- M3 follow-up: SECURITY DEFINER RPCs to fetch email-render payloads
-- so the app can send Resend emails from a TanStack server route without
-- needing the SUPABASE_SERVICE_ROLE_KEY. Safe to re-run.
-- ============================================================================

-- Returns everything needed to render & send a quiz-result email for a given
-- submission. Allowed for anyone (the public quiz page is anon).
-- Only returns rows where the quiz is published (or you own/edit it).
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
  if not found then
    raise exception 'Submission not found';
  end if;

  select * into v_quiz from public.quizzes where id = v_sub.quiz_id;
  if not found then
    raise exception 'Quiz not found';
  end if;

  -- Only allow if quiz is published OR caller can edit/own it.
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

  -- Prefer quiz-specific config, fall back to owner default.
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

-- Returns the invite payload + sender config so an authenticated owner can
-- email the invite link. Caller must own the quiz.
create or replace function public.get_invite_email_payload(_invite_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inv record;
  v_quiz record;
  v_cfg record;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_inv from public.quiz_invites where id = _invite_id;
  if not found then
    raise exception 'Invite not found';
  end if;

  select * into v_quiz from public.quizzes where id = v_inv.quiz_id;
  if v_quiz.owner_id <> auth.uid() then
    raise exception 'Not the quiz owner';
  end if;

  select * into v_cfg
  from public.email_provider_configs
  where provider = 'resend'
    and (quiz_id = v_quiz.id or (owner_id = v_quiz.owner_id and quiz_id is null))
  order by (quiz_id is not null) desc
  limit 1;

  return jsonb_build_object(
    'invite', to_jsonb(v_inv),
    'quiz', jsonb_build_object('id', v_quiz.id, 'title', v_quiz.title, 'branding', v_quiz.branding),
    'config', case when v_cfg.id is null then null else jsonb_build_object(
      'api_key', v_cfg.api_key,
      'from_email', v_cfg.from_email,
      'from_name', v_cfg.from_name
    ) end
  );
end;
$$;

grant execute on function public.get_invite_email_payload(uuid) to authenticated;
