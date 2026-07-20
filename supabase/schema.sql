-- Assist — Supabase schema
-- Run this once in: Supabase Dashboard → SQL Editor → New query → paste → Run

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

-- Keep updated_at fresh automatically on any row change
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists orders_set_updated_at on public.orders;
create trigger orders_set_updated_at
  before update on public.orders
  for each row execute function public.set_updated_at();
