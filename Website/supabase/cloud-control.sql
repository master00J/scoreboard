-- ArenaCue cloud control relay
-- Run dit in Supabase SQL Editor.

create table if not exists public.control_state (
  venue_id text primary key,
  state_json jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.control_commands (
  id uuid primary key default gen_random_uuid(),
  venue_id text not null,
  command jsonb not null,
  status text not null default 'pending',
  error_message text,
  result_json jsonb,
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  constraint control_commands_status_check check (status in ('pending', 'done', 'failed'))
);

create index if not exists control_commands_lookup_idx
on public.control_commands (venue_id, status, created_at);

alter table public.control_state enable row level security;
alter table public.control_commands enable row level security;

-- Alles via server-side service role (Next API), geen anon policies voorzien.
