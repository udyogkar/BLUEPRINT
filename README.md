# Blueprint

Free scored business-idea verdict + paid step-by-step blueprint, for first-time entrepreneurs in Indian tier 2/3 towns. Modeled on aiiqa.com's trust flow (sample report → free verdict → paid unlock), scoped to run at ₹0 fixed cost for a solo operator.

## Before you touch anything: wipe the repo

Your repo currently has old files mixed in from earlier attempts (a `frontend/` folder, maybe a `functions/api` folder, an old README). Mixing old and new is exactly what caused the 404s and the "shows the README" bug last time.

1. On github.com, open your repo → delete every file and folder except `.git` (or just delete the repo and create a fresh empty one — faster).
2. Copy in **only** these files, at the structure shown:

```
repo root
├── index.html
├── styles.css
├── app.js
├── README.md
└── worker/
    ├── wrangler.toml
    └── src/
        └── index.js
```

Nothing else. No `frontend/` folder, no `functions/` folder, no duplicate copies.

## Deploy the frontend

1. Push the files above to the repo root, on `main`.
2. GitHub → repo → Settings → Pages → Source: "Deploy from a branch" → Branch: `main` → Folder: `/ (root)`.
3. Wait for the green checkmark under the Actions tab, then hard-refresh `https://<you>.github.io/<repo>/`.

You should see the actual landing page: header, hero with a sample score card, sample report, the form, pricing, FAQ. Not text, not a 404.

## Deploy the Worker

Needs Node.js locally.

```bash
cd worker
npm install -g wrangler
wrangler login
wrangler kv namespace create BLUEPRINTS
```

Paste the printed `id` into `wrangler.toml`.

Get a free OpenRouter key (no card): sign up at openrouter.ai → Keys → Create Key.

```bash
wrangler secret put OPENROUTER_API_KEY
wrangler deploy
```

Wrangler prints your Worker URL. Paste it into `API_BASE_URL` at the top of `app.js`, commit, push.

**Test now**: open the site, fill the form, click "Get my free verdict." If you see a scored verdict with the three bars filled in, the core product works. Stop and confirm this before touching payments.

## Add payments (only after the free verdict works)

1. Razorpay account → Settings → API Keys → get Key ID + Key Secret.
2. ```bash
   wrangler secret put RAZORPAY_KEY_ID
   wrangler secret put RAZORPAY_KEY_SECRET
   wrangler secret put RAZORPAY_WEBHOOK_SECRET   # invent a random string yourself
   ```
3. Razorpay dashboard → Webhooks → Add → URL: `<your-worker-url>/api/razorpay-webhook` → Event: `payment.captured` → Secret: the same random string.
4. `wrangler deploy` again.

Nothing about payment is faked: real Razorpay order → real checkout → webhook signature verified → only then does the Worker generate the paid report → frontend polls until it's ready.

## What's genuinely different from aiiqa.com, on purpose

They're a funded studio with a build/registration/growth team behind their funnel. You're solo. This build:
- **Does** copy: the sample-report-before-you-commit pattern, the scored verdict card, the FAQ objection-handling, the clean funnel from free → paid.
- **Does not** copy: "we'll build your MVP," "we'll register your company," case studies with client quotes — because you can't fulfill those yet and faking them would burn trust the moment a real customer took you up on it. The WhatsApp CTA at the bottom is the honest version: a real person (you) replying, not a promised service you don't have.

## Known gaps, not fake, just not built yet

- Paid report currently downloads as JSON, not a formatted PDF. Fine for testing whether people will pay; upgrade later.
- `openrouter/free` will get rate-limited under real traffic. Once you have paying customers, add a cheap paid model as a second entry in `FREE_MODELS` in `worker/src/index.js`.
- CORS is wide open (`*`) for easy testing — lock it to your exact GitHub Pages origin once the URL is final.
- WhatsApp number in `index.html` is a placeholder (`91XXXXXXXXXX`) — put your real number in before launch.

## What to do right now

1. Wipe the repo, push these files.
2. Deploy frontend, confirm it renders.
3. Deploy Worker with only `OPENROUTER_API_KEY` set.
4. Test the free verdict end to end. Tell me exactly what happens — don't add payments until this step works.
