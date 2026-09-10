const grid = document.querySelector("#grid");
const empty = document.querySelector("#empty");
const loading = document.querySelector("#loading");
const dashboardError = document.querySelector("#dashboard-error");
let materials = [];
let selectedId = null;
let busy = false;
let dataReady = false;
let actionMode = null;
let activeRequestOrder = [];
let draggedRequestId = null;
let requestOrderSaving = false;
let requestHistoryRows = [];
let runningStates = [];
const MAX_CARD_REQUEST_HISTORY = 3;
const isViewer = true;
const $ = (selector) => document.querySelector(selector);
const escapeHtml = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ],
  );

const setText = (selector, value) => {
  const element = document.querySelector(selector);
  if (!element) return;
  element.textContent = value;
  if (selector === "#action-feedback" || selector === "#request-feedback") {
    element.classList.toggle(
      "success",
      /berhasil|tersimpan|diperbarui/i.test(String(value)),
    );
    element.classList.toggle(
      "error",
      /gagal|melebihi|masukkan|tidak dapat|tidak ada|periksa|masih ada/i.test(
        String(value),
      ),
    );
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
  })
    .format(date)
    .replace(",", " ·");
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

function cardIcon(name) {
  const icons = {
    box: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z"/><path d="m4.5 7.7 7.5 4.2 7.5-4.2M12 12v9M8.3 5.1l7.5 4.3"/></svg>',
    history: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h7l4 4v14H7z"/><path d="M14 3v5h5M10 12h5M10 16h5"/></svg>',
    movement: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 4v15m0 0-3-3m3 3 3-3M16 20V5m0 0-3 3m3-3 3 3"/></svg>',
    clock: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3.5 2"/></svg>',
    user: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3"/><path d="M6.5 20v-2.5a5.5 5.5 0 0 1 11 0V20"/></svg>',
    check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 12.5 3.2 3.2L17.5 8.5"/></svg>',
  };
  return icons[name] || "";
}

function renderLastMovement(material) {
  const type = String(material.last_movement_type || "").toUpperCase();
  const delta = Number(material.last_movement_quantity_changed);
  let title = "No movement yet";
  let detail = "Belum ada pergerakan barang.";
  let stateClass = "empty";

  if (type === "USE" && Number.isFinite(delta)) {
    title = `USED ${Math.abs(delta)} BOX`;
    detail = `${escapeHtml(formatMovementTime(material.last_movement_at))} &middot; ${escapeHtml(displayValue(material.last_movement_performed_by))}`;
    stateClass = "has-movement use";
  } else if (type === "STOCK_UPDATE" && Number.isFinite(delta)) {
    const sign = delta >= 0 ? "+" : "";
    title = `STOCK ${sign}${delta} BOX`;
    detail = `${escapeHtml(formatMovementTime(material.last_movement_at))} &middot; ${escapeHtml(displayValue(material.last_movement_performed_by))}`;
    stateClass = "has-movement stock-update";
  }

  return `<section class="last-movement" aria-label="Last movement ${escapeHtml(material.part_number)}">
    <small>Last Movement</small>
    <div class="last-movement-panel ${stateClass}">
      <span class="card-panel-icon">${cardIcon("movement")}</span>
      <span><b>${title}</b><em>${detail}</em></span>
    </div>
  </section>`;
}

function getSupplyLabel(konmi) {
  if (!konmi) return "-";
  return String(konmi).toUpperCase().includes("CKD") ? "CKD" : "Lokal";
}

function getTone(color) {
  const tones = {
    biru: "blue",
    merah: "red",
    ungu: "purple",
    kuning: "yellow",
    hijau: "green",
  };
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
      return (
        rightTime - leftTime || String(right.id).localeCompare(String(left.id))
      );
    })
    .slice(0, MAX_CARD_REQUEST_HISTORY);
}

function renderMaterialRequestHistory(material) {
  const history = getMaterialRequestHistory(material);
  const entries = history.length
    ? history
        .map(
          (request) => `<div class="material-history-item">
          <b>${Number(request.requested_quantity_box) || 0} BOX</b>
          <span class="history-status">DONE</span>
          <small><span>${escapeHtml(formatDateTime(request.completed_at || request.handled_at))}</span><em>${cardIcon("user")}${escapeHtml(displayValue(request.handled_by))}</em></small>
        </div>`,
        )
        .join("")
    : `<div class="material-history-empty">${cardIcon("history")}<span><b>No request history</b><small>Belum ada riwayat request.</small></span></div>`;

  return `<section class="material-history" aria-label="Riwayat request ${escapeHtml(material.part_number)}">
    <div class="material-history-header"><small>Riwayat Request</small><b>${history.length ? `${history.length} terakhir` : ""}<span aria-hidden="true">&rsaquo;</span></b></div>
    <div class="material-history-list">${entries}</div>
  </section>`;
}

function statusClass(status) {
  return status === "EMPTY" ? "empty" : "ready";
}

function renderSummary() {
  const totalQuantity = materials.reduce(
    (total, material) => total + (Number(material.quantity_box) || 0),
    0,
  );
  document.querySelector("#summary-material-count").innerHTML =
    `${materials.length} <em>(K62)</em>`;
  document.querySelector("#summary-total-quantity").innerHTML =
    `${totalQuantity} <em>(Total semua material)</em>`;
}

const RUNNING_MACHINES = [
  { code: "MODULE", label: "MODULE", className: "module", icon: "box" },
  { code: "TRANSFER_LINE", label: "TRANSFER LINE", className: "transfer", icon: "movement" },
];

function renderRunningCards() {
  const runningGrid = document.querySelector("#running-grid");
  if (!runningGrid) return;

  runningGrid.innerHTML = RUNNING_MACHINES.map((machine) => {
    const state = runningStates.find((item) => item.machine_code === machine.code) || {
      machine_code: machine.code,
      is_machine_down: false,
      armature_id: null,
    };
    const material = state.armature_id
      ? materials.find((item) => String(item.id) === String(state.armature_id))
      : null;
    const isDown = state.is_machine_down === true;
    const isRunning = !isDown && Boolean(material);
    const stateLabel = isDown ? "MACHINE DOWN" : isRunning ? "RUNNING" : "NOT RUNNING";
    const partNumber = material ? escapeHtml(displayValue(material.part_number)) : "Tidak ada ARMATURE";
    const materialDetail = material
      ? `${escapeHtml(displayValue(material.armature_type))} &middot; ${escapeHtml(getSupplyLabel(material.konmi).toUpperCase())}`
      : "yang sedang running";

    return `<article class="running-card ${machine.className} ${isDown ? "machine-down" : isRunning ? "is-running" : "not-running"}" aria-label="Status ${machine.label}">
      <header class="running-card-header"><span class="running-machine-icon">${cardIcon(machine.icon)}</span><div><h3>${machine.label}</h3><small>Armature Monitoring</small></div><span class="running-type">K62</span></header>
      <span class="running-state"><i></i>${stateLabel}</span>
      <div class="running-material"><div><small>Armature yang sedang running</small><strong>${partNumber}</strong><span>${materialDetail}</span></div><span class="running-condition">${isDown ? "MESIN RUSAK" : "MESIN NORMAL"}</span></div>
    </article>`;
  }).join("");
}

async function loadRunningStates() {
  const feedback = document.querySelector("#running-feedback");
  const previousStates = runningStates;
  try {
    const { data, error } = await window.appDataService.loadRunningStates();
    if (error) throw error;
    runningStates = data || [];
    renderRunningCards();
    if (feedback) feedback.textContent = "";
    return true;
  } catch (error) {
    console.error("Armature running data error:", error);
    runningStates = previousStates;
    renderRunningCards();
    if (feedback) feedback.textContent = "Status armature running tidak dapat dimuat.";
    return false;
  }
}

function setupRequestHistoryToggle() {
  const toggle = document.querySelector("#request-history-toggle");
  const content = document.querySelector("#request-history-content");
  if (!toggle || !content) return;

  toggle.addEventListener("click", () => {
    const willOpen = toggle.getAttribute("aria-expanded") !== "true";
    toggle.setAttribute("aria-expanded", String(willOpen));
    content.hidden = !willOpen;
  });
}

function renderCards() {
  grid.innerHTML = materials
    .map((material) => {
      const part = escapeHtml(displayValue(material.part_number));
      const quantity = Number(material.quantity_box) || 0;
      const status = getStockStatus(material);
      const supplyLabel = getSupplyLabel(material.konmi);
      const supplyClass = supplyLabel === "CKD" ? "ckd" : "local";

      return `<article class="material-card tone-${getTone(material.color)}" data-id="${escapeHtml(material.id)}" tabindex="0" role="button" aria-label="Buka detail armature ${part}">
      <header class="card-head">
        <div class="card-identity"><small class="card-kicker">Kode Armature</small><div class="material-code"><b>${part}</b><span class="type-pill">${escapeHtml(displayValue(material.armature_type))}</span></div>
        <div class="card-tags"><span class="tag ${supplyClass}">${supplyLabel}</span><span class="color-meta"><i></i>${escapeHtml(displayValue(material.color))}</span></div></div>
        <img class="mini-armature" src="../assets/armature.png" alt="Armature ${part}">
        ${requestLabel(material)}
      </header>
      <div class="card-body">
        <section class="quantity-row" aria-label="Stock ${part}">
          <span class="quantity-icon">${cardIcon("box")}</span>
          <span class="quantity-copy"><small>Quantity</small><strong>${quantity} <em>BOX</em></strong></span>
          <b class="status ${statusClass(status)}"><span>${status === "READY" ? cardIcon("check") : ""}</span>${escapeHtml(status)}</b>
        </section>
        ${renderMaterialRequestHistory(material)}
        ${renderLastMovement(material)}
        <footer class="card-footer"><div>${cardIcon("clock")}<span><small>Last Update</small><b>${formatDateTime(material.last_stock_update)}</b></span></div><div>${cardIcon("user")}<span><small>Updated by</small><b>${escapeHtml(displayValue(material.stock_updated_by))}</b></span></div></footer>
      </div>
    </article>`;
    })
    .join("");

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
      const leftHasSequence =
        Number.isSafeInteger(leftSequence) && leftSequence > 0;
      const rightHasSequence =
        Number.isSafeInteger(rightSequence) && rightSequence > 0;
      if (leftHasSequence || rightHasSequence) {
        if (!leftHasSequence) return 1;
        if (!rightHasSequence) return -1;
        if (leftSequence !== rightSequence) return leftSequence - rightSequence;
      }
      const leftTime = Date.parse(left.active_request_at || "") || 0;
      const rightTime = Date.parse(right.active_request_at || "") || 0;
      return (
        leftTime - rightTime || String(left.id).localeCompare(String(right.id))
      );
    });
}

function renderActiveRequests(materialRows, resetOrder = true) {
  const panel = document.querySelector("#active-requests");
  const list = document.querySelector("#active-request-list");
  if (!panel || !list) return;

  if (resetOrder) activeRequestOrder = getActiveRequests(materialRows);
  panel.hidden = false;
  list.innerHTML = activeRequestOrder
    .map((material, index) => {
      const status = material.active_request_status;
      const statusClass = status === "ONGOING" ? "ongoing" : "waiting";
      return `<article class="active-request-item" data-request-id="${escapeHtml(material.active_request_id)}" draggable="${!requestOrderSaving}" role="listitem" aria-label="Request ${escapeHtml(material.part_number)} nomor ${index + 1}">
      <strong class="active-request-number">#${index + 1}</strong>
      <div class="active-request-detail"><b>${escapeHtml(material.part_number)}</b><span>${Number(material.active_request_quantity_box) || 0} BOX</span><small class="${statusClass}">${status}</small></div>
      <span class="active-request-handle" aria-hidden="true">☷</span>
    </article>`;
    })
    .join("");

  const emptyRequests = document.querySelector("#active-request-empty");
  if (emptyRequests) emptyRequests.hidden = activeRequestOrder.length > 0;
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
      return (
        rightTime - leftTime || String(right.id).localeCompare(String(left.id))
      );
    });

  panel.hidden = false;
  list.innerHTML = history
    .map(
      (request) => `<article class="request-history-item" role="listitem">
    <span class="request-history-check" aria-hidden="true">✓</span>
    <div><b>${escapeHtml(request.part_number)} · ${Number(request.requested_quantity_box) || 0} BOX</b><small>DONE</small><span>${escapeHtml(formatDateTime(request.completed_at || request.handled_at))} · ${escapeHtml(displayValue(request.handled_by))}</span></div>
  </article>`,
    )
    .join("");
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

async function persistActiveRequestOrder(previousOrder) {
  const feedback = document.querySelector("#active-request-feedback");
  requestOrderSaving = true;
  renderActiveRequests([], false);
  if (feedback) feedback.textContent = "Menyimpan urutan request...";

  try {
    const orderedRequestIds = activeRequestOrder.map(
      (material) => material.active_request_id,
    );
    console.debug(
      "reorder_armature_requests ordered request IDs:",
      orderedRequestIds,
    );
    const { error } = await window.appDataService.callRpc(
      "reorder_armature_requests",
      {
        p_request_ids: orderedRequestIds,
      },
    );
    if (error) throw error;

    const refreshed = await loadMaterials();
    if (!refreshed)
      throw new Error(
        "Urutan tersimpan, tetapi data terbaru tidak dapat dimuat.",
      );
    if (feedback) feedback.textContent = "Urutan request tersimpan.";
  } catch (error) {
    console.error("reorder_armature_requests:", {
      error,
      message: error?.message,
      details: error?.details,
      hint: error?.hint,
      code: error?.code,
    });
    activeRequestOrder = previousOrder;
    renderActiveRequests([], false);
    if (feedback)
      feedback.textContent =
        "Urutan tidak dapat disimpan. Data dikembalikan ke urutan terakhir tersimpan.";
  } finally {
    requestOrderSaving = false;
    renderActiveRequests([], false);
  }
}

function setupActiveRequestDragDrop() {
  const list = document.querySelector("#active-request-list");
  if (!list) return;

  list.addEventListener("dragstart", (event) => {
    if (requestOrderSaving) return;
    const item = event.target.closest(".active-request-item");
    if (!item) return;
    draggedRequestId = item.dataset.requestId;
    item.classList.add("dragging");
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", draggedRequestId);
  });

  list.addEventListener("dragover", (event) => {
    const item = event.target.closest(".active-request-item");
    if (!item || !draggedRequestId) return;
    event.preventDefault();
    item.classList.add("drop-target");
  });

  list.addEventListener("dragleave", (event) => {
    const item = event.target.closest(".active-request-item");
    if (item && !item.contains(event.relatedTarget))
      item.classList.remove("drop-target");
  });

  list.addEventListener("drop", async (event) => {
    event.preventDefault();
    const target = event.target.closest(".active-request-item");
    if (
      requestOrderSaving ||
      !draggedRequestId ||
      !target ||
      draggedRequestId === target.dataset.requestId
    )
      return;

    const currentOrder = [...activeRequestOrder];
    const previousOrder = [...activeRequestOrder];
    const draggedIndex = currentOrder.findIndex(
      (item) => String(item.active_request_id) === String(draggedRequestId),
    );
    const targetIndex = currentOrder.findIndex(
      (item) =>
        String(item.active_request_id) === String(target.dataset.requestId),
    );
    if (draggedIndex < 0 || targetIndex < 0) return;

    const [dragged] = currentOrder.splice(draggedIndex, 1);
    const adjustedTargetIndex = currentOrder.findIndex(
      (item) =>
        String(item.active_request_id) === String(target.dataset.requestId),
    );
    const targetRect = target.getBoundingClientRect();
    const insertIndex =
      event.clientY > targetRect.top + targetRect.height / 2
        ? adjustedTargetIndex + 1
        : adjustedTargetIndex;
    currentOrder.splice(insertIndex, 0, dragged);
    activeRequestOrder = currentOrder;
    renderActiveRequests([], false);
    await persistActiveRequestOrder(previousOrder);
  });

  list.addEventListener("dragend", () => {
    list
      .querySelectorAll(".dragging, .drop-target")
      .forEach((item) => item.classList.remove("dragging", "drop-target"));
    draggedRequestId = null;
  });
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
  setText(
    "#m-konmi",
    `(Konmi ${displayValue(material.konmi)} · Warna ${displayValue(material.color)})`,
  );
  setText("#m-update", formatDateTime(material.last_stock_update));
  document.querySelector("#m-qty").innerHTML = `${quantity} <span>BOX</span>`;
  const stockStatus = document.querySelector("#m-status");
  stockStatus.textContent = status;
  stockStatus.className = `status ${statusClass(status)}`;
  document.querySelector(".stock-current > div:last-child em").textContent =
    `by ${displayValue(material.stock_updated_by)}`;

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
    setText(
      "#request-quantity",
      `${displayValue(material.active_request_quantity_box)} BOX`,
    );
    const requestStatus = material.active_request_status;
    setText("#request-status", requestStatus);
    document.querySelector("#request-status").className =
      requestStatus === "ONGOING" ? "ongoing" : "waiting";
    let statusMessage = document.querySelector("#request-status-message");
    if (!statusMessage) {
      statusMessage = document.createElement("small");
      statusMessage.id = "request-status-message";
      statusMessage.className = "request-status-message";
      document
        .querySelector("#request-status")
        .parentElement.append(statusMessage);
    }
    setText(
      "#request-status-message",
      requestStatus === "ONGOING"
        ? "Request sedang diproses oleh Gedung 1."
        : "Request baru, belum diproses.",
    );
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
    await loadRunningStates();
    const selected = materials.find((item) => item.id === selectedId);
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
      renderActiveRequests([], false);
      renderRequestHistory(requestHistoryRows);
    } else {
      dashboardError.textContent =
        "Data tidak dapat dimuat. Muat ulang halaman sebelum melakukan aksi.";
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
  openStock(
    materials.find((material) => String(material.id) === card.dataset.id),
  );
});
grid.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  const card = event.target.closest(".material-card");
  if (!card) return;
  event.preventDefault();
  openStock(
    materials.find((material) => String(material.id) === card.dataset.id),
  );
});

document.querySelector("#close-modal").addEventListener("click", closeStock);
document
  .querySelector("#update-stock")
  .addEventListener("click", () => openQuantity(isViewer ? "use" : "stock"));
document.querySelector("#backdrop").addEventListener("click", (event) => {
  if (event.target.id === "backdrop") closeStock();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeStock();
    if (!isViewer) closeRequest();
  }
});

async function initializeDashboard() {
  const authenticated = await window.authGuardReady;
  if (!authenticated) return;
  await loadMaterials();
}

setupActiveRequestDragDrop();
setupRequestHistoryToggle();

function currentMaterial() {
  return materials.find((item) => item.id === selectedId);
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
  document
    .querySelectorAll(
      "#backdrop button, #backdrop input, #request-backdrop button, #logout",
    )
    .forEach((element) => {
      element.disabled = value;
    });
  const quantitySubmit = $("#quantity-submit");
  if (quantitySubmit) {
    if (value) {
      quantitySubmit.dataset.defaultLabel ||= quantitySubmit.textContent;
      quantitySubmit.innerHTML =
        '<span class="button-spinner" aria-hidden="true"></span><span>Memproses...</span>';
      quantitySubmit.setAttribute("aria-busy", "true");
    } else {
      quantitySubmit.textContent =
        quantitySubmit.dataset.defaultLabel || "Simpan";
      quantitySubmit.removeAttribute("aria-busy");
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
  setText(
    "#quantity-label",
    mode === "stock"
      ? "Stok aktual (BOX)"
      : mode === "use"
        ? "Jumlah digunakan (BOX)"
        : "Jumlah diminta (BOX)",
  );
  setText(
    "#quantity-help",
    mode === "stock"
      ? "Angka ini menggantikan stok saat ini, bukan menambah stok."
      : mode === "use"
        ? "Stok akan berkurang sesuai jumlah yang digunakan."
        : "Buat permintaan baru. Stok bertambah setelah BOP menyelesaikan request.",
  );
  setText(
    "#quantity-submit",
    mode === "stock"
      ? "Simpan stok aktual"
      : mode === "use"
        ? "Konfirmasi USE"
        : "Kirim REQUEST",
  );
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
    setText(
      "#action-feedback",
      `Masukkan bilangan bulat minimal ${minimum} BOX.`,
    );
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
    ? { use: "use_armature", request: "create_armature_request" }[actionMode]
    : actionMode === "stock"
      ? "update_armature_stock"
      : null;
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
    setText(
      "#action-feedback",
      refreshed
        ? "Berhasil disimpan. Data terbaru sudah dimuat."
        : "Tersimpan, tetapi data terbaru gagal dimuat. Muat ulang halaman; jangan kirim ulang.",
    );
  } catch (error) {
    console.error(rpcName, error);
    setText(
      "#action-feedback",
      "Aksi gagal dikonfirmasi. Periksa koneksi dan muat ulang data sebelum mencoba lagi.",
    );
  } finally {
    setBusy(false);
  }
}

$("#quantity-form").addEventListener("submit", submitQuantity);
$("#quantity-cancel").addEventListener("click", () => {
  if (!busy) setQuantityFormVisible(false);
});
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

$("#handle-request").addEventListener("click", () => openQuantity("request"));
initializeDashboard();
