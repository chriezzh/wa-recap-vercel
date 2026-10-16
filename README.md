# WA Chat Recap

Upload a WhatsApp `.txt` chat export and get a per-topic recap (decisions, open items, next steps).
The OpenRouter API key stays on Vercel's server and is never sent to the browser.

## Project layout

```
api/summarize.ts   Server function: checks the password, calls OpenRouter, streams the summary back
src/app.ts         Browser logic (compiled to public/app.js during the Vercel build)
public/index.html  The page
vercel.json        Build settings and a 60-second time limit for the server function
```

## Environment variables

| Name                 | Required | Value |
|----------------------|----------|-------|
| `OPENROUTER_API_KEY` | yes      | Your key from openrouter.ai/keys |
| `OPENROUTER_MODEL`   | yes      | The model id exactly as shown on openrouter.ai/models (for example an `anthropic/claude-...` id) |
| `APP_PASSWORD`       | recommended | Any password. Visitors must type it before they can summarize |

After changing any variable, redeploy (Deployments → ⋯ → Redeploy) so it takes effect.

## Run locally (optional)

```
npm install
npm i -g vercel
vercel dev
```

Put the three variables in a `.env.local` file first (it is ignored by git).
