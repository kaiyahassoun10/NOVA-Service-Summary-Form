// Utilities

const $ = (sel, el = document) => el.querySelector(sel);

const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));

const photosEl = $("#photos");

const photoTpl = $("#photoTemplate");

const MAX_PHOTOS_DEFAULT = 6;

const MAX_DIMENSION = 1800; // downscale long side to reduce UI size
const MAX_DIMENSION_PRINT = 1800; // balanced quality for email-friendly PDFs
const PRINT_JPEG_QUALITY = 0.8;

// Init

document.addEventListener("DOMContentLoaded", () => {
  // Start with a few photo slots

  for (let i = 0; i < MAX_PHOTOS_DEFAULT; i++) addPhotoCard();

  // Actions

  $("#addPhoto").addEventListener("click", () => addPhotoCard());

  $("#saveBtn").addEventListener("click", saveReport);

  $("#loadBtn").addEventListener("click", loadReport);

  $("#clearBtn").addEventListener("click", clearReport);

  $("#printBtn").addEventListener("click", async () => {
    await prepareAndPrint();
  });

  window.addEventListener("beforeprint", buildPrintView);

  // Bulk upload

  $("#bulkInput").addEventListener("change", (e) => {
    if (!e.target.files?.length) return;

    const files = Array.from(e.target.files);
    loadFiles(files);

    e.target.value = ""; // reset
  });

  // Drag & drop

  const dz = $("#dropzone");

  ["dragenter", "dragover"].forEach((evt) =>
    dz.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dz.classList.add("dragover");
    }),
  );

  ["dragleave", "drop"].forEach((evt) =>
    dz.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dz.classList.remove("dragover");
    }),
  );

  dz.addEventListener("drop", (e) => {
    const files = e.dataTransfer?.files;

    if (files && files.length) loadFiles(files);
  });

  // Autofill date if empty

  const dateEl = $("#reportDate");

  if (!dateEl.value) {
    const d = new Date();

    const yyyy = d.getFullYear();

    const mm = String(d.getMonth() + 1).padStart(2, "0");

    const dd = String(d.getDate()).padStart(2, "0");

    dateEl.value = `${yyyy}-${mm}-${dd}`;
  }
});

async function loadFiles(fileList) {
  let lastAdded = null;
  const files = Array.from(fileList);
  const insertBefore = photosEl.firstChild;
  for (const file of files) {
    if (!isImageFile(file)) continue;

    try {
      const normalized = await normalizeImageFile(file);
      const { previewUrl, printUrl } = await readImageVariants(normalized);

      lastAdded = addPhotoCard({
        image: previewUrl,
        printImage: printUrl,
        caption: "",
        size: humanFileSize(normalized.size),
      });
      if (insertBefore) {
        photosEl.insertBefore(lastAdded, insertBefore);
      }
    } catch (err) {
      console.warn("Skipping file (could not read image):", file.name, err);
    }
  }
  if (lastAdded) {
    lastAdded.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
}

async function normalizeImageFile(file) {
  if (!isHeicFile(file)) return file;

  if (typeof heic2any !== "function") {
    throw new Error("heic2any is not available");
  }

  const converted = await heic2any({
    blob: file,
    toType: "image/jpeg",
    quality: 0.9,
  });

  const blob = Array.isArray(converted) ? converted[0] : converted;
  const baseName = file.name.replace(/\.[^.]+$/, "");
  return new File([blob], `${baseName}.jpg`, { type: "image/jpeg" });
}

function isHeicFile(file) {
  if (file.type && (file.type === "image/heic" || file.type === "image/heif")) {
    return true;
  }

  const ext = file.name.split(".").pop()?.toLowerCase();
  return ext === "heic" || ext === "heif";
}

function isImageFile(file) {
  if (file.type && file.type.startsWith("image/")) return true;

  const ext = file.name.split(".").pop()?.toLowerCase();
  const ok = new Set([
    "jpg",
    "jpeg",
    "png",
    "gif",
    "webp",
    "bmp",
    "tif",
    "tiff",
    "heic",
    "heif",
  ]);
  return ok.has(ext);
}

function addPhotoCard(data) {
  const node = photoTpl.content.cloneNode(true);

  const el = node.querySelector("[data-photo]");

  const input = el.querySelector("[data-input]");

  const preview = el.querySelector("[data-preview]");

  const caption = el.querySelector("[data-caption]");

  const removeBtn = el.querySelector("[data-remove]");

  const sizeEl = el.querySelector("[data-size]");

  input.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];

    if (!file) return;

    const normalized = await normalizeImageFile(file);
    const { previewUrl, printUrl } = await readImageVariants(normalized);

    setPreview(preview, previewUrl);

    sizeEl.textContent = humanFileSize(normalized.size);

    el.dataset.image = previewUrl; // store
    el.dataset.printImage = printUrl;
  });

  removeBtn.addEventListener("click", () => {
    el.classList.add("removing");
    setTimeout(() => el.remove(), 160);
  });

  if (data) {
    if (data.image) setPreview(preview, data.image);

    if (data.caption) caption.value = data.caption;

    if (data.size) sizeEl.textContent = data.size;

    el.dataset.image = data.image || "";
    el.dataset.printImage = data.printImage || "";
  }

  photosEl.appendChild(node);

  return el;
}

function setPreview(previewEl, dataUrl) {
  previewEl.innerHTML = "";

  const img = document.createElement("img");

  img.src = dataUrl;

  previewEl.appendChild(img);
}

function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => resolve(reader.result);

    reader.onerror = reject;

    reader.readAsDataURL(file);
  });
}

async function readAndMaybeDownscale(file) {
  // Read original

  const origUrl = await fileToDataURL(file);

  // Downscale via canvas if larger than MAX_DIMENSION

  const img = await createImage(origUrl);

  const { width, height } = fitWithin(img.width, img.height, MAX_DIMENSION);

  if (width === img.width && height === img.height) return origUrl;

  const canvas = document.createElement("canvas");

  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");

  ctx.drawImage(img, 0, 0, width, height);

  // Use JPEG to compress; quality 0.85 is a good balance

  return canvas.toDataURL("image/jpeg", 0.85);
}

async function readImageVariants(file) {
  const origUrl = await fileToDataURL(file);
  const img = await createImage(origUrl);

  const previewUrl = downscaleFromImage(
    img,
    origUrl,
    MAX_DIMENSION,
    0.85,
  );
  const printUrl = downscaleFromImage(
    img,
    origUrl,
    MAX_DIMENSION_PRINT,
    PRINT_JPEG_QUALITY,
    true,
  );

  return { previewUrl, printUrl };
}

function downscaleFromImage(img, origUrl, maxSide, quality, forceJpeg = false) {
  const { width, height } = fitWithin(img.width, img.height, maxSide);

  if (width === img.width && height === img.height && !forceJpeg) return origUrl;

  const canvas = document.createElement("canvas");

  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");

  ctx.drawImage(img, 0, 0, width, height);

  return canvas.toDataURL("image/jpeg", quality);
}

function createImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();

    img.onload = () => resolve(img);

    img.onerror = reject;

    img.src = src;
  });
}

function fitWithin(w, h, maxSide) {
  const ratio = Math.max(w, h) / maxSide;

  if (ratio <= 1) return { width: w, height: h };

  return { width: Math.round(w / ratio), height: Math.round(h / ratio) };
}

function humanFileSize(bytes) {
  const thresh = 1000;

  if (Math.abs(bytes) < thresh) return bytes + " B";

  const units = ["kB", "MB", "GB", "TB"];

  let u = -1;

  do {
    bytes /= thresh;

    ++u;
  } while (Math.abs(bytes) >= thresh && u < units.length - 1);

  return bytes.toFixed(1) + " " + units[u];
}

// Save/Load (localStorage, images as data URLs)

function reportKey() {
  const client = $("#clientName").value.trim() || "client";

  const prop = $("#propertyName").value.trim() || "property";

  return `photo-report::${client}::${prop}`;
}

async function saveReport() {
  const data = {
    clientName: $("#clientName").value,

    propertyName: $("#propertyName").value,

    reportDate: $("#reportDate").value,

    preparedBy: $("#preparedBy").value,

    summary: $("#summary").value,

    photos: $$(".card[data-photo]").map((card) => ({
      image: card.dataset.image || "",
      printImage: card.dataset.printImage || "",

      caption: $("[data-caption]", card).value,

      size: $("[data-size]", card).textContent || "",
    })),
  };

  try {
    await idbSet(reportKey(), data);
    alert("Saved on this device.");
  } catch (e) {
    alert("Could not save locally (storage may be full).");
  }
}

async function loadReport() {
  let data = null;
  try {
    data = await idbGet(reportKey());
  } catch (e) {
    data = null;
  }

  if (!data) {
    alert("No saved report found for this client/property.");
    return;
  }

  $("#clientName").value = data.clientName || "";

  $("#propertyName").value = data.propertyName || "";

  $("#reportDate").value = data.reportDate || "";

  $("#preparedBy").value = data.preparedBy || "";

  $("#summary").value = data.summary || "";

  photosEl.innerHTML = "";

  (data.photos || []).forEach((p) => addPhotoCard(p));

  if ((data.photos || []).length === 0) {
    for (let i = 0; i < MAX_PHOTOS_DEFAULT; i++) addPhotoCard();
  }
}

function openReportDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("nova-service-reports", 1);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("reports")) {
        db.createObjectStore("reports");
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function idbSet(key, value) {
  const db = await openReportDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("reports", "readwrite");
    const store = tx.objectStore("reports");
    store.put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbGet(key) {
  const db = await openReportDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("reports", "readonly");
    const store = tx.objectStore("reports");
    const req = store.get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

function clearReport() {
  if (!confirm("Clear all fields and photos?")) return;

  $("#clientName").value = "";

  $("#propertyName").value = "";

  $("#reportDate").value = "";

  $("#preparedBy").value = "";

  $("#summary").value = "";

  photosEl.innerHTML = "";

  for (let i = 0; i < MAX_PHOTOS_DEFAULT; i++) addPhotoCard();
}

// Build the clean print view

function buildPrintView() {
  $("#pvClient").textContent = $("#clientName").value || "";

  $("#pvProperty").textContent = $("#propertyName").value || "";

  $("#pvDate").textContent = $("#reportDate").value || "";

  $("#pvPrepared").textContent = $("#preparedBy").value || "";

  $("#pvSummary").textContent = $("#summary").value || "";

  const pvPhotos = $("#pvPhotos");

  pvPhotos.innerHTML = "";
  pvPhotos.classList.remove("has-photos");

  let photoPage = null;
  let photoCount = 0;

  $$(".card[data-photo]").forEach((card) => {
    const imgData = card.dataset.printImage || card.dataset.image || "";

    const caption = $("[data-caption]", card).value || "";

    if (!imgData && !caption) return;

    const wrap = document.createElement("div");

    wrap.className = "pv-photo";

    if (imgData) {
      const img = document.createElement("img");

      img.src = imgData;

      const imgWrap = document.createElement("div");

      imgWrap.className = "pv-photo-img";

      imgWrap.appendChild(img);
      wrap.appendChild(imgWrap);
    }

    if (caption) {
      const cap = document.createElement("div");

      cap.className = "pv-caption";

      cap.textContent = caption;

      wrap.appendChild(cap);
    }

    if (photoCount % 6 === 0) {
      photoPage = document.createElement("div");
      photoPage.className = "pv-photos-page";
      pvPhotos.appendChild(photoPage);
    }

    photoPage.appendChild(wrap);
    photoCount += 1;
  });

  if (pvPhotos.children.length > 0) {
    pvPhotos.classList.add("has-photos");
  }
}

async function prepareAndPrint() {
  buildPrintView();
  await waitForPrintImages();
  window.print();
}

function waitForPrintImages() {
  const images = Array.from(
    document.querySelectorAll("#printView .pv-photo-img img"),
  );

  if (images.length === 0) return Promise.resolve();

  return Promise.all(
    images.map(
      (img) =>
        new Promise((resolve) => {
          if (img.complete && img.naturalWidth > 0) return resolve();
          img.addEventListener("load", resolve, { once: true });
          img.addEventListener("error", resolve, { once: true });
        }),
    ),
  );
}
