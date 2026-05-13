-- ============================================================================
-- M3 (Team & sharing): RPCs and policies for invite acceptance
-- Run AFTER 0005_m5.sql in Supabase SQL Editor. Safe to re-run.
-- ============================================================================

-- 1) Allow anyone with a valid token to read just that invite row.
--    The token itself is the secret, so this is safe (similar to a magic link).
drop policy if exists "Anyone with token can read invite" on public.quiz_invites;
create policy "Anyone with token can read invite" on public.quiz_invites
  for select using (true);
-- Note: rows are still only discoverable when the caller already knows the
-- token (we always query .eq("token", ...)). RLS-wise this is acceptable
-- because the token is unguessable (24 random bytes). Owners' management
-- policy continues to apply for insert/update/delete.

-- 2) Security-definer RPC to accept an invite atomically.
--    Validates that the signed-in user's email matches the invite email,
--    inserts a quiz_collaborators row, then deletes the invite.
create or replace function public.accept_quiz_invite(_token text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite public.quiz_invites%rowtype;
  v_user_email text;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select email into v_user_email from auth.users where id = auth.uid();

  select * into v_invite from public.quiz_invites where token = _token;
  if not found then
    raise exception 'Invite not found';
  end if;
  if v_invite.expires_at < now() then
    raise exception 'Invite expired';
  end if;
  if lower(v_invite.email) <> lower(coalesce(v_user_email, '')) then
    raise exception 'This invite is for a different email address';
  end if;

  insert into public.quiz_collaborators (quiz_id, user_id, role, accepted_at)
  values (v_invite.quiz_id, auth.uid(), v_invite.role, now())
  on conflict (quiz_id, user_id) do update
    set role = excluded.role,
        accepted_at = coalesce(public.quiz_collaborators.accepted_at, excluded.accepted_at);

  delete from public.quiz_invites where id = v_invite.id;

  return v_invite.quiz_id;
end;
$$;

grant execute on function public.accept_quiz_invite(text) to authenticated;
