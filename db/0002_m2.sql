-- ============================================================================
-- M2: Branding assets storage, per-tier email templates, booking redirect
-- Run this AFTER 0001_init.sql in your Supabase SQL editor. Safe to re-run.
-- ============================================================================

-- 1) Per-tier email template overrides ---------------------------------------
alter table public.result_tiers
  add column if not exists email_subject text,
  add column if not exists email_intro text,
  add column if not exists email_body text;

-- 2) Storage bucket for quiz assets (logos) ----------------------------------
insert into storage.buckets (id, name, public)
values ('quiz-assets', 'quiz-assets', true)
on conflict (id) do nothing;

-- Public read of quiz-assets
drop policy if exists "Public read quiz-assets" on storage.objects;
create policy "Public read quiz-assets" on storage.objects
  for select using (bucket_id = 'quiz-assets');

-- Authenticated users can upload to a folder named with their user id
drop policy if exists "Users upload to own folder in quiz-assets" on storage.objects;
create policy "Users upload to own folder in quiz-assets" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'quiz-assets'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Users update own folder in quiz-assets" on storage.objects;
create policy "Users update own folder in quiz-assets" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'quiz-assets'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Users delete own folder in quiz-assets" on storage.objects;
create policy "Users delete own folder in quiz-assets" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'quiz-assets'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
