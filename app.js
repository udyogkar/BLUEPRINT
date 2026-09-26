// ============================================================
// CONFIG — the only line you MUST edit before deploying.
// Set this to your deployed Cloudflare Worker URL.
// Example: "https://blueprint-api.yourname.workers.dev"
// ============================================================
const API_BASE_URL = "https://REPLACE-WITH-YOUR-WORKER-URL.workers.dev";

// ---------- nav toggle ----------
const navToggle = document.getElementById("nav-toggle");
const mainNav = document.getElementById("main-nav");
navToggle.addEventListener("click", () => {
  const isOpen = mainNav.classList.toggle("is-open");
  navToggle.setAttribute("aria-expanded", String(isOpen));
});
mainNav.querySelectorAll("a").forEach((link) => {
  link.addEventListener("click", () => {
    mainNav.classList.remove("is-open");
    navToggle.setAttribute("aria-expanded", "false");
  });
});

// ---------- form elements ----------
const form = document.getElementById("idea-form");
const verdictBtn = document.getElementById("verdict-btn");
const sheetVerdict = document.getElementById("sheet-verdict");
const verdictResult = document.getElementById("verdict-result");
const verdictErrorBox = document.getElementById("verdict-error");
const verdictErrorMsg = document.getElementById("verdict-error-message");

let lastFormData = null;

// ---------- helpers ----------
function setFieldError(name, message) {
  const field = document.querySelector(`[data-error-for="${name}"]`);
  const wrapper = field ? field.closest(".field") : null;
  if (field) field.textContent = message || "";
  if (wrapper) wrapper.dataset.invalid = message ? "true" : "false";
}

function clearErrors() {
  form.querySelectorAll(".field__error").forEach((el) => (el.textContent = ""));
  form.querySelectorAll(".field").forEach((el) => delete el.dataset.invalid);
}

function validateForm(data) {
  let valid = true;
  if (!data.idea || data.idea.trim().length < 10) {
    setFieldError("idea", "Tell us a bit more — at least a full sentence.");
    valid = false;
  }
  if (!data.budget) {
    setFieldError("budget", "Choose a budget range.");
    valid = false;
  }
  if (!data.city || data.city.trim().length < 2) {
    setFieldError("city", "Enter your city or town.");
    valid = false;
  }
  if (!data.stage) {
    setFieldError("stage", "Choose where you're at right now.");
    valid = false;
  }
  return valid;
}

function setLoading(isLoading) {
  verdictBtn.disabled = isLoading;
  verdictBtn.querySelector(".btn__spinner").hidden = !isLoading;
  verdictBtn.querySelector(".btn__label").textContent = isLoading
    ? "Working it out…"
    : "Get my free verdict";
}

async function callApi(path, options = {}) {
  if (API_BASE_URL.includes("REPLACE-WITH-YOUR-WORKER-URL")) {
    throw new Error(
      "The Worker URL hasn't been configured yet — edit API_BASE_URL at the top of app.js."
    );
  }
  const res = await fetch(`${API_BASE_URL}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  let body;
  try {
    body = await res.json();
  } catch {
    throw new Error("The server sent back something unreadable. Try again in a moment.");
  }
  if (!res.ok) {
    throw new Error(body.error || `Request failed (${res.status}).`);
  }
  return body;
}

// ---------- verdict rendering ----------
function setBar(barId, numId, value) {
  const v = Math.max(0, Math.min(100, Number(value) || 0));
  document.getElementById(barId).style.width = v + "%";
  document.getElementById(numId).textContent = v + "/100";
}

function toneFor(verdict) {
  if (verdict === "go") return { tone: "go", label: "GO" };
  if (verdict === "rethink") return { tone: "stop", label: "RETHINK" };
  return { tone: "caution", label: "GO — WITH CHANGES" };
}

function renderVerdict(data) {
  setBar("bar-viability", "num-viability", data.score);
  setBar("bar-market", "num-market", data.marketOpportunity);
  setBar("bar-risk", "num-risk", data.executionRisk);

  const stamp = document.getElementById("verdict-stamp");
  const stampText = document.getElementById("verdict-stamp-text");
  const { tone, label } = toneFor(data.verdict);
  stamp.dataset.tone = tone;
  stampText.textContent = label;

  document.getElementById("verdict-summary").textContent = data.summary || "";
  document.getElementById("verdict-reasoning").textContent = data.reasoning || "";

  const risksList = document.getElementById("verdict-risks");
  risksList.innerHTML = "";
  (data.risks || []).forEach((r) => {
    const li = document.createElement("li");
    li.textContent = r;
    risksList.appendChild(li);
  });

  const stepsList = document.getElementById("verdict-next-steps");
  stepsList.innerHTML = "";
  (data.nextSteps || []).forEach((s) => {
    const li = document.createElement("li");
    li.textContent = s;
    stepsList.appendChild(li);
  });

  verdictResult.hidden = false;
  verdictErrorBox.hidden = true;
}

// ---------- form submit ----------
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearErrors();

  const formData = new FormData(form);
  const data = Object.fromEntries(formData.entries());

  if (!validateForm(data)) return;

  lastFormData = data;
  setLoading(true);
  sheetVerdict.hidden = false;
  verdictResult.hidden = true;
  verdictErrorBox.hidden = true;
  sheetVerdict.scrollIntoView({ behavior: "smooth", block: "start" });

  try {
    const result = await callApi("/api/verdict", {
      method: "POST",
      body: JSON.stringify(data),
    });
    renderVerdict(result);
  } catch (err) {
    verdictErrorMsg.textContent = err.message;
    verdictErrorBox.hidden = false;
    verdictResult.hidden = true;
  } finally {
    setLoading(false);
  }
});

document.getElementById("verdict-retry").addEventListener("click", () => {
  form.requestSubmit();
});

document.getElementById("edit-answers").addEventListener("click", () => {
  sheetVerdict.hidden = true;
  document.getElementById("validate").scrollIntoView({ behavior: "smooth" });
});

// ---------- payment ----------
const paymentStatus = document.getElementById("payment-status");

function showPaymentStatus(message, isError = false) {
  paymentStatus.hidden = false;
  paymentStatus.textContent = message;
  paymentStatus.classList.toggle("statebox--error", isError);
}

document.querySelectorAll(".buy-btn").forEach((btn) => {
  btn.addEventListener("click", async () => {
    if (!lastFormData) {
      showPaymentStatus("Fill in your idea above first so we know what to build the blueprint for.", true);
      document.getElementById("validate").scrollIntoView({ behavior: "smooth" });
      return;
    }
    const plan = btn.dataset.plan;
    btn.disabled = true;
    showPaymentStatus("Setting up secure payment…");

    try {
      const order = await callApi("/api/create-order", {
        method: "POST",
        body: JSON.stringify({ plan, formData: lastFormData }),
      });

      const razorpay = new Razorpay({
        key: order.keyId,
        amount: order.amount,
        currency: "INR",
        name: "Blueprint",
        description: plan === "quick" ? "Quick Start Blueprint" : "Complete Blueprint",
        order_id: order.orderId,
        handler: function () {
          pollForReport(order.orderId);
        },
        modal: {
          ondismiss: function () {
            showPaymentStatus("Payment window closed. No charge was made.");
            btn.disabled = false;
          },
        },
        theme: { color: "#0B3D62" },
      });

      razorpay.on("payment.failed", function () {
        showPaymentStatus("Payment failed. You have not been charged for a report that wasn't delivered.", true);
        btn.disabled = false;
      });

      razorpay.open();
    } catch (err) {
      showPaymentStatus(err.message, true);
      btn.disabled = false;
    }
  });
});

async function pollForReport(orderId, attempt = 0) {
  showPaymentStatus("Payment received. Generating your blueprint — this can take up to a minute…");
  try {
    const result = await callApi(`/api/report?order_id=${encodeURIComponent(orderId)}`);
    if (result.status === "ready") {
      showPaymentStatus("Your blueprint is ready.");
      const link = document.createElement("a");
      link.href = result.downloadUrl;
      link.textContent = "Download your Blueprint";
      link.className = "btn btn--primary";
      link.style.marginTop = "0.75rem";
      link.style.display = "inline-flex";
      paymentStatus.appendChild(document.createElement("br"));
      paymentStatus.appendChild(link);
      return;
    }
    if (attempt >= 20) {
      showPaymentStatus(
        "Your payment went through but the report is taking longer than expected. Contact support with your order ID: " + orderId,
        true
      );
      return;
    }
    setTimeout(() => pollForReport(orderId, attempt + 1), 3000);
  } catch (err) {
    showPaymentStatus(err.message, true);
  }
}
