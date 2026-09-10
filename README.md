# SlyxUp Mail

Private Gmail-style mailbox for `slyxup.online`.

## Structure

- `backend/` Hono Cloudflare Worker with D1, R2, inbound Email Routing, and Brevo sending.
- `frontend/` React 19 + Vite + Tailwind 4 mailbox UI, deployed as Worker Static Assets.
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
4. Deploy the API Worker and the frontend Static Assets Worker.
5. Set the `slyxup.online` catch-all Email Routing rule to the `slyxup-email` Worker.

See `backend/wrangler.jsonc` and `frontend/.env.example` for deployment domains.

## Move Email Routing to another domain

Replace `newdomain.com` with the Cloudflare zone you want to use:

```bash
wrangler email routing enable newdomain.com
wrangler email routing rules update newdomain.com catch-all \
  --enabled true --action-type worker --action-value slyxup-email
wrangler email sending enable newdomain.com
```

Then update `MAIL_DOMAIN` in `backend/wrangler.jsonc`, deploy the backend, and add each sender in Brevo. Update `FRONTEND_ORIGIN` if the web app also moves. If the API hostname moves, update `frontend/.env.production` before rebuilding the frontend.
