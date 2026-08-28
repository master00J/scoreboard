-- ArenaCue website: demo-aanvragen
-- Run dit in Supabase SQL Editor.

create table if not exists public.demo_requests (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text not null,
  email text not null,
  club text not null,
  phone text,
  message text,
  source text not null default 'website',
  status text not null default 'new',
  constraint demo_requests_email_check check (position('@' in email) > 1),
  constraint demo_requests_status_check check (status in ('new', 'contacted', 'qualified', 'closed'))
);

alter table public.demo_requests enable row level security;

drop policy if exists "Anyone can submit demo requests" on public.demo_requests;

create policy "Anyone can submit demo requests"
on public.demo_requests
for insert
to anon
with check (
  source = 'website'
  and length(trim(name)) >= 2
  and length(trim(email)) >= 5
  and length(trim(club)) >= 2
);

create index if not exists demo_requests_created_at_idx
on public.demo_requests (created_at desc);

create index if not exists demo_requests_status_idx
on public.demo_requests (status);

-- Licenties: zie ook licenses.sql (tabellen licenses + license_installations).
