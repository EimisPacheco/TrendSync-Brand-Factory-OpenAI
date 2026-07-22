-- Authenticated users may manage generated images in the public product bucket.
insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do update set public = true;

create policy "Authenticated users manage product images"
on storage.objects for all
to authenticated
using (bucket_id = 'product-images')
with check (bucket_id = 'product-images');
