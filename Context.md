# Control Centre

A personal PM dashboard: weekly meeting schedule, task console across 4 themes,
Google Calendar embed, and quick links to your docs/sheets. No build step —
React and JSX are loaded and compiled in the browser, so you can edit `app.jsx`
directly and just refresh to see changes locally, or push to deploy.

## Files
- `index.html` — the page shell. Loads React, ReactDOM, and Babel from a CDN, then loads `app.jsx`.
- `app.jsx` — the entire dashboard as a React component. This is the file you'll edit most.
- `styles.css` — all visual styling / design tokens.

## Running locally
Because `index.html` fetches `app.jsx` at runtime, opening the file directly
(`file://...`) will be blocked by the browser's CORS rules. Serve it instead:

```bash
# from inside the project folder
python3 -m http.server 8000
# or: npx serve .
```

Then open `http://localhost:8000`.

## Deploying with GitHub Pages
1. Create a new repository on GitHub (e.g. `control-centre`).
2. Add these three files (`index.html`, `app.jsx`, `styles.css`) to the repo root and push:
   ```bash
   git init
   git add index.html app.jsx styles.css
   git commit -m "Initial control centre"
   git branch -M main
   git remote add origin https://github.com/<your-username>/control-centre.git
   git push -u origin main
   ```
3. On GitHub: **Settings → Pages → Build and deployment → Source: Deploy from a branch**, then pick `main` and `/ (root)`, and save.
4. GitHub will publish it at `https://<your-username>.github.io/control-centre/` within a minute or two.

## Making changes going forward
Edit `app.jsx` (and `styles.css` for visual tweaks), commit, and push:
```bash
git add -A
git commit -m "Describe what changed"
git push
```
GitHub Pages redeploys automatically on every push to `main` — no separate build/deploy step needed.

## Accounts & storage (Supabase)

The app now requires signing in with an email + one-time code before use, and
data is stored in a Supabase project instead of the browser — that's what
makes it safe to share the same deployed link with other people.

### One-time setup
1. Create a free project at [supabase.com](https://supabase.com).
2. Open the SQL Editor and run everything in `supabase_setup.sql` (included in this repo) —
   it creates the `app_state` table and the row-level security policies that keep
   each person's data private to them.
3. Authentication → Email Templates → Magic Link: replace `{{ .ConfirmationURL }}`
   with `{{ .Token }}` so the email sends a 6-digit code instead of a clickable link.
4. Authentication → URL Configuration: set Site URL (and add to Redirect URLs)
   to your GitHub Pages URL.
5. Project Settings → API: copy the **Project URL** and **`anon` `public`** key.
6. Paste both into `config.js` in this repo, commit, and push.

### How data & privacy work now
- Each person signs in with their own email and gets their **own private data** —
  not a shared pool. Nobody can read or write another user's row; that's enforced
  by the database itself (Row Level Security), not just by the app's UI.
- The `anon` key in `config.js` is meant to be public — it's safe to commit even
  in a public repo. It only grants what the database's RLS policies allow.
- If you ever need to wipe your own data, the cleanest way is deleting your row from the
  `app_state` table in the Supabase Table Editor (Authentication → Users to also remove the account).
