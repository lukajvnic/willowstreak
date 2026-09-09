# site — auth test harness

A deliberately unstyled React app for exercising signup/login against Supabase
Auth and profile creation against the FastAPI backend. Not the product; that's
`web-app/`.

```bash
npm install
npm run dev          # http://localhost:5173
```

Port 5173 is fixed on purpose — it is the origin already listed in the
backend's `BACKEND_CORS_ORIGINS`. The backend must be running on 8001.

`.env` is generated from `backend/.env` (project URL + publishable key only).

## What it does

Mirrors the split the backend README describes: Supabase Auth owns the
credential, this API owns the profile row.

1. **Sign up** — `supabase.auth.signUp({email, password})`, then
   `POST /api/me {username, first_name, last_name}` with the returned token.
   If email confirmation is on, `signUp` returns no session, so step 2 is
   deferred to the next login.
2. **Log in** — `signInWithPassword`, then `GET /api/me`.
3. **404 on `GET /api/me`** is not a failure — it means an auth user exists with
   no profile row, so the app shows a username picker. This is the path a
   confirmation-email signup takes, and it's worth testing directly.

Every API call and auth event is appended to an on-page log with the raw
response body, which is the actual point of this app.

## Username vs email

The login form takes an **email**, because that's what Supabase Auth
authenticates on. Usernames live in the profiles table, and resolving one to an
email would need a public lookup endpoint that doesn't exist (and would leak
which emails are registered). Username-as-login needs a deliberate backend
decision first.
