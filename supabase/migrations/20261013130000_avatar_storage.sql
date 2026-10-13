-- The avatar a user builds (colour, hat, shirt) already has a home in
-- users.avatar. The head photo they can upload did not: it lived in browser
-- memory and was gone on reload. It goes in a Storage bucket and
-- users.avatar_path points at it, so every endpoint that lists people carries
-- a short path instead of an image.
--
-- The bucket is public: reads go through the public object URL and need no
-- policy. Writes come straight from the browser with the caller's session
-- (supabase-js), so storage RLS is the whole boundary — you may only touch
-- objects under a folder named after your own user id.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 1048576, array['image/webp', 'image/png', 'image/jpeg'])
on conflict (id) do nothing;

create policy avatars_insert_own on storage.objects
for insert to authenticated
with check (
  bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text
);

-- select is what lets the owner delete (and list) their old photos; everyone
-- else reads through the public URL, which bypasses this
create policy avatars_select_own on storage.objects
for select to authenticated
using (
  bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy avatars_delete_own on storage.objects
for delete to authenticated
using (
  bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text
);
