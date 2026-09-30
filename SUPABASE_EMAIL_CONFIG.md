# Auth Emails (App-Owned via SMTP)

Signup confirmation and password-reset emails are **sent by the app itself** via
SMTP (Zoho) — not by Supabase. This guarantees the link is on the app domain
(`https://tracker.wellflex.co`) and that clicking it signs the user in.

## How it works

1. The browser posts to an app API route:
   - Sign up → `POST /api/auth/signup`
   - Resend confirmation → `POST /api/auth/resend-confirmation`
   - Forgot password → `POST /api/auth/forgot-password`
2. The route uses the Supabase **admin** API (`auth.admin.generateLink`) to mint a
   one-time `token_hash` **without** triggering Supabase's own email.
3. The route builds an **app-hosted** link and sends it through our SMTP
   (`lib/utils/email.ts` → nodemailer):
   - Confirm: `https://tracker.wellflex.co/auth/confirm?token_hash=…&type=email`
   - Resend:  `https://tracker.wellflex.co/auth/confirm?token_hash=…&type=magiclink`
   - Reset:   `https://tracker.wellflex.co/reset-password?token_hash=…&type=recovery`
4. Clicking the link opens the app page, which calls `supabase.auth.verifyOtp({ token_hash, type })`.
   That establishes a session — i.e. the user is **logged in** on click (confirm)
   or allowed to set a new password (reset).

Because we generate the links ourselves, **Supabase's "Site URL", "Redirect URLs",
and email templates are not used for these flows** and do not need to be configured.

## Required configuration

### 1. SMTP (used by the app's nodemailer transport)

Set these environment variables in **Vercel** (see `ZOHO_SMTP_SETUP.md` for Zoho
specifics). They are read in `lib/utils/email.ts`:

```
SMTP_HOST=smtp.zoho.com
SMTP_PORT=587
SMTP_USER=<your-zoho-mailbox>
SMTP_PASSWORD=<zoho-app-password>
SMTP_FROM_EMAIL=wetrack <noreply@wellflex.co>
```

If SMTP is not fully configured, the send functions log an error and return
`{ success: false }`; signup/resend surface a "could not send email" message.

### 2. App URL

```
NEXT_PUBLIC_APP_URL=https://tracker.wellflex.co
```

Read via `lib/utils/app-url.ts` (`getAppUrl()`). If missing in production it logs a
warning and falls back to `http://localhost:3000`, which would break links —
so make sure it is set in Vercel and **redeploy** after changing it.

### 3. Supabase

- The live project ref is `xhrdwouybvuzvbkhbjhk`
  (dashboard: https://supabase.com/dashboard/project/xhrdwouybvuzvbkhbjhk).
- `SUPABASE_SERVICE_ROLE_KEY` must be set (server-side only) — `generateLink`
  requires it.
- No email-template or URL changes are required for signup/reset/team invites.
  All three flows now use app-owned links and the app's SMTP transport.

## Testing

1. Set the env vars above in Vercel and redeploy.
2. Sign up with a real address → confirm the email arrives **from your Zoho sender**
   and the link is `https://tracker.wellflex.co/auth/confirm?...` (not `*.supabase.co`).
3. Click it → you should land on the app already signed in and be redirected to
   `/dashboard`.
4. Repeat for **Forgot password** → link should be
   `https://tracker.wellflex.co/reset-password?...`, and after setting a new password
   you're sent to `/login`.

## Team invites

Team invites (`/api/invites`) use the same app-owned pattern:

1. `auth.admin.generateLink({ type: 'invite' })` creates the one-time token without
   sending Supabase's default email.
2. The team/role assignment is stored temporarily in protected `app_metadata`.
3. WeTrack sends an SMTP email whose link points to
   `/auth/accept-invite?token_hash=…&type=invite`.
4. Opening the page does **not** consume the token. The user must explicitly click
   **Accept invitation**, which calls `verifyOtp` in the browser.
5. The authenticated browser then calls `POST /api/invites/accept`; that route
   assigns the team/role server-side from `app_metadata` and clears the pending
   invite metadata.

The explicit confirmation step is intentional: email-security scanners can safely
inspect the app-hosted URL without consuming Supabase's one-time auth token.
