-- Assist — Supabase schema
-- Run this in: Supabase Dashboard → SQL Editor → New query → paste → Run
-- Safe to re-run: every statement below is idempotent (IF NOT EXISTS /
-- CREATE OR REPLACE / DROP ... IF EXISTS), so running it again after you've
-- already run an earlier version won't error or duplicate anything.

-- Shared utility, used by both tables below to keep updated_at current —
-- defined first since the triggers further down depend on it existing.
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;


-- ── PROFILES ────────────────────────────────────────────────────────────
-- Real client profiles, separate from Supabase's internal auth.users table.
-- This is what actually gets shown/edited on the client's Profile page —
-- name, phone, etc. — versioned and queryable like any other app data.
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text,
  email       text,
  phone       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "Users can view own profile" on public.profiles;
create policy "Users can view own profile"
  on public.profiles for select
  using (auth.uid() = id);

drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can update own profile"
  on public.profiles for update
  using (auth.uid() = id);

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- The actual fix: this trigger fires the instant a new user is created in
-- auth.users — whether they signed up via Google, email, or any other
-- provider — and inserts a matching row into public.profiles. A real
-- profile is created server-side, in the database itself, the moment
-- someone signs in for the first time. It does not depend on frontend JS
-- running correctly, unlike a client-side "upsert after login" approach.
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, full_name, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'),
    new.email
  )
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill: if anyone already signed in before this trigger existed
-- (e.g. while you were testing Google sign-in earlier), this creates
-- their missing profile row retroactively.
insert into public.profiles (id, full_name, email)
select u.id,
       coalesce(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name'),
       u.email
from auth.users u
left join public.profiles p on p.id = u.id
where p.id is null;


-- ── ORDERS ──────────────────────────────────────────────────────────────
create table if not exists public.orders (
  id                    text primary key,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  status                text not null default 'new'
                          check (status in ('new','in_progress','completed','cancelled')),
  client_id             uuid references auth.users(id) on delete set null,
  first_name            text not null,
  last_name             text not null,
  email                 text not null,
  whatsapp              text,
  service               text not null,
  level                 text,
  deadline              text,
  budget                text,
  details               text,
  admin_notes           text,
  quoted_price          text,
  estimated_completion  timestamptz
);

create index if not exists orders_client_id_idx on public.orders (client_id);
create index if not exists orders_status_idx    on public.orders (status);
create index if not exists orders_created_at_idx on public.orders (created_at desc);

-- Row Level Security: ON, but with no public policies.
-- Your Express backend talks to this table using the service_role key,
-- which bypasses RLS entirely — that's intentional, it's how the admin
-- dashboard and order-creation flow are meant to work.
-- Clients never query this table directly from the browser; they go
-- through your backend's /api/my/orders endpoint, which checks their
-- identity server-side. RLS here is a safety net in case that ever changes.
alter table public.orders enable row level security;

drop trigger if exists orders_set_updated_at on public.orders;
create trigger orders_set_updated_at
  before update on public.orders
  for each row execute function public.set_updated_at();
