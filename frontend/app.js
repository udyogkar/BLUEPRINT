const API_BASE = window.BP_API_BASE || "";

const form = document.getElementById("ideaForm");
const idea = document.getElementById("idea");
const ideaCount = document.getElementById("ideaCount");
const generateButton = document.getElementById("generateButton");
const formStatus = document.getElementById("formStatus");
const resultSection = document.getElementById("result");
const resultContent = document.getElementById("resultContent");
const editIdea = document.getElementById("editIdea");
const language = document.getElementById("language");
const topLanguage = document.getElementById("topLanguage");

function syncLanguage(value) {
  language.value = value;
  topLanguage.value = value;
}
topLanguage.addEventListener("change", () => syncLanguage(topLanguage.value));
language.addEventListener("change", () => syncLanguage(language.value));

idea.addEventListener("input", () => {
  ideaCount.textContent = `${idea.value.length} / 1000`;
});

function setStatus(message, type = "error") {
  formStatus.textContent = message;
  formStatus.dataset.type = type;
}

function clearErrors() {
  document.querySelectorAll(".field-error").forEach((el) => el.textContent = "");
}

function validate(data) {
  clearErrors();
  let valid = true;
  if (data.idea.trim().length < 12) {
    document.getElementById("ideaError").textContent = "Describe the business in at least a few words.";
    valid = false;
  }
  if (!data.category) {
    document.getElementById("categoryError").textContent = "Select a business type.";
    valid = false;
  }
  if (!data.location.trim()) {
    document.getElementById("categoryError").textContent = "Add the city/town and state.";
    valid = false;
  }
  if (!data.capital) {
    document.getElementById("categoryError").textContent = "Select your starting capital.";
    valid = false;
  }
  if (!data.mode) {
    document.getElementById("categoryError").textContent = "Select how you will start.";
    valid = false;
  }
  return valid;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[char]));
}

function renderVerdict(data) {
  const verdict = data.verdict || {};
  const metrics = verdict.metrics || {};
  const reasons = Array.isArray(verdict.reasons) ? verdict.reasons : [];
  const risks = Array.isArray(verdict.risks) ? verdict.risks : [];
  const nextSteps = Array.isArray(verdict.next_steps) ? verdict.next_steps : [];

  resultContent.innerHTML = `
    <div class="verdict-card">
      <p class="eyebrow">FREE BUSINESS VERDICT</p>
      <h3>${escapeHtml(verdict.headline || "Your business idea has been analysed.")}</h3>
      <p>${escapeHtml(verdict.summary || "Review the findings below before committing capital.")}</p>
      <div class="verdict-grid">
        <div class="verdict-metric"><small>DECISION</small><strong>${escapeHtml(metrics.decision || "Review")}</strong></div>
        <div class="verdict-metric"><small>CAPITAL</small><strong>${escapeHtml(metrics.capital || data.capital)}</strong></div>
        <div class="verdict-metric"><small>RISK</small><strong>${escapeHtml(metrics.risk || "Not rated")}</strong></div>
      </div>
    </div>
    <div class="verdict-body">
      <div class="result-list"><h4>Why it could work</h4><ul>${reasons.map((x) => `<li>${escapeHtml(x)}</li>`).join("") || "<li>No supporting points returned.</li>"}</ul></div>
      <div class="result-list"><h4>What could kill it</h4><ul>${risks.map((x) => `<li>${escapeHtml(x)}</li>`).join("") || "<li>No major risks returned.</li>"}</ul></div>
      <div class="result-list"><h4>Your first moves</h4><ul>${nextSteps.map((x) => `<li>${escapeHtml(x)}</li>`).join("") || "<li>Validate demand before major spending.</li>"}</ul></div>
      <div class="result-list"><h4>Important</h4><p style="font-size:12px;color:#687177;margin:0">${escapeHtml(verdict.disclaimer || "This is decision-support, not a guarantee of demand, revenue or profit. Verify local prices, licences and regulations before spending.")}</p></div>
    </div>`;
  resultSection.hidden = false;
  resultSection.scrollIntoView({ behavior: "smooth", block: "start" });
}

function getFormData() {
  return {
    idea: idea.value.trim(),
    category: document.getElementById("category").value,
    location: document.getElementById("location").value.trim(),
    capital: document.getElementById("capital").value,
    mode: document.getElementById("mode").value,
    experience: document.getElementById("experience").value.trim(),
    income: document.getElementById("income").value,
    language: language.value,
    customer: document.getElementById("customer").value.trim()
  };
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = getFormData();
  if (!validate(data)) {
    setStatus("Please correct the highlighted fields.");
    return;
  }

  generateButton.disabled = true;
  generateButton.innerHTML = "Analysing idea <span>…</span>";
  setStatus("Generating your verdict…", "loading");

  try {
    const response = await fetch(`${API_BASE}/api/verdict`, {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify(data)
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "The verdict service is unavailable right now.");
    renderVerdict({...data, ...payload});
    setStatus("", "success");
  } catch (error) {
    setStatus(error.message || "Unable to generate the verdict. Please try again.");
  } finally {
    generateButton.disabled = false;
    generateButton.innerHTML = "Generate free verdict <span>→</span>";
  }
});

editIdea.addEventListener("click", () => {
  resultSection.hidden = true;
  document.getElementById("builder").scrollIntoView({behavior:"smooth"});
});

document.querySelectorAll(".price-option").forEach((button) => {
  button.addEventListener("click", async () => {
    const data = getFormData();
    if (!validate(data)) {
      document.getElementById("builder").scrollIntoView({behavior:"smooth"});
      setStatus("Complete the required fields before purchasing.");
      return;
    }
    button.disabled = true;
    const original = button.innerHTML;
    button.innerHTML = "<span>CHECKING</span><strong>…</strong><small>Connecting to secure checkout</small>";
    try {
      const response = await fetch(`${API_BASE}/api/create-order`, {
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({plan:button.dataset.plan, input:data})
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Payment is not configured yet.");
      if (!window.Razorpay || !payload.order) throw new Error("Secure checkout is not available yet.");
      const checkout = new Razorpay(payload.order);
      checkout.open();
    } catch (error) {
      alert(error.message || "Secure checkout is unavailable.");
    } finally {
      button.disabled = false;
      button.innerHTML = original;
    }
  });
});
