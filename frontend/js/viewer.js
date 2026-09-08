const grid = document.querySelector("#grid");
const empty = document.querySelector("#empty");
const loading = document.querySelector("#loading");
const dashboardError = document.querySelector("#dashboard-error");
let materials = [];
let selectedId = null;
let busy = false;
let dataReady = false;
let actionMode = null;
const isViewer = true;
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
  return material.active_request_id !== null && material.active_request_id !== undefined;
}

function requestLabel(material) {
  if (!hasActiveRequest(material)) return "";
  return `<span class="request-label">Request ${escapeHtml(displayValue(material.active_request_quantity_box))} BOX · ${escapeHtml(displayValue(material.active_request_status))}</span>`;
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
      <div class="card-body"><h2>Armature ${part.replace(":", "")}</h2><p class="card-meta"><span class="tag ${supplyClass}">${supplyLabel}</span>(Konmi ${escapeHtml(displayValue(material.konmi))})${isViewer ? ` · Warna ${escapeHtml(displayValue(material.color))}` : ""}</p>${requestLabel(material)}
      <div class="quantity-row"><small>Quantity</small><strong>${quantity} <span>BOX</span></strong><b class="status ${statusClass(status)}">${escapeHtml(status)}</b></div>
      <div class="card-footer"><div>▣<span><small>Last Update</small><b>${formatDateTime(material.last_stock_update)}</b></span></div><div>♙<span><small>Updated by</small><b>${escapeHtml(displayValue(material.stock_updated_by))}</b></span></div></div></div>
    </article>`;
  }).join("");

  empty.style.display = materials.length ? "none" : "block";
  renderSummary();
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
    document.querySelector("#request-status").className = material.active_request_status === "ONGOING" ? "ongoing" : "waiting";
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
  loading.style.display = "block";
  empty.style.display = "none";
  dashboardError.style.display = "none";
  dataReady = false;
  try {
    const { data, error } = await window.supabaseClient
      .from("armature_dashboard")
      .select("*")
      .eq("armature_type", "K62")
      .eq("is_active", true)
      .order("part_number");
    if (error) throw error;
    materials = data || [];
    dataReady = true;
    renderCards();
    const selected = materials.find(item => item.id === selectedId);
    if (selected) populate(selected);
    else {
      $("#backdrop").classList.remove("show");
      $("#backdrop").setAttribute("aria-hidden", "true");
    }
    return true;
  } catch (error) {
    console.error("Dashboard data error:", error);
    dashboardError.textContent = "Data tidak dapat dimuat. Muat ulang halaman sebelum melakukan aksi.";
    dashboardError.style.display = "block";
    grid.innerHTML = "";
    setText("#summary-material-count", "-");
    setText("#summary-total-quantity", "-");
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
  let committed = false;
  try {
    const { error } = await window.supabaseClient.rpc(rpcName, {
      p_armature_id: item.id,
      p_quantity_box: quantity,
    });
    if (error) throw error;
    committed = true;
    $("#quantity-form").reset();
    setQuantityFormVisible(false);
    const refreshed = await loadMaterials();
    setText("#action-feedback", refreshed ? "Berhasil disimpan. Data terbaru sudah dimuat." : "Tersimpan, tetapi data terbaru gagal dimuat. Muat ulang halaman; jangan kirim ulang.");
  } catch (error) {
    console.error(rpcName, error);
    setText("#action-feedback", "Aksi gagal dikonfirmasi. Periksa koneksi dan muat ulang data sebelum mencoba lagi.");
    // Refresh after rejection too: another user may have changed stock/request.
    await loadMaterials();
    if (committed) setText("#action-feedback", "Tersimpan. Muat ulang halaman untuk melihat data terbaru.");
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
    const { error } = await window.supabaseClient.auth.signOut();
    if (error) throw error;
    window.location.assign("../LOGIN/index.html");
  } catch (error) {
    console.error("Logout error:", error);
    dashboardError.textContent = "Logout gagal. Silakan coba lagi.";
    dashboardError.style.display = "block";
    $("#logout").disabled = false;
  }
});

$("#handle-request").addEventListener("click", () => openQuantity("request"));
initializeDashboard();
