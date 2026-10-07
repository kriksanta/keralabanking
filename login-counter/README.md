# Shared login counter

This Worker provides shared active-browser and total-login counts for the static GitHub Pages app. It checks login credentials on the server, stores only an aggregate login total and random session IDs, and marks browsers active while they send a heartbeat every 30 seconds. A browser is considered offline after 90 seconds without a heartbeat.

## Deploy

From the repository root in PowerShell:

```powershell
npx wrangler login
npx wrangler secret put CASH_TOOLS_USERNAME --config login-counter/wrangler.toml
npx wrangler secret put CASH_TOOLS_PASSWORD --config login-counter/wrangler.toml
npx wrangler deploy --config login-counter/wrangler.toml
```

Enter the existing application username and password at the Wrangler prompts. Do not put those values in files or commands. Deployment prints a `workers.dev` URL. Set that URL in `LOGIN_COUNTER_API` in `index.html`, then commit and push the app update. Until the endpoint is configured, the existing local login remains available but shared counts stay disconnected.

If the site moves off `https://kriksanta.github.io`, change `ALLOWED_ORIGIN` in `wrangler.toml` to the exact website origin and redeploy. The Worker stores no usernames or passwords; credentials are Wrangler secrets.
