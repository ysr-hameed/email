# SlyxUp Mail

Private Gmail-style mailbox for `slyxup.online`.

## Structure

- `backend/` Hono Cloudflare Worker with D1, R2, inbound Email Routing, and Brevo sending.
- `frontend/` React 19 + Vite + Tailwind 4 mailbox UI.
- `shared/` API types shared by both applications.

## Local setup

```bash
npm install
cp backend/.dev.vars.example backend/.dev.vars
# Set MAIL_ADMIN_PASSWORD_HASH and BREVO_API_KEY in backend/.dev.vars
npm run db:migrate:local
npm run dev:backend
npm run dev:frontend
```

Generate a password hash with:

```bash
node backend/scripts/hash-password.mjs "your-password"
```

The local UI runs at `http://localhost:5173` and the API at `http://localhost:8787`.

## Production setup

1. Create the D1, R2, and KV resources, then put their IDs in `backend/wrangler.jsonc`.
2. Set `MAIL_ADMIN_PASSWORD_HASH` and `BREVO_API_KEY` with `wrangler secret put`.
3. Apply the remote migration.
4. Deploy the Worker and Pages app.
5. Set the `slyxup.online` catch-all Email Routing rule to the `slyxup-email` Worker.

If Cloudflare DNS write access is unavailable, add these DNS records manually in the `slyxup.online` zone:

- `mail` CNAME to `mail-slyxup-online.pages.dev` (proxied)
- `mail-api` CNAME to the deployed Worker custom-domain target shown by Cloudflare (proxied)

See `backend/wrangler.jsonc` and `frontend/.env.example` for deployment domains.
