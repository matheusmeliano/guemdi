-- Create a storage bucket for place photos
insert into storage.buckets (id, name, public)
values ('place_photos', 'place_photos', true)
on conflict (id) do nothing;

-- Set up security policies for the storage bucket
-- Allow public read access to photos
create policy "Public Access"
on storage.objects for select
using ( bucket_id = 'place_photos' );

-- Allow authenticated users (service role) to upload photos
create policy "Authenticated Upload"
on storage.objects for insert
with check ( bucket_id = 'place_photos' );

-- Update the places_cache table to store the Supabase Storage URL instead of just the Google reference
alter table public.places_cache
add column if not exists photo_url text;
