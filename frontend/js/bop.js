const grid = document.querySelector("#grid");
const empty = document.querySelector("#empty");
const loading = document.querySelector("#loading");
const dashboardError = document.querySelector("#dashboard-error");
let materials = [];
let selectedId = null;
let busy = false;
let dataReady = false;
let actionMode = null;
let requestHistoryRows = [];
const MAX_CARD_REQUEST_HISTORY = 3;
const isViewer = false;
const $ = (selector) => document.querySelector(selector);
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));

const setText = (selector, value) => {
  const element = document.querySelector(selector);
  if (!element) return;
  element.textContent = value;
  if (selector === "#action-feedback" || selector === "#request-feedback") {
    element.classList.toggle("success", /berhasil|tersimpan|diperbarui/i.test(String(value)));
    element.classList.toggle("error", /gagal|melebihi|masukkan|tidak dapat|tidak ada|periksa|masih ada/i.test(String(value)));
  }
};

function displayValue(value) {
  return value === null || value === undefined || value === "" ? "-" : value;
}

function formatDateTime(value) {
  if (!value) return "-";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";

  return new Intl.DateTimeFormat("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date).replace(",", " ·");
}

function formatMovementTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function renderLastMovement(material) {
  const type = String(material.last_movement_type || "").toUpperCase();
  const delta = Number(material.last_movement_quantity_changed);
  let label = "-";

  if (type === "USE" && Number.isFinite(delta)) {
    label = `&darr; USED ${Math.abs(delta)} BOX &middot; ${escapeHtml(formatMovementTime(material.last_movement_at))} &middot; ${escapeHtml(displayValue(material.last_movement_performed_by))}`;
  } else if (type === "STOCK_UPDATE" && Number.isFinite(delta)) {
    const sign = delta >= 0 ? "+" : "";
    label = `${delta >= 0 ? "&uarr;" : "&darr;"} STOCK ${sign}${delta} BOX &middot; ${escapeHtml(formatMovementTime(material.last_movement_at))} &middot; ${escapeHtml(displayValue(material.last_movement_performed_by))}`;
  }

  return `<section class="last-movement" aria-label="Last movement ${escapeHtml(material.part_number)}"><small>LAST MOVEMENT</small><b>${label}</b></section>`;
}

function getSupplyLabel(konmi) {
  if (!konmi) return "-";
  return String(konmi).toUpperCase().includes("CKD") ? "CKD" : "Lokal";
}

function getTone(color) {
  const tones = { biru: "blue", merah: "red", ungu: "purple", kuning: "yellow", hijau: "green" };
  return tones[String(color || "").toLowerCase()] || "slate";
}

function getStockStatus(material) {
  const fallback = Number(material.quantity_box) === 0 ? "EMPTY" : "READY";
  return String(material.stock_status || fallback).toUpperCase();
}

function hasActiveRequest(material) {
  return (
    material.active_request_id !== null &&
    material.active_request_id !== undefined &&
    ["PENDING", "ONGOING"].includes(material.active_request_status)
  );
}

function requestLabel(material) {
  if (!hasActiveRequest(material)) return "";
  return `<span class="request-label">Request ${escapeHtml(displayValue(material.active_request_quantity_box))} BOX · ${escapeHtml(displayValue(material.active_request_status))}</span>`;
}

function getMaterialRequestHistory(material) {
  return requestHistoryRows
    .filter(
      (request) =>
        String(request.armature_id) === String(material.id) &&
        request.status === "DONE",
    )
    .sort((left, right) => {
      const leftTime = Date.parse(left.completed_at || left.handled_at || "") || 0;
      const rightTime = Date.parse(right.completed_at || right.handled_at || "") || 0;
      return rightTime - leftTime || String(right.id).localeCompare(String(left.id));
    })
    .slice(0, MAX_CARD_REQUEST_HISTORY);
}

function renderMaterialRequestHistory(material) {
  const history = getMaterialRequestHistory(material);
  const entries = history.length
    ? history.map((request) => `<div class="material-history-item">
          <b>${Number(request.requested_quantity_box) || 0} BOX</b>
          <small>DONE · ${escapeHtml(formatDateTime(request.completed_at || request.handled_at))} · ${escapeHtml(displayValue(request.handled_by))}</small>
        </div>`).join("")
    : `<small class="material-history-empty">Belum ada riwayat request.</small>`;

  return `<section class="material-history" aria-label="Riwayat request ${escapeHtml(material.part_number)}">
    <div class="material-history-header"><small>Riwayat Request</small><b>${history.length ? `${history.length} terakhir` : "-"}</b></div>
    <div class="material-history-list">${entries}</div>
  </section>`;
}

function statusClass(status) {
  return status === "EMPTY" ? "empty" : "ready";
}

function renderSummary() {
  const totalQuantity = materials.reduce((total, material) => total + (Number(material.quantity_box) || 0), 0);
  document.querySelector("#summary-material-count").innerHTML = `${materials.length} <em>(K62)</em>`;
  document.querySelector("#summary-total-quantity").innerHTML = `${totalQuantity} <em>(Total semua material)</em>`;
}

function renderCards() {
  grid.innerHTML = materials.map((material) => {
    const part = escapeHtml(displayValue(material.part_number));
    const quantity = Number(material.quantity_box) || 0;
    const status = getStockStatus(material);
    const supplyLabel = getSupplyLabel(material.konmi);
    const supplyClass = supplyLabel === "CKD" ? "ckd" : "local";

    return `<article class="material-card tone-${getTone(material.color)}" data-id="${escapeHtml(material.id)}" tabindex="0" role="button" aria-label="Buka detail armature ${part}">
      <div class="card-head"><div class="material-code"><i></i><b>${part}</b><span class="type-pill">${escapeHtml(displayValue(material.armature_type))}</span></div><img class="mini-armature" src="../assets/armature.png" alt="Armature ${part}"></div>
      <div class="card-body"><h2>Armature ${part.replace(":", "")}</h2><p class="card-meta"><span class="tag ${supplyClass}">${supplyLabel}</span>(Konmi ${escapeHtml(displayValue(material.konmi))})${isViewer ? ` · Warna ${escapeHtml(displayValue(material.color))}` : ""}</p>${requestLabel(material)}${renderMaterialRequestHistory(material)}
      ${renderLastMovement(material)}<div class="quantity-row"><small>Quantity</small><strong>${quantity} <span>BOX</span></strong><b class="status ${statusClass(status)}">${escapeHtml(status)}</b></div>
      <div class="card-footer"><div>▣<span><small>Last Update</small><b>${formatDateTime(material.last_stock_update)}</b></span></div><div>♙<span><small>Updated by</small><b>${escapeHtml(displayValue(material.stock_updated_by))}</b></span></div></div></div>
    </article>`;
  }).join("");

  empty.style.display = materials.length ? "none" : "block";
  renderSummary();
}

function getActiveRequests(materialRows) {
  return (materialRows || [])
    .filter(
      (material) =>
        material.active_request_id &&
        ["PENDING", "ONGOING"].includes(material.active_request_status),
    )
    .sort((left, right) => {
      const leftSequence = Number(left.request_sequence);
      const rightSequence = Number(right.request_sequence);
      const leftHasSequence = Number.isSafeInteger(leftSequence) && leftSequence > 0;
      const rightHasSequence = Number.isSafeInteger(rightSequence) && rightSequence > 0;
      if (leftHasSequence || rightHasSequence) {
        if (!leftHasSequence) return 1;
        if (!rightHasSequence) return -1;
        if (leftSequence !== rightSequence) return leftSequence - rightSequence;
      }
      const leftTime = Date.parse(left.active_request_at || "") || 0;
      const rightTime = Date.parse(right.active_request_at || "") || 0;
      return leftTime - rightTime || String(left.id).localeCompare(String(right.id));
    });
}

function renderActiveRequests(materialRows) {
  const panel = document.querySelector("#active-requests");
  const list = document.querySelector("#active-request-list");
  if (!panel || !list) return;

  const activeRequests = getActiveRequests(materialRows);
  panel.hidden = false;
  list.innerHTML = activeRequests.map((material, index) => {
    const status = material.active_request_status;
    const statusClass = "waiting";
    return `<article class="active-request-item" role="listitem" aria-label="Request ${escapeHtml(material.part_number)} nomor ${index + 1}">
      <strong class="active-request-number">#${index + 1}</strong>
      <div class="active-request-detail"><b>${escapeHtml(material.part_number)}</b><span>${Number(material.active_request_quantity_box) || 0} BOX</span><small class="${statusClass}">${status}</small></div>
    </article>`;
  }).join("");

  const emptyRequests = document.querySelector("#active-request-empty");
  if (emptyRequests) emptyRequests.hidden = activeRequests.length > 0;
}

function renderRequestHistory(historyRows) {
  const panel = document.querySelector("#request-history");
  const list = document.querySelector("#request-history-list");
  if (!panel || !list) return;

  const history = (historyRows || [])
    .filter((request) => request.status === "DONE")
    .sort((left, right) => {
      const leftTime = Date.parse(left.completed_at || left.handled_at || "") || 0;
      const rightTime = Date.parse(right.completed_at || right.handled_at || "") || 0;
      return rightTime - leftTime || String(right.id).localeCompare(String(left.id));
    });

  panel.hidden = false;
  list.innerHTML = history.map((request) => `<article class="request-history-item" role="listitem">
    <span class="request-history-check" aria-hidden="true">✓</span>
    <div><b>${escapeHtml(request.part_number)} · ${Number(request.requested_quantity_box) || 0} BOX</b><small>DONE</small><span>${escapeHtml(formatDateTime(request.completed_at || request.handled_at))} · ${escapeHtml(displayValue(request.handled_by))}</span></div>
  </article>`).join("");
  const emptyHistory = document.querySelector("#request-history-empty");
  if (emptyHistory) emptyHistory.hidden = history.length > 0;
}

async function loadRequestHistory() {
  const feedback = document.querySelector("#request-history-feedback");
  const previousHistoryRows = requestHistoryRows;
  try {
    const { data, error } = await window.appDataService.loadRequestHistory();
    if (error) throw error;
    requestHistoryRows = data || [];
    renderRequestHistory(requestHistoryRows);
    renderCards();
    if (feedback) feedback.textContent = "";
    return true;
  } catch (error) {
    requestHistoryRows = previousHistoryRows;
    renderRequestHistory(requestHistoryRows);
    renderCards();
    if (feedback) feedback.textContent = "Riwayat request tidak dapat dimuat.";
    return false;
  }
}

function populate(material) {
  const part = displayValue(material.part_number);
  const quantity = Number(material.quantity_box) || 0;
  const supplyLabel = getSupplyLabel(material.konmi);
  const status = getStockStatus(material);
  const requestAvailable = hasActiveRequest(material);

  setText("#m-part", part);
  setText("#m-type", displayValue(material.armature_type));
  setText("#modal-title", `Armature ${part.replace(":", "")}`);
  setText("#m-local", supplyLabel);
  setText("#m-konmi", `(Konmi ${displayValue(material.konmi)} · Warna ${displayValue(material.color)})`);
  setText("#m-update", formatDateTime(material.last_stock_update));
  document.querySelector("#m-qty").innerHTML = `${quantity} <span>BOX</span>`;
  const stockStatus = document.querySelector("#m-status");
  stockStatus.textContent = status;
  stockStatus.className = `status ${statusClass(status)}`;
  document.querySelector(".stock-current > div:last-child em").textContent = `by ${displayValue(material.stock_updated_by)}`;

  const preview = document.querySelector("#request-preview");
  const handle = document.querySelector("#handle-request");
  const updateStock = document.querySelector("#update-stock");
  preview.hidden = !requestAvailable;
  handle.hidden = !requestAvailable;
  handle.disabled = busy || !dataReady;
  updateStock.disabled = busy || !dataReady;
  if (isViewer) {
    preview.disabled = true;
    handle.hidden = false;
    handle.textContent = "REQUEST";
    handle.disabled = busy || !dataReady || requestAvailable;
    updateStock.textContent = "DIGUNAKAN / USE";
    updateStock.disabled = busy || !dataReady || quantity <= 0;
  }

  if (requestAvailable) {
    setText("#request-quantity", `${displayValue(material.active_request_quantity_box)} BOX`);
    setText("#request-status", displayValue(material.active_request_status));
    document.querySelector("#request-status").className = "waiting";
  }
}

function openStock(material) {
  if (!material || busy || !dataReady) return;
  selectedId = material.id;
  setQuantityFormVisible(false);
  setText("#action-feedback", "");
  populate(material);
  const backdrop = document.querySelector("#backdrop");
  backdrop.classList.add("show");
  backdrop.setAttribute("aria-hidden", "false");
}

function closeStock() {
  if (busy) return;
  setQuantityFormVisible(false);
  const backdrop = document.querySelector("#backdrop");
  backdrop.classList.remove("show");
  backdrop.setAttribute("aria-hidden", "true");
}

async function loadMaterials() {
  const previousMaterials = materials;
  const previousHistoryRows = requestHistoryRows;
  loading.style.display = "block";
  empty.style.display = "none";
  dashboardError.style.display = "none";
  dataReady = false;
  try {
    const { data, error } = await window.appDataService.loadMaterials();
    if (error) throw error;
    materials = data || [];
    dataReady = true;
    renderCards();
    renderActiveRequests(materials);
    await loadRequestHistory();
    const selected = materials.find(item => item.id === selectedId);
    if (selected) populate(selected);
    else {
      $("#backdrop").classList.remove("show");
      $("#backdrop").setAttribute("aria-hidden", "true");
    }
    return true;
  } catch (error) {
    console.error("Dashboard data error:", error);
    if (previousMaterials.length) {
      materials = previousMaterials;
      requestHistoryRows = previousHistoryRows;
      dataReady = true;
      renderCards();
      renderActiveRequests(materials);
      renderRequestHistory(requestHistoryRows);
    } else {
      dashboardError.textContent = "Data tidak dapat dimuat. Muat ulang halaman sebelum melakukan aksi.";
      dashboardError.style.display = "block";
      grid.innerHTML = "";
      setText("#summary-material-count", "-");
      setText("#summary-total-quantity", "-");
    }
    return false;
  } finally {
    loading.style.display = "none";
  }
}

grid.addEventListener("click", (event) => {
  const card = event.target.closest(".material-card");
  if (!card) return;
  openStock(materials.find((material) => String(material.id) === card.dataset.id));
});
grid.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  const card = event.target.closest(".material-card");
  if (!card) return;
  event.preventDefault();
  openStock(materials.find((material) => String(material.id) === card.dataset.id));
});

document.querySelector("#close-modal").addEventListener("click", closeStock);
document.querySelector("#update-stock").addEventListener("click", () => openQuantity(isViewer ? "use" : "stock"));
document.querySelector("#backdrop").addEventListener("click", (event) => {
  if (event.target.id === "backdrop") closeStock();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") { closeStock(); if (!isViewer) closeRequest(); }
});

async function initializeDashboard() {
  const authenticated = await window.authGuardReady;
  if (!authenticated) return;
  await loadMaterials();
}


function currentMaterial() {
  return materials.find(item => item.id === selectedId);
}

function setQuantityFormVisible(visible) {
  const form = $("#quantity-form");
  const primaryActions = $("#modal-primary-actions");

  if (form) {
    form.hidden = !visible;
    form.style.display = visible ? "block" : "none";
  }

  if (primaryActions) {
    primaryActions.hidden = visible;
    primaryActions.style.display = visible ? "none" : "flex";
  }

  if (!visible) actionMode = null;
}

function setBusy(value) {
  busy = value;
  document.querySelectorAll("#backdrop button, #backdrop input, #request-backdrop button, #logout")
    .forEach(element => { element.disabled = value; });
  const quantitySubmit = $("#quantity-submit");
  if (quantitySubmit) {
    if (value) {
      quantitySubmit.dataset.defaultLabel ||= quantitySubmit.textContent;
      quantitySubmit.innerHTML = '<span class="button-spinner" aria-hidden="true"></span><span>Memproses...</span>';
      quantitySubmit.setAttribute("aria-busy", "true");
    } else {
      quantitySubmit.textContent = quantitySubmit.dataset.defaultLabel || "Simpan";
      quantitySubmit.removeAttribute("aria-busy");
    }
  }
  const requestSubmit = $("#save-request");
  if (requestSubmit) {
    if (value) {
      requestSubmit.dataset.defaultLabel ||= requestSubmit.innerHTML;
      requestSubmit.innerHTML = '<span class="button-spinner" aria-hidden="true"></span><span>Memproses...</span>';
      requestSubmit.setAttribute("aria-busy", "true");
    } else {
      requestSubmit.innerHTML = requestSubmit.dataset.defaultLabel || requestSubmit.innerHTML;
      requestSubmit.removeAttribute("aria-busy");
    }
  }
  if (!value) {
    const item = currentMaterial();
    if (item) populate(item);
    $("#quantity-submit").disabled = !dataReady;
    if (!isViewer) refreshRequestActions();
  }
}

function openQuantity(mode) {
  const item = currentMaterial();
  if (busy || !dataReady || !item) return;
  if (mode === "use" && Number(item.quantity_box) <= 0) return;
  if (mode === "request" && hasActiveRequest(item)) return;
  actionMode = mode;
  setQuantityFormVisible(true);
  $("#quantity-input").min = mode === "stock" ? "0" : "1";
  $("#quantity-input").removeAttribute("max");
  if (mode === "use") $("#quantity-input").max = item.quantity_box;
  $("#quantity-input").value = mode === "stock" ? item.quantity_box : "";
  setText("#quantity-label", mode === "stock" ? "Stok aktual (BOX)" : mode === "use" ? "Jumlah digunakan (BOX)" : "Jumlah diminta (BOX)");
  setText("#quantity-help", mode === "stock" ? "Angka ini menggantikan stok saat ini, bukan menambah stok." : mode === "use" ? "Stok akan berkurang sesuai jumlah yang digunakan." : "Buat permintaan baru. Stok bertambah setelah BOP menyelesaikan request.");
  setText("#quantity-submit", mode === "stock" ? "Simpan stok aktual" : mode === "use" ? "Konfirmasi USE" : "Kirim REQUEST");
  setText("#action-feedback", "");
  $("#quantity-input").focus();
}

async function submitQuantity(event) {
  event.preventDefault();
  if (busy || !dataReady) return;
  const item = currentMaterial();
  if (!item) return;
  const raw = $("#quantity-input").value.trim();
  const quantity = Number(raw);
  const minimum = actionMode === "stock" ? 0 : 1;
  if (!raw || !Number.isSafeInteger(quantity) || quantity < minimum) {
    setText("#action-feedback", `Masukkan bilangan bulat minimal ${minimum} BOX.`);
    return;
  }
  if (actionMode === "use" && quantity > Number(item.quantity_box)) {
    setText("#action-feedback", "Jumlah melebihi stok tersedia.");
    return;
  }
  if (actionMode === "request" && hasActiveRequest(item)) {
    setText("#action-feedback", "Masih ada request aktif untuk material ini.");
    return;
  }
  const rpcName = isViewer
    ? {use: "use_armature", request: "create_armature_request"}[actionMode]
    : actionMode === "stock" ? "update_armature_stock" : null;
  if (!rpcName) return;
  setBusy(true);
  setText("#action-feedback", "Memproses...");
  try {
    const { error } = await window.appDataService.callRpc(rpcName, {
      p_armature_id: item.id,
      p_quantity_box: quantity,
    });
    if (error) throw error;
    $("#quantity-form").reset();
    setQuantityFormVisible(false);
    const refreshed = await loadMaterials();
    setText("#action-feedback", refreshed ? "Berhasil disimpan. Data terbaru sudah dimuat." : "Tersimpan, tetapi data terbaru gagal dimuat. Muat ulang halaman; jangan kirim ulang.");
  } catch (error) {
    console.error(rpcName, error);
    setText("#action-feedback", "Aksi gagal dikonfirmasi. Periksa koneksi dan muat ulang data sebelum mencoba lagi.");
  } finally {
    setBusy(false);
  }
}

$("#quantity-form").addEventListener("submit", submitQuantity);
$("#quantity-cancel").addEventListener("click", () => { if (!busy) setQuantityFormVisible(false); });
$("#logout").addEventListener("click", async () => {
  if (busy) return;
  $("#logout").disabled = true;
  try {
    await window.authService.logout();
  } catch (error) {
    console.error("Logout error:", error);
    dashboardError.textContent = "Logout gagal. Silakan coba lagi.";
    dashboardError.style.display = "block";
    $("#logout").disabled = false;
  }
});

function nextRequestStatus(item) {
  if (!item || !hasActiveRequest(item)) return null;
  return { PENDING: "ONGOING", ONGOING: "DONE" }[item.active_request_status] || null;
}

function setupRequestFlowUi() {
  const options = document.querySelector(".status-options");
  if (options) {
    options.innerHTML = `<button class="active" data-status="ONGOING"><span>✓</span><div><b>Mulai Proses</b><small>Request sedang diproses oleh Gedung 1.</small></div><em>Pilih</em></button>`;
  }
  const notice = document.querySelector(".notice p");
  if (notice) notice.textContent = "PENDING: request baru, belum diproses. ONGOING: sedang diproses oleh Gedung 1. DONE: selesai / material siap untuk Gedung 2.";
}

function refreshRequestActions() {
  const item = currentMaterial();
  const next = nextRequestStatus(item);
  document.querySelectorAll(".status-options button").forEach((button) => {
    button.dataset.status = next || "";
    button.disabled = busy || !dataReady || button.dataset.status !== next;
    button.classList.toggle("active", button.dataset.status === next);
    const action = next === "ONGOING"
      ? {
          label: "Mulai Proses",
          description: "Request sedang diproses oleh Gedung 1.",
        }
      : next === "DONE"
        ? {
            label: "Selesaikan Request",
            description: "Request selesai / material siap untuk Gedung 2.",
          }
        : null;
    if (action) {
      button.querySelector("b").textContent = action.label;
      button.querySelector("small").textContent = action.description;
    }
  });
  $("#save-request").disabled = busy || !dataReady || !next;
  $("#delete-request").disabled = busy || !dataReady || !item || item.active_request_status !== "PENDING";
  setText(
    "#save-request",
    next === "ONGOING"
      ? "Mulai Proses"
      : next === "DONE"
        ? "Selesaikan Request"
        : "Tidak ada request aktif",
  );
}

function openRequest() {
  const item = currentMaterial();
  if (!item || busy || !dataReady || !hasActiveRequest(item)) return;
  for (const [selector,value] of Object.entries({
    "#r-part": item.part_number, "#r-type": item.armature_type,
    "#r-title": `Armature ${item.part_number}`, "#r-type-detail": item.armature_type,
    "#r-local": getSupplyLabel(item.konmi), "#r-konmi": `(Konmi ${displayValue(item.konmi)})`,
    "#r-color": item.color, "#r-supply": item.konmi, "#r-local-detail": getSupplyLabel(item.konmi),
    "#r-stock": `${item.quantity_box} BOX`, "#r-request-quantity": `${item.active_request_quantity_box} BOX`,
    "#r-status-text": item.active_request_status, "#r-request-status": item.active_request_status,
    "#r-requester": item.requested_by, "#r-date": formatDateTime(item.active_request_at),
    "#r-stock-status": getStockStatus(item)
  })) setText(selector, displayValue(value));
  $("#r-stock-status").className = `status ${statusClass(getStockStatus(item))}`;
  $("#r-request-status").className = "status waiting";
  setText("#request-feedback", "");
  closeStock();
  $("#request-backdrop").classList.add("show");
  $("#request-backdrop").setAttribute("aria-hidden", "false");
  refreshRequestActions();
}

function closeRequest() {
  if (busy) return;
  $("#request-backdrop").classList.remove("show");
  $("#request-backdrop").setAttribute("aria-hidden", "true");
}

async function submitRequestStatus() {
  const item = currentMaterial();
  const next = nextRequestStatus(item);
  if (busy || !dataReady || !next) return;
  setBusy(true);
  setText("#request-feedback", "Memproses...");
  let succeeded = false;
  try {
    const rpcArgs = {
      p_request_id: item.active_request_id,
      p_status: next,
    };
    const { error } = await window.appDataService.callRpc("update_request_status", rpcArgs);
    if (error) throw error;
    succeeded = true;
  } catch (error) {
    console.error("update_request_status failed:", {
      message: error?.message,
      code: error?.code,
      details: error?.details,
      hint: error?.hint,
      p_request_id: item.active_request_id,
      p_status: next,
    });
  }
  if (!succeeded) {
    setBusy(false);
    if (currentMaterial() && hasActiveRequest(currentMaterial())) openRequest();
    setText("#request-feedback", "Status gagal dikonfirmasi. Periksa status terbaru sebelum mencoba lagi.");
    return;
  }

  const refreshed = await loadMaterials();
  setBusy(false);
  closeRequest();
  if (refreshed && currentMaterial()) {
    openStock(currentMaterial());
    setText("#action-feedback", `Request diperbarui menjadi ${next}.`);
  }
}

async function deleteRequest() {
  const item = currentMaterial();
  if (busy || !dataReady || !item || item.active_request_status !== "PENDING") return;
  if (!window.confirm("Hapus request PENDING ini?")) return;

  setBusy(true);
  setText("#request-feedback", "Menghapus request...");
  let succeeded = false;
  try {
    const { error } = await window.appDataService.callRpc("delete_armature_request", {
      p_request_id: item.active_request_id,
    });
    if (error) throw error;
    succeeded = true;
  } catch (error) {
    console.error("delete_armature_request:", error);
  }
  if (!succeeded) {
    setBusy(false);
    if (currentMaterial() && hasActiveRequest(currentMaterial())) openRequest();
    setText("#request-feedback", "Request gagal dihapus. Periksa status terbaru sebelum mencoba lagi.");
    return;
  }

  const refreshed = await loadMaterials();
  setBusy(false);
  closeRequest();
  if (refreshed && currentMaterial()) {
    openStock(currentMaterial());
    setText("#action-feedback", "Request dihapus.");
  }
}
$("#handle-request").addEventListener("click", openRequest);
$("#request-preview").addEventListener("click", openRequest);
$("#close-request").addEventListener("click", closeRequest);
$("#cancel-request").addEventListener("click", closeRequest);
$("#save-request").addEventListener("click", submitRequestStatus);
$("#delete-request").addEventListener("click", deleteRequest);
$("#request-backdrop").addEventListener("click", event => { if (event.target.id === "request-backdrop") closeRequest(); });

setupRequestFlowUi();
initializeDashboard();
