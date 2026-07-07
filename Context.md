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

## Data & privacy
All tasks, meetings, and links are saved to your browser's `localStorage`,
scoped to whichever URL you're viewing. That means:
- Data lives in *your* browser only — nothing is sent to a server.
- Data is per-browser, per-device — it won't sync between your laptop and phone automatically.
- Clearing your browser's site data for this URL will erase it. Worth doing a manual export (copy the JSON from
  DevTools → Application → Local Storage) before big browser cleanups if you want a backup.
