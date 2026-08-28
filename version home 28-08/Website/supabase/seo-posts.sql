-- ArenaCue website: wekelijkse AI SEO-artikels
-- Run dit in Supabase SQL Editor.

create table if not exists public.seo_posts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  published_at timestamptz not null default now(),
  week_key text not null unique,
  slug text not null unique,
  title text not null,
  excerpt text not null,
  meta_description text not null,
  keywords text[] not null default '{}',
  content_json jsonb not null,
  status text not null default 'published',
  model text,
  source text not null default 'ai-cron',
  constraint seo_posts_status_check check (status in ('draft', 'published', 'archived')),
  constraint seo_posts_slug_check check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);

alter table public.seo_posts add column if not exists published_at timestamptz not null default now();
alter table public.seo_posts add column if not exists week_key text;
alter table public.seo_posts add column if not exists slug text;
alter table public.seo_posts add column if not exists title text;
alter table public.seo_posts add column if not exists excerpt text;
alter table public.seo_posts add column if not exists meta_description text;
alter table public.seo_posts add column if not exists keywords text[] not null default '{}';
alter table public.seo_posts add column if not exists content_json jsonb;
alter table public.seo_posts add column if not exists status text not null default 'published';
alter table public.seo_posts add column if not exists model text;
alter table public.seo_posts add column if not exists source text not null default 'ai-cron';

create unique index if not exists seo_posts_week_key_unique on public.seo_posts (week_key);
create unique index if not exists seo_posts_slug_unique on public.seo_posts (slug);
create index if not exists seo_posts_published_idx on public.seo_posts (published_at desc);
create index if not exists seo_posts_status_idx on public.seo_posts (status);

alter table public.seo_posts enable row level security;

drop policy if exists "Anyone can read published seo posts" on public.seo_posts;
create policy "Anyone can read published seo posts"
on public.seo_posts
for select
to anon
using (
  status = 'published'
  and published_at <= now()
);
