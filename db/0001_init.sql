-- ============================================================================
-- Quiz/Assessment Multi-Tenant SaaS - Initial Schema
-- Run this in your Supabase SQL editor (SQL > New query > paste > Run).
-- Safe to re-run.
-- ============================================================================

create extension if not exists pgcrypto;

-- Enums -----------------------------------------------------------------------
do $$ begin
  create type collaborator_role as enum ('owner', 'editor', 'viewer');
exception when duplicate_object then null; end $$;

do $$ begin
  create type question_type as enum ('multiple_choice', 'fill_in');
exception when duplicate_object then null; end $$;

do $$ begin
  create type scoring_direction as enum ('asc', 'desc');
exception when duplicate_object then null; end $$;

do $$ begin
  create type tier_range_type as enum ('points', 'percent');
exception when duplicate_object then null; end $$;

-- Profiles --------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "Users read own profile" on public.profiles;
create policy "Users read own profile" on public.profiles
  for select using (auth.uid() = id);

drop policy if exists "Users update own profile" on public.profiles;
create policy "Users update own profile" on public.profiles
  for update using (auth.uid() = id);

drop policy if exists "Users insert own profile" on public.profiles;
create policy "Users insert own profile" on public.profiles
  for insert with check (auth.uid() = id);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', ''))
  on conflict (id) do nothing;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Quizzes ---------------------------------------------------------------------
create table if not exists public.quizzes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'Untitled Quiz',
  description text default '',
  slug text unique,
  is_published boolean not null default false,
  branding jsonb not null default '{}'::jsonb,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists quizzes_owner_idx on public.quizzes(owner_id);
create index if not exists quizzes_slug_idx on public.quizzes(slug);

-- Collaborators / Invites -----------------------------------------------------
create table if not exists public.quiz_collaborators (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid not null references public.quizzes(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role collaborator_role not null,
  invited_at timestamptz not null default now(),
  accepted_at timestamptz,
  unique (quiz_id, user_id)
);
create index if not exists quiz_collab_user_idx on public.quiz_collaborators(user_id);
create index if not exists quiz_collab_quiz_idx on public.quiz_collaborators(quiz_id);

create table if not exists public.quiz_invites (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid not null references public.quizzes(id) on delete cascade,
  email text not null,
  role collaborator_role not null,
  token text not null unique default encode(gen_random_bytes(24), 'hex'),
  expires_at timestamptz not null default (now() + interval '14 days'),
  created_at timestamptz not null default now()
);

-- Security definer helpers ---------------------------------------------------
create or replace function public.has_quiz_role(_quiz_id uuid, _user_id uuid, _roles collaborator_role[])
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.quizzes q where q.id = _quiz_id and q.owner_id = _user_id)
      or exists (
        select 1 from public.quiz_collaborators c
        where c.quiz_id = _quiz_id and c.user_id = _user_id
          and c.accepted_at is not null and c.role = any(_roles)
      );
$$;

create or replace function public.can_view_quiz(_quiz_id uuid, _user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_quiz_role(_quiz_id, _user_id, array['owner','editor','viewer']::collaborator_role[]);
$$;

create or replace function public.can_edit_quiz(_quiz_id uuid, _user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_quiz_role(_quiz_id, _user_id, array['owner','editor']::collaborator_role[]);
$$;

create or replace function public.is_quiz_owner(_quiz_id uuid, _user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.quizzes where id = _quiz_id and owner_id = _user_id);
$$;

-- RLS: quizzes ---------------------------------------------------------------
alter table public.quizzes enable row level security;

drop policy if exists "Owners and collaborators can view quizzes" on public.quizzes;
create policy "Owners and collaborators can view quizzes" on public.quizzes
  for select using (
    owner_id = auth.uid()
    or exists (
      select 1 from public.quiz_collaborators c
      where c.quiz_id = quizzes.id and c.user_id = auth.uid() and c.accepted_at is not null
    )
  );

drop policy if exists "Public can view published quizzes" on public.quizzes;
create policy "Public can view published quizzes" on public.quizzes
  for select using (is_published = true);

drop policy if exists "Owners insert quizzes" on public.quizzes;
create policy "Owners insert quizzes" on public.quizzes
  for insert with check (owner_id = auth.uid());

drop policy if exists "Editors update quizzes" on public.quizzes;
create policy "Editors update quizzes" on public.quizzes
  for update using (public.can_edit_quiz(id, auth.uid()));

drop policy if exists "Owners delete quizzes" on public.quizzes;
create policy "Owners delete quizzes" on public.quizzes
  for delete using (owner_id = auth.uid());

-- RLS: collaborators / invites ----------------------------------------------
alter table public.quiz_collaborators enable row level security;

drop policy if exists "View collaborators of quizzes I can view" on public.quiz_collaborators;
create policy "View collaborators of quizzes I can view" on public.quiz_collaborators
  for select using (user_id = auth.uid() or public.is_quiz_owner(quiz_id, auth.uid()));

drop policy if exists "Owners manage collaborators" on public.quiz_collaborators;
create policy "Owners manage collaborators" on public.quiz_collaborators
  for all using (public.is_quiz_owner(quiz_id, auth.uid()))
  with check (public.is_quiz_owner(quiz_id, auth.uid()));

alter table public.quiz_invites enable row level security;
drop policy if exists "Owners manage invites" on public.quiz_invites;
create policy "Owners manage invites" on public.quiz_invites
  for all using (public.is_quiz_owner(quiz_id, auth.uid()))
  with check (public.is_quiz_owner(quiz_id, auth.uid()));

-- Questions -----------------------------------------------------------------
create table if not exists public.questions (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid not null references public.quizzes(id) on delete cascade,
  type question_type not null,
  text text not null default '',
  order_index int not null default 0,
  scoring_direction scoring_direction default 'asc',
  options jsonb not null default '[]'::jsonb,
  keywords jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists questions_quiz_idx on public.questions(quiz_id, order_index);

alter table public.questions enable row level security;

drop policy if exists "View questions if can view quiz" on public.questions;
create policy "View questions if can view quiz" on public.questions
  for select using (
    public.can_view_quiz(quiz_id, auth.uid())
    or exists (select 1 from public.quizzes q where q.id = quiz_id and q.is_published = true)
  );

drop policy if exists "Editors manage questions" on public.questions;
create policy "Editors manage questions" on public.questions
  for all using (public.can_edit_quiz(quiz_id, auth.uid()))
  with check (public.can_edit_quiz(quiz_id, auth.uid()));

-- Result tiers --------------------------------------------------------------
create table if not exists public.result_tiers (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid not null references public.quizzes(id) on delete cascade,
  name text not null default 'Tier',
  min_value numeric not null default 0,
  max_value numeric not null default 100,
  range_type tier_range_type not null default 'percent',
  description text default '',
  cta_text text default '',
  order_index int not null default 0
);
create index if not exists tiers_quiz_idx on public.result_tiers(quiz_id, order_index);

alter table public.result_tiers enable row level security;

drop policy if exists "View tiers if can view quiz" on public.result_tiers;
create policy "View tiers if can view quiz" on public.result_tiers
  for select using (
    public.can_view_quiz(quiz_id, auth.uid())
    or exists (select 1 from public.quizzes q where q.id = quiz_id and q.is_published = true)
  );

drop policy if exists "Editors manage tiers" on public.result_tiers;
create policy "Editors manage tiers" on public.result_tiers
  for all using (public.can_edit_quiz(quiz_id, auth.uid()))
  with check (public.can_edit_quiz(quiz_id, auth.uid()));

-- Branding templates --------------------------------------------------------
create table if not exists public.branding_templates (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id) on delete cascade,
  name text not null,
  branding_config jsonb not null default '{}'::jsonb,
  is_stock boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.branding_templates enable row level security;
drop policy if exists "View own or stock templates" on public.branding_templates;
create policy "View own or stock templates" on public.branding_templates
  for select using (is_stock = true or owner_id = auth.uid());

drop policy if exists "Manage own templates" on public.branding_templates;
create policy "Manage own templates" on public.branding_templates
  for all using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- Submissions ---------------------------------------------------------------
create table if not exists public.submissions (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid not null references public.quizzes(id) on delete cascade,
  prospect_name text not null,
  prospect_email text not null,
  prospect_company text,
  custom_fields jsonb not null default '{}'::jsonb,
  total_score numeric not null default 0,
  max_score numeric not null default 0,
  percentage numeric not null default 0,
  tier_id uuid references public.result_tiers(id) on delete set null,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists submissions_quiz_idx on public.submissions(quiz_id, completed_at desc);

alter table public.submissions enable row level security;

drop policy if exists "View submissions if can view quiz" on public.submissions;
create policy "View submissions if can view quiz" on public.submissions
  for select using (public.can_view_quiz(quiz_id, auth.uid()));

drop policy if exists "Public insert submissions for published quizzes" on public.submissions;
create policy "Public insert submissions for published quizzes" on public.submissions
  for insert with check (
    exists (select 1 from public.quizzes q where q.id = quiz_id and q.is_published = true)
  );

drop policy if exists "Public update submissions for published quizzes" on public.submissions;
create policy "Public update submissions for published quizzes" on public.submissions
  for update using (
    exists (select 1 from public.quizzes q where q.id = quiz_id and q.is_published = true)
  ) with check (
    exists (select 1 from public.quizzes q where q.id = quiz_id and q.is_published = true)
  );

-- Submission answers --------------------------------------------------------
create table if not exists public.submission_answers (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions(id) on delete cascade,
  question_id uuid not null references public.questions(id) on delete cascade,
  answer_value text,
  points_earned numeric not null default 0
);
create index if not exists answers_submission_idx on public.submission_answers(submission_id);

alter table public.submission_answers enable row level security;

drop policy if exists "View answers if can view submission's quiz" on public.submission_answers;
create policy "View answers if can view submission's quiz" on public.submission_answers
  for select using (
    exists (
      select 1 from public.submissions s
      where s.id = submission_id and public.can_view_quiz(s.quiz_id, auth.uid())
    )
  );

drop policy if exists "Public insert answers for published quizzes" on public.submission_answers;
create policy "Public insert answers for published quizzes" on public.submission_answers
  for insert with check (
    exists (
      select 1 from public.submissions s
      join public.quizzes q on q.id = s.quiz_id
      where s.id = submission_id and q.is_published = true
    )
  );

-- Email provider configs (M2) -----------------------------------------------
create table if not exists public.email_provider_configs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  quiz_id uuid references public.quizzes(id) on delete cascade,
  provider text not null,
  api_key text,
  from_email text,
  from_name text,
  webhook_url text,
  notify_admin boolean not null default true,
  template_subject text,
  template_html text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.email_provider_configs enable row level security;
drop policy if exists "Owner manages email configs" on public.email_provider_configs;
create policy "Owner manages email configs" on public.email_provider_configs
  for all using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- Booking clicks (M2) -------------------------------------------------------
create table if not exists public.booking_clicks (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions(id) on delete cascade,
  clicked_at timestamptz not null default now()
);

alter table public.booking_clicks enable row level security;
drop policy if exists "Public can insert booking clicks" on public.booking_clicks;
create policy "Public can insert booking clicks" on public.booking_clicks
  for insert with check (true);

drop policy if exists "View booking clicks if can view quiz" on public.booking_clicks;
create policy "View booking clicks if can view quiz" on public.booking_clicks
  for select using (
    exists (
      select 1 from public.submissions s
      where s.id = submission_id and public.can_view_quiz(s.quiz_id, auth.uid())
    )
  );

-- Seed stock branding templates --------------------------------------------
insert into public.branding_templates (name, branding_config, is_stock)
select * from (values
  ('Professional Blue', '{"primary":"#2563eb","background":"#ffffff","fontColor":"#0f172a","fontFamily":"Inter","buttonStyle":"rounded","logoPosition":"top-left"}'::jsonb, true),
  ('Modern Dark',       '{"primary":"#8b5cf6","background":"#0b0b10","fontColor":"#f4f4f5","fontFamily":"Inter","buttonStyle":"pill","logoPosition":"top-left"}'::jsonb, true),
  ('Warm Earth',        '{"primary":"#b45309","background":"#fdf6ec","fontColor":"#3f2d1c","fontFamily":"Merriweather","buttonStyle":"rounded","logoPosition":"center"}'::jsonb, true),
  ('Minimal B/W',       '{"primary":"#111111","background":"#ffffff","fontColor":"#111111","fontFamily":"Inter","buttonStyle":"square","logoPosition":"top-left"}'::jsonb, true),
  ('Vibrant',           '{"primary":"#ec4899","background":"#fff7fb","fontColor":"#1f1147","fontFamily":"Poppins","buttonStyle":"pill","logoPosition":"center"}'::jsonb, true)
) as v(name, branding_config, is_stock)
where not exists (select 1 from public.branding_templates where is_stock = true);

-- updated_at trigger --------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

drop trigger if exists quizzes_touch on public.quizzes;
create trigger quizzes_touch before update on public.quizzes
for each row execute function public.touch_updated_at();
