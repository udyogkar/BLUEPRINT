/**
 * Blueprint API — Cloudflare Worker
 *
 * Endpoints:
 *   POST /api/verdict         free scored verdict, calls OpenRouter
 *   POST /api/create-order    creates a real Razorpay order, stores form data in KV
 *   POST /api/razorpay-webhook   verifies signature, generates the paid report
 *   GET  /api/report?order_id=  polls whether the paid report is ready
 *
 * Required secrets (wrangler secret put <NAME>):
 *   OPENROUTER_API_KEY
 *   RAZORPAY_KEY_ID
 *   RAZORPAY_KEY_SECRET
 *   RAZORPAY_WEBHOOK_SECRET
 *
 * Required binding (see wrangler.toml):
 *   BLUEPRINTS   — a KV namespace, stores order form data + generated reports
 *
 * This Worker fails closed: if a secret is missing, the relevant endpoint
 * returns a clear error instead of pretending to work.
 */

// Free-tier OpenRouter models to try, in order. "openrouter/free" is
// OpenRouter's own router that auto-picks whichever free model is live —
// keep it first. Add specific free model IDs from
// https://openrouter.ai/models?max_price=0 as extra fallbacks if you want.
const FREE_MODELS = ["openrouter/free"];

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*", // tighten to your GitHub Pages origin once live
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

function errorResponse(message, status = 400) {
  return json({ error: message }, status);
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }
    const url = new URL(request.url);
    try {
      if (url.pathname === "/api/verdict" && request.method === "POST") {
        return await handleVerdict(request, env);
      }
      if (url.pathname === "/api/create-order" && request.method === "POST") {
        return await handleCreateOrder(request, env);
      }
      if (url.pathname === "/api/razorpay-webhook" && request.method === "POST") {
        return await handleWebhook(request, env, ctx);
      }
      if (url.pathname === "/api/report" && request.method === "GET") {
        return await handleGetReport(url, env);
      }
      return errorResponse("Not found", 404);
    } catch (err) {
      console.error(err);
      return errorResponse("Unexpected server error. Nothing was charged or generated.", 500);
    }
  },
};

// ---------------------------------------------------------------
// Shared: call OpenRouter with a fallback chain, fail closed
// ---------------------------------------------------------------
async function callOpenRouter(env, systemPrompt, userPrompt) {
  if (!env.OPENROUTER_API_KEY) {
    throw new Error(
      "The AI key isn't configured on the server yet. Add OPENROUTER_API_KEY as a Worker secret."
    );
  }
  let lastError;
  for (const model of FREE_MODELS) {
    try {
      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          temperature: 0.6,
        }),
      });
      if (!res.ok) {
        lastError = new Error(`Model ${model} returned ${res.status}`);
        continue;
      }
      const data = await res.json();
      const text = data?.choices?.[0]?.message?.content;
      if (!text) {
        lastError = new Error(`Model ${model} returned an empty response`);
        continue;
      }
      return text;
    } catch (err) {
      lastError = err;
    }
  }
  throw new Error(
    "The AI service didn't respond after trying every available free model. Try again shortly — free-tier models are sometimes temporarily overloaded."
  );
}

function extractJson(text) {
  const cleaned = text.replace(/```json|```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("AI response wasn't valid JSON.");
  return JSON.parse(cleaned.slice(start, end + 1));
}

function languageName(code) {
  return { english: "English", marathi: "Marathi", hindi: "Hindi" }[code] || "English";
}

function clampScore(n) {
  const v = Math.round(Number(n));
  if (Number.isNaN(v)) return 50;
  return Math.max(0, Math.min(100, v));
}

// ---------------------------------------------------------------
// POST /api/verdict
// ---------------------------------------------------------------
async function handleVerdict(request, env) {
  const data = await request.json();
  const { idea, budget, city, stage, language } = data || {};

  if (!idea || idea.trim().length < 10) return errorResponse("Describe your business idea in more detail.");
  if (!budget) return errorResponse("Budget range is required.");
  if (!city) return errorResponse("City is required.");
  if (!stage) return errorResponse("Stage is required.");

  const systemPrompt =
    "You are a blunt, experienced small-business mentor in India, advising first-time entrepreneurs in tier 2/3 towns. " +
    "You are honest even when the answer is discouraging. You never pad with generic encouragement. " +
    `Respond in ${languageName(language)}. ` +
    "Respond with ONLY a JSON object, no markdown, no preamble, matching exactly this shape: " +
    '{"score": number 0-100 (overall viability), "marketOpportunity": number 0-100, "executionRisk": number 0-100 (higher = riskier), ' +
    '"verdict": "go" | "go_with_changes" | "rethink", "summary": string (1-2 sentences), ' +
    '"reasoning": string (2-4 sentences, specific to the numbers given, not generic), ' +
    '"risks": string[] (3 items, specific), "nextSteps": string[] (3 items, concrete and doable this week)}. ' +
    "The three scores must be consistent with the verdict: go needs score above 65 and executionRisk below 50; rethink needs score below 40.";

  const userPrompt = `Business idea: ${idea}\nCapital available: ${budget}\nCity/town: ${city}\nCurrent stage: ${stage}`;

  const raw = await callOpenRouter(env, systemPrompt, userPrompt);
  const parsed = extractJson(raw);
  parsed.score = clampScore(parsed.score);
  parsed.marketOpportunity = clampScore(parsed.marketOpportunity);
  parsed.executionRisk = clampScore(parsed.executionRisk);
  return json(parsed);
}

// ---------------------------------------------------------------
// POST /api/create-order
// ---------------------------------------------------------------
const PLAN_AMOUNTS = { quick: 9900, complete: 19900 }; // paise

async function handleCreateOrder(request, env) {
  if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) {
    return errorResponse(
      "Payments aren't configured on the server yet. Add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET as Worker secrets.",
      500
    );
  }
  if (!env.BLUEPRINTS) {
    return errorResponse("Storage isn't configured on the server yet. Add the BLUEPRINTS KV binding.", 500);
  }

  const { plan, formData } = await request.json();
  const amount = PLAN_AMOUNTS[plan];
  if (!amount) return errorResponse("Unknown plan.");
  if (!formData || !formData.idea) return errorResponse("Missing your idea details — go back and fill the form.");

  const auth = btoa(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`);
  const res = await fetch("https://api.razorpay.com/v1/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Basic ${auth}` },
    body: JSON.stringify({ amount, currency: "INR", notes: { plan } }),
  });

  if (!res.ok) {
    const body = await res.text();
    console.error("Razorpay order error:", body);
    return errorResponse("Couldn't create the payment order. Please try again.", 502);
  }
  const order = await res.json();

  await env.BLUEPRINTS.put(
    `order:${order.id}`,
    JSON.stringify({ plan, formData, status: "pending" }),
    { expirationTtl: 60 * 60 * 24 * 7 }
  );

  return json({ orderId: order.id, amount, keyId: env.RAZORPAY_KEY_ID });
}

// ---------------------------------------------------------------
// POST /api/razorpay-webhook
// ---------------------------------------------------------------
async function handleWebhook(request, env, ctx) {
  if (!env.RAZORPAY_WEBHOOK_SECRET) {
    return errorResponse("Webhook secret not configured.", 500);
  }

  const rawBody = await request.text();
  const signature = request.headers.get("x-razorpay-signature");
  const expected = await hmacSha256Hex(env.RAZORPAY_WEBHOOK_SECRET, rawBody);

  if (!signature || signature !== expected) {
    return errorResponse("Invalid webhook signature.", 401);
  }

  const event = JSON.parse(rawBody);
  if (event.event !== "payment.captured" && event.event !== "order.paid") {
    return json({ received: true });
  }

  const orderId = event.payload?.payment?.entity?.order_id || event.payload?.order?.entity?.id;
  if (!orderId) return errorResponse("Webhook payload missing order id.");

  const stored = await env.BLUEPRINTS.get(`order:${orderId}`);
  if (!stored) return errorResponse("Unknown order.", 404);

  const orderData = JSON.parse(stored);
  if (orderData.status === "ready") return json({ received: true });

  ctx.waitUntil(generateReport(env, orderId, orderData));
  return json({ received: true });
}

async function generateReport(env, orderId, orderData) {
  const { plan, formData } = orderData;
  const { idea, budget, city, stage, language } = formData;

  const sectionList =
    plan === "complete"
      ? "1) Launch checklist 2) Where to source stock/materials near their city 3) First-30-days plan " +
        "4) Pricing & margin worksheet for their budget 5) Local competition & positioning notes 6) 90-day growth roadmap"
      : "1) Launch checklist 2) Where to source stock/materials near their city 3) First-30-days plan";

  const systemPrompt =
    "You are a blunt, experienced small-business mentor in India writing a paid business blueprint report " +
    `for a first-time entrepreneur. Respond in ${languageName(language)}. ` +
    `Write the following sections, each with a clear heading and concrete, specific content (not generic filler): ${sectionList}. ` +
    "Respond with ONLY a JSON object: {\"sections\": [{\"heading\": string, \"body\": string}]}. No markdown fences.";

  const userPrompt = `Business idea: ${idea}\nCapital available: ${budget}\nCity/town: ${city}\nCurrent stage: ${stage}`;

  try {
    const raw = await callOpenRouter(env, systemPrompt, userPrompt);
    const parsed = extractJson(raw);
    await env.BLUEPRINTS.put(
      `order:${orderId}`,
      JSON.stringify({ ...orderData, status: "ready", report: parsed, readyAt: Date.now() }),
      { expirationTtl: 60 * 60 * 24 * 30 }
    );
  } catch (err) {
    console.error("Report generation failed for order", orderId, err);
    await env.BLUEPRINTS.put(
      `order:${orderId}`,
      JSON.stringify({ ...orderData, status: "failed", error: String(err), readyAt: Date.now() }),
      { expirationTtl: 60 * 60 * 24 * 7 }
    );
  }
}

// ---------------------------------------------------------------
// GET /api/report?order_id=...
// ---------------------------------------------------------------
async function handleGetReport(url, env) {
  const orderId = url.searchParams.get("order_id");
  if (!orderId) return errorResponse("Missing order_id.");
  if (!env.BLUEPRINTS) return errorResponse("Storage isn't configured.", 500);

  const stored = await env.BLUEPRINTS.get(`order:${orderId}`);
  if (!stored) return errorResponse("Unknown order.", 404);
  const data = JSON.parse(stored);

  if (data.status === "pending") return json({ status: "pending" });
  if (data.status === "failed") {
    return errorResponse(
      "Payment was received but report generation failed. This needs a human to check — contact support with order ID " + orderId,
      500
    );
  }

  const reportJson = JSON.stringify(data.report, null, 2);
  const dataUrl = "data:application/json;base64," + btoa(unescape(encodeURIComponent(reportJson)));
  return json({ status: "ready", downloadUrl: dataUrl });
}

// ---------------------------------------------------------------
// HMAC-SHA256 hex, for Razorpay webhook signature verification
// ---------------------------------------------------------------
async function hmacSha256Hex(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return [...new Uint8Array(signature)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
