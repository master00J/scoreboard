-- ArenaCue website: reviews
-- Run dit in Supabase SQL Editor.

create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text not null,
  club text not null,
  role text,
  rating int not null default 5,
  quote text not null,
  status text not null default 'new',
  source text not null default 'website',
  constraint reviews_rating_check check (rating between 1 and 5),
  constraint reviews_status_check check (status in ('new', 'pending', 'published', 'approved', 'rejected'))
);

-- Bestaande tabellen upgraden (als reviews eerder al zonder deze kolommen bestond).
alter table public.reviews add column if not exists name text;
alter table public.reviews add column if not exists club text;
alter table public.reviews add column if not exists role text;
alter table public.reviews add column if not exists rating int not null default 5;
alter table public.reviews add column if not exists quote text;
alter table public.reviews add column if not exists status text not null default 'new';
alter table public.reviews add column if not exists source text not null default 'website';

-- Legacy kolomnamen (bv. naam/tekst) automatisch overzetten indien aanwezig.
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public' and table_name = 'reviews' and column_name = 'naam'
  ) then
    execute 'update public.reviews set name = coalesce(name, naam) where name is null';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public' and table_name = 'reviews' and column_name = 'clubnaam'
  ) then
    execute 'update public.reviews set club = coalesce(club, clubnaam) where club is null';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public' and table_name = 'reviews' and column_name = 'tekst'
  ) then
    execute 'update public.reviews set quote = coalesce(quote, tekst) where quote is null';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public' and table_name = 'reviews' and column_name = 'functie'
  ) then
    execute 'update public.reviews set role = coalesce(role, functie) where role is null';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public' and table_name = 'reviews' and column_name = 'score'
  ) then
    execute 'update public.reviews set rating = coalesce(rating, score) where rating is null';
  end if;
end $$;

-- Verplichte velden afdwingen na migratie
update public.reviews set name = 'Onbekend' where name is null or length(trim(name)) = 0;
update public.reviews set club = 'Onbekend' where club is null or length(trim(club)) = 0;
update public.reviews set quote = 'Geen reviewtekst opgegeven.' where quote is null or length(trim(quote)) = 0;

alter table public.reviews alter column name set not null;
alter table public.reviews alter column club set not null;
alter table public.reviews alter column quote set not null;

alter table public.reviews enable row level security;

drop policy if exists "Anyone can submit reviews" on public.reviews;
create policy "Anyone can submit reviews"
on public.reviews
for insert
to anon
with check (
  source = 'website'
  and status::text in ('new', 'pending')
  and length(trim(name)) >= 2
  and length(trim(club)) >= 2
  and length(trim(quote)) >= 20
);

drop policy if exists "Anyone can read published reviews" on public.reviews;
create policy "Anyone can read published reviews"
on public.reviews
for select
to anon
using (status = 'published');
-- Compatibiliteit: sommige oude opzetten gebruiken 'approved' i.p.v. 'published'
drop policy if exists "Anyone can read approved reviews" on public.reviews;
create policy "Anyone can read approved reviews"
on public.reviews
for select
to anon
using (status::text = 'approved');

create index if not exists reviews_created_at_idx
on public.reviews (created_at desc);

create index if not exists reviews_status_idx
on public.reviews (status);
