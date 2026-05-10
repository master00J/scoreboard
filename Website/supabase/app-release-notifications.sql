-- ArenaCue website: verzonden desktop release-notificaties
-- Run dit in Supabase SQL Editor.

create table if not exists public.app_release_notifications (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  started_at timestamptz not null default now(),
  sent_at timestamptz,
  version text not null unique,
  status text not null default 'sending',
  release_payload jsonb,
  recipient_count integer not null default 0,
  sent integer not null default 0,
  failed integer not null default 0,
  errors jsonb,
  constraint app_release_notifications_version_check check (length(trim(version)) between 1 and 64),
  constraint app_release_notifications_status_check check (status in ('sending', 'sent', 'failed')),
  constraint app_release_notifications_counts_check check (
    recipient_count >= 0
    and sent >= 0
    and failed >= 0
  )
);

alter table public.app_release_notifications enable row level security;

create index if not exists app_release_notifications_created_at_idx
on public.app_release_notifications (created_at desc);

create index if not exists app_release_notifications_status_idx
on public.app_release_notifications (status);
