# Shadad Split 2.0 — private cloud sync setup

Your website: https://osamagamal1911.github.io/osama2/shadad-tracker/

The website is already hosted on GitHub Pages. The cloud feature **will not connect until you provide a Supabase project**. It works as an offline workout tracker in the meantime.

## One-time setup (about 5 steps)

1. Create a free Supabase project at https://supabase.com/dashboard . Choose a strong database password and keep it private.
2. In Supabase **SQL Editor**, paste the complete contents of [supabase-schema.sql](./supabase-schema.sql), and run it. This creates a single private row per user, with Row Level Security (RLS) and an optimistic-concurrency API.
3. In **Authentication > Providers > Email**, keep email/password enabled. Keep email confirmation ON. For signup emails and password recovery, configure email delivery according to your Supabase plan; development email limits may apply.
4. In Supabase **Project Settings > API Keys**, copy your **Publishable key** (starts with `sb_publishable_`). From **Project Settings > API**, copy **Project URL** (e.g., `https://abcxyz.supabase.co`). Do not use `sb_secret_`, service_role, your DB password, or any personal access token.
5. Open the workout tracker in Chrome, go to **Settings > Cloud Sync**, enter the URL and publishable key, and save. Then register using your own email and password. Confirm your email, then sign in. To avoid re-entering settings on every device, you may put the same *public* URL and publishable key in [cloud-config.js](./cloud-config.js) and commit it to GitHub.

## First-time login

- A signed-in account has its **own locally cached data**, separate from anonymous workouts and other accounts.
- Old anonymous workouts are NOT uploaded without your permission. After login, press **Import guest workouts** to combine them with your private cloud history.
- Your workouts are saved locally immediately and synced in the background when online. Look for "Synced" in Settings.
- If your phone is offline, continue logging under your signed-in cached account and allow sync when online.
- On a new phone, configure the same project if necessary, sign in with the SAME email/password, and allow the app to load your sessions.

## Safety, limits & recovery

- SQL Row Level Security restricts each user to their own snapshot. No cloud secrets are published to GitHub.
- Online sync merges sessions by session ID and preserves explicit deletions through tombstones. If the exact same session is edited on two devices offline, the most recently modified version wins. Keep JSON exports as an independent backup.
- Each write checks the expected database revision, so concurrent writes are not silently overwritten. Pending writes retry after reconnect.
- Existing anonymous data remain in their original localStorage key; no migration deletes your current history.
- **JSON Backup** in Settings is recommended regularly, especially before changing phones. Browser data clearing can erase offline-only changes.
- "Delete ALL local data" operates on the currently displayed device copy; cloud data can reappear on sync. Delete your cloud account/data separately in Supabase if desired.
- Supabase's free-plan quota and email limits can change. See https://supabase.com/pricing .
- This app does not provide end-to-end encryption; the database service can process your workout history. The database is private to your signed-in account through RLS.
- Supabase project configuration is owned by you. GitHub Pages cannot supply a backend account for it.
