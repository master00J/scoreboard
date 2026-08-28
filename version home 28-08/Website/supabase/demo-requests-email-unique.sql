-- Één demo-aanvraag per e-mailadres (race-safe naast API-validatie).
-- Voer uit in Supabase SQL Editor. Als de index faalt: verwijder eerst dubbele rijen met hetzelfde lower(email).

create unique index if not exists demo_requests_email_lower_uidx
on public.demo_requests (lower(email));
