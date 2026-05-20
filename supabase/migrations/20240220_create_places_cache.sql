-- Create table to cache Google Places details
create table if not exists public.places_cache (
  place_id text primary key,
  name text,
  address text,
  phone text,
  rating numeric,
  photos jsonb,
  geometry jsonb,
  opening_hours jsonb,
  google_maps_url text,
  updated_at timestamp with time zone default timezone('utc'::text, now())
);

-- Enable RLS (optional for backend usage via service_role, but good practice)
alter table public.places_cache enable row level security;

-- Create policy to allow public read access (if needed by frontend directly, but backend will proxy)
create policy "Allow public read access" on public.places_cache for select using (true);

-- Create policy to allow authenticated/service_role insert/update
create policy "Allow service_role full access" on public.places_cache for all using (true) with check (true);
