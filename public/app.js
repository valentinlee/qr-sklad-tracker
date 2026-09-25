async function api(url, options) {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Ошибка запроса");
  return data;
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function fmtDate(iso) {
  return new Date(iso).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

// ---------- Табы ----------

document.getElementById("main-tabs").addEventListener("click", (e) => {
  const tab = e.target.closest(".tab");
  if (!tab) return;
  document.querySelectorAll("#main-tabs .tab").forEach((t) => t.classList.remove("active"));
  tab.classList.add("active");
  const name = tab.dataset.tab;
  ["materials", "movement", "log", "inventory"].forEach((id) =>
    document.getElementById(`tab-${id}`).classList.toggle("hidden", id !== name)
  );
  if (name === "materials") loadMaterials();
  if (name === "movement") loadMaterialOptions();
  if (name === "log") loadLog();
  if (name === "inventory") {
    loadMaterialOptions("inv-material");
    loadInventoryHistory();
  }
});

// ---------- Материалы ----------

async function loadMaterials() {
  const materials = await api("/api/materials");
  const list = document.getElementById("materials-list");
  list.innerHTML = materials
    .map(
      (m) => `
    <div class="task-card">
      <div class="task-card-top">
        <div class="task-title">${escapeHtml(m.name)} <span style="color:var(--text-muted);font-weight:400">(${escapeHtml(m.code)})</span></div>
        <span class="badge ${m.needsOrder ? "reorder" : "ok"}">${m.needsOrder ? "нужно заказать" : "остаток ок"}</span>
      </div>
      <div class="task-meta">Остаток: ${m.stock} ${escapeHtml(m.unit)} · Мин. порог: ${m.minStock} ${escapeHtml(m.unit)}</div>
    </div>`
    )
    .join("");
}

async function loadMaterialOptions(selectId = "mv-material") {
  const materials = await api("/api/materials");
  const select = document.getElementById(selectId);
  select.innerHTML = materials
    .map((m) => `<option value="${m.id}">${escapeHtml(m.code)} — ${escapeHtml(m.name)} (остаток: ${m.stock} ${escapeHtml(m.unit)})</option>`)
    .join("");
}

// ---------- Новое движение ----------

document.getElementById("mv-type").addEventListener("change", (e) => {
  document.getElementById("mv-posts").style.display = e.target.value === "перемещение" ? "grid" : "none";
});
document.getElementById("mv-posts").style.display = "none";

document.getElementById("mv-submit").addEventListener("click", async () => {
  const materialId = document.getElementById("mv-material").value;
  const type = document.getElementById("mv-type").value;
  const qty = document.getElementById("mv-qty").value;
  const fromPost = document.getElementById("mv-from").value.trim();
  const toPost = document.getElementById("mv-to").value.trim();
  const comment = document.getElementById("mv-comment").value.trim();
  const errorEl = document.getElementById("mv-error");
  errorEl.textContent = "";
  try {
    await api("/api/movements", {
      method: "POST",
      body: JSON.stringify({ materialId, type, qty, fromPost, toPost, comment }),
    });
    document.getElementById("mv-qty").value = "";
    document.getElementById("mv-from").value = "";
    document.getElementById("mv-to").value = "";
    document.getElementById("mv-comment").value = "";
    await loadMaterialOptions();
    errorEl.style.color = "var(--success)";
    errorEl.textContent = "Движение зафиксировано";
    setTimeout(() => (errorEl.textContent = ""), 2000);
  } catch (err) {
    errorEl.style.color = "var(--danger)";
    errorEl.textContent = err.message;
  }
});

// ---------- Журнал ----------

let currentLogType = "";

document.getElementById("log-filters").addEventListener("click", (e) => {
  const btn = e.target.closest(".filter");
  if (!btn) return;
  document.querySelectorAll("#log-filters .filter").forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");
  currentLogType = btn.dataset.type;
  loadLog();
});

async function loadLog() {
  const qs = currentLogType ? `?type=${encodeURIComponent(currentLogType)}` : "";
  const movements = await api(`/api/movements${qs}`);
  const list = document.getElementById("log-list");
  if (!movements.length) {
    list.innerHTML = `<div class="empty">Движений пока нет</div>`;
    return;
  }
  list.innerHTML = movements
    .map(
      (m) => `
    <div class="task-card">
      <div class="task-card-top">
        <div class="task-title">${escapeHtml(m.materialName)} <span style="color:var(--text-muted);font-weight:400">(${escapeHtml(m.materialCode)})</span></div>
        <span class="badge type-${m.type}">${m.type}</span>
      </div>
      <div class="task-meta">
        ${m.qty} ${escapeHtml(m.unit)}
        ${m.fromPost ? ` · ${escapeHtml(m.fromPost)} → ${escapeHtml(m.toPost)}` : ""}
        · остаток после: ${m.stockAfter} ${escapeHtml(m.unit)} · ${fmtDate(m.createdAt)}
        ${m.comment ? `<br/>${escapeHtml(m.comment)}` : ""}
      </div>
    </div>`
    )
    .join("");
}

// ---------- Инвентаризация ----------

document.getElementById("inv-submit").addEventListener("click", async () => {
  const materialId = document.getElementById("inv-material").value;
  const factQty = document.getElementById("inv-fact").value;
  const comment = document.getElementById("inv-comment").value.trim();
  const errorEl = document.getElementById("inv-error");
  errorEl.textContent = "";
  try {
    const { record } = await api("/api/inventory", {
      method: "POST",
      body: JSON.stringify({ materialId, factQty, comment }),
    });
    document.getElementById("inv-fact").value = "";
    document.getElementById("inv-comment").value = "";
    await loadMaterialOptions("inv-material");
    await loadInventoryHistory();
    errorEl.style.color = record.diff === 0 ? "var(--success)" : "var(--warn)";
    errorEl.textContent =
      record.diff === 0
        ? "Расхождений нет"
        : `Расхождение: ${record.diff > 0 ? "+" : ""}${record.diff} (${record.diff > 0 ? "излишек" : "недостача"}), остаток скорректирован`;
  } catch (err) {
    errorEl.style.color = "var(--danger)";
    errorEl.textContent = err.message;
  }
});

async function loadInventoryHistory() {
  const records = await api("/api/inventory");
  const list = document.getElementById("inventory-list");
  if (!records.length) {
    list.innerHTML = `<div class="empty">Проверок пока не было</div>`;
    return;
  }
  list.innerHTML = records
    .map(
      (r) => `
    <div class="task-card">
      <div class="task-card-top">
        <div class="task-title">${escapeHtml(r.materialName)}</div>
        <span class="badge ${r.diff === 0 ? "ok" : "reorder"}">${r.diff === 0 ? "без расхождений" : (r.diff > 0 ? "+" : "") + r.diff}</span>
      </div>
      <div class="task-meta">Системный остаток: ${r.systemQty} → Факт: ${r.factQty} · ${fmtDate(r.createdAt)}${r.comment ? `<br/>${escapeHtml(r.comment)}` : ""}</div>
    </div>`
    )
    .join("");
}

// ---------- Инициализация ----------

loadMaterials();
loadMaterialOptions();
