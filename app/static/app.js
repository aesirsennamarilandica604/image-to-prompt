const DEFAULT_BACKGROUND = "Background and setting inferred from the uploaded image.";

const STYLE_PRESETS = {
  none: {
    kind: "none",
    fields: {},
  },
  photograph: {
    kind: "photo",
    fields: {
      aesthetics: "natural, realistic, balanced",
      lighting: "ambient lighting inferred from the source image",
      photo: "source-image composition, camera angle, and depth cues preserved",
      medium: "photograph",
    },
  },
  illustration: {
    kind: "art",
    fields: {
      aesthetics: "clean, illustrative, balanced",
      lighting: "even image lighting inferred from the source image",
      medium: "illustration",
      artStyle: "source-image illustration style preserved",
    },
  },
  render3d: {
    kind: "art",
    fields: {
      aesthetics: "dimensional, polished, balanced",
      lighting: "soft studio lighting inferred from the source image",
      medium: "3d_render",
      artStyle: "source-image 3D render style preserved",
    },
  },
  graphic_design: {
    kind: "art",
    fields: {
      aesthetics: "minimal, structured, professional",
      lighting: "even, diffuse design lighting",
      medium: "graphic_design",
      artStyle: "clean graphic design with source-image layout preserved",
    },
  },
  painting: {
    kind: "art",
    fields: {
      aesthetics: "painterly, composed, balanced",
      lighting: "source-image lighting preserved",
      medium: "painting",
      artStyle: "source-image painting style preserved",
    },
  },
  custom_photo: {
    kind: "photo",
    fields: {
      aesthetics: "",
      lighting: "",
      photo: "",
      medium: "photograph",
    },
  },
  custom_art: {
    kind: "art",
    fields: {
      aesthetics: "",
      lighting: "",
      medium: "illustration",
      artStyle: "",
    },
  },
};

const state = {
  file: null,
  imageUrl: "",
  original: null,
  elements: [],
  selectedId: null,
  palette: [],
  caption: "",
  highLevelDescription: "",
  stylePreset: "none",
  styleKind: "none",
  styleFields: {
    aesthetics: "",
    lighting: "",
    photo: "",
    medium: "",
    artStyle: "",
    palette: [],
  },
  background: "",
  drag: null,
};

const els = {
  dropzone: document.getElementById("dropzone"),
  fileInput: document.getElementById("fileInput"),
  pickFileBtn: document.getElementById("pickFileBtn"),
  addBoxBtn: document.getElementById("addBoxBtn"),
  autoDetectBtn: document.getElementById("autoDetectBtn"),
  resetBtn: document.getElementById("resetBtn"),
  emptyState: document.getElementById("emptyState"),
  loadingState: document.getElementById("loadingState"),
  imageWrap: document.getElementById("imageWrap"),
  previewImage: document.getElementById("previewImage"),
  overlay: document.getElementById("overlay"),
  itemsPanel: document.querySelector(".items-panel"),
  emptyItems: document.getElementById("emptyItems"),
  itemsList: document.getElementById("itemsList"),
  highLevelInput: document.getElementById("highLevelInput"),
  stylePresetInput: document.getElementById("stylePresetInput"),
  styleFields: document.getElementById("styleFields"),
  styleAestheticsInput: document.getElementById("styleAestheticsInput"),
  styleLightingInput: document.getElementById("styleLightingInput"),
  stylePhotoField: document.getElementById("stylePhotoField"),
  stylePhotoInput: document.getElementById("stylePhotoInput"),
  styleArtField: document.getElementById("styleArtField"),
  styleArtStyleInput: document.getElementById("styleArtStyleInput"),
  styleMediumInput: document.getElementById("styleMediumInput"),
  stylePaletteInput: document.getElementById("stylePaletteInput"),
  backgroundInput: document.getElementById("backgroundInput"),
  jsonPreview: document.getElementById("jsonPreview"),
  jsonStatus: document.getElementById("jsonStatus"),
  copyBtn: document.getElementById("copyBtn"),
  exportBtn: document.getElementById("exportBtn"),
};

function uid() {
  return `item-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function titleCase(text) {
  return String(text || "object")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function cleanText(value, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeHexColor(value) {
  const color = String(value || "").trim().toUpperCase();
  return /^#[0-9A-F]{6}$/.test(color) ? color : null;
}

function normalizePalette(value, maxColors = 16) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const palette = [];
  for (const entry of value) {
    const color = normalizeHexColor(entry);
    if (color && !seen.has(color)) {
      seen.add(color);
      palette.push(color);
    }
    if (palette.length >= maxColors) break;
  }
  return palette;
}

function parsePaletteText(text) {
  const matches = String(text || "").match(/#[0-9a-fA-F]{6}/g) || [];
  return normalizePalette(matches);
}

function paletteToText(palette) {
  return normalizePalette(palette).join(", ");
}

function resetStyleFields() {
  state.stylePreset = "none";
  state.styleKind = "none";
  state.styleFields = {
    aesthetics: "",
    lighting: "",
    photo: "",
    medium: "",
    artStyle: "",
    palette: [],
  };
}

function applyStylePreset(name) {
  const preset = STYLE_PRESETS[name] || STYLE_PRESETS.none;
  state.stylePreset = name in STYLE_PRESETS ? name : "none";
  state.styleKind = preset.kind;
  if (preset.kind === "none") {
    state.styleFields = { ...state.styleFields, palette: [] };
    return;
  }
  const fields = preset.fields;
  state.styleFields = {
    aesthetics: fields.aesthetics ?? state.styleFields.aesthetics,
    lighting: fields.lighting ?? state.styleFields.lighting,
    photo: fields.photo ?? state.styleFields.photo,
    medium: fields.medium ?? state.styleFields.medium,
    artStyle: fields.artStyle ?? state.styleFields.artStyle,
    palette: state.styleFields.palette.length ? state.styleFields.palette : normalizePalette(state.palette),
  };
}

function syncStyleFromJson(style) {
  if (!isPlainObject(style)) {
    resetStyleFields();
    return;
  }
  const hasPhoto = Object.prototype.hasOwnProperty.call(style, "photo");
  const hasArtStyle = Object.prototype.hasOwnProperty.call(style, "art_style");
  if (hasPhoto === hasArtStyle) {
    resetStyleFields();
    return;
  }
  state.stylePreset = hasPhoto ? "custom_photo" : "custom_art";
  state.styleKind = hasPhoto ? "photo" : "art";
  state.styleFields = {
    aesthetics: cleanText(style.aesthetics),
    lighting: cleanText(style.lighting),
    photo: cleanText(style.photo),
    medium: cleanText(style.medium),
    artStyle: cleanText(style.art_style),
    palette: normalizePalette(style.color_palette),
  };
}

function buildStyleDescription() {
  if (state.styleKind === "none") return null;
  const fields = state.styleFields;
  if (state.styleKind === "photo") {
    const style = {
      aesthetics: fields.aesthetics,
      lighting: fields.lighting,
      photo: fields.photo,
      medium: fields.medium,
    };
    if (fields.palette.length) {
      style.color_palette = normalizePalette(fields.palette);
    }
    return style;
  }
  const style = {
    aesthetics: fields.aesthetics,
    lighting: fields.lighting,
    medium: fields.medium,
    art_style: fields.artStyle,
  };
  if (fields.palette.length) {
    style.color_palette = normalizePalette(fields.palette);
  }
  return style;
}

function elementToJson(item) {
  const itemType = item.type === "text" ? "text" : "obj";
  const bbox = parseBbox(item.bbox);
  const desc = item.description || item.label || "object";
  if (itemType === "text") {
    return {
      type: "text",
      bbox,
      text: item.text || item.label || "",
      desc,
    };
  }
  return {
    type: "obj",
    bbox,
    desc,
  };
}

function defaultJson() {
  const prompt = {
    high_level_description: state.highLevelDescription || state.caption || "Uploaded image scene.",
  };
  const style = buildStyleDescription();
  if (style) {
    prompt.style_description = style;
  }
  prompt.compositional_deconstruction = {
    background: state.background || DEFAULT_BACKGROUND,
    elements: state.elements.filter((item) => !item.hidden).map(elementToJson),
  };
  return prompt;
}

function setJsonStatus(message, isInvalid = false) {
  els.jsonStatus.textContent = message;
  els.jsonStatus.classList.toggle("invalid", isInvalid);
}

function formatOrder(keys) {
  return `(${keys.map((key) => `'${key}'`).join(", ")})`;
}

function checkUnknownKeys(obj, known, path, issues) {
  const unknown = Object.keys(obj).filter((key) => !known.includes(key));
  if (unknown.length) {
    issues.push(`${path}: unknown keys ${formatOrder(unknown)}`);
  }
}

function checkKeyOrder(obj, expected, path, issues) {
  const present = Object.keys(obj).filter((key) => expected.includes(key));
  if (present.join("|") !== expected.join("|")) {
    issues.push(`${path}: key order is ${formatOrder(present)}, expected ${formatOrder(expected)}`);
  }
  const extra = Object.keys(obj).filter((key) => !expected.includes(key));
  if (extra.length) {
    issues.push(`${path}: keys ${formatOrder(extra)} are not allowed here`);
  }
}

function validatePalette(palette, path, maxColors, issues) {
  if (!Array.isArray(palette)) {
    issues.push(`${path}: expected a list`);
    return;
  }
  if (palette.length > maxColors) {
    issues.push(`${path}: too many colors`);
    return;
  }
  palette.forEach((color, index) => {
    if (!normalizeHexColor(color) || normalizeHexColor(color) !== color) {
      issues.push(`${path}[${index}]: expected uppercase #RRGGBB`);
    }
  });
}

function validateBbox(bbox, path, issues) {
  if (!Array.isArray(bbox) || bbox.length !== 4) {
    issues.push(`${path}: expected [ymin, xmin, ymax, xmax]`);
    return;
  }
  if (!bbox.every((value) => Number.isInteger(value))) {
    issues.push(`${path}: all values must be int`);
    return;
  }
  const [y1, x1, y2, x2] = bbox;
  if (!bbox.every((value) => value >= 0 && value <= 1000)) {
    issues.push(`${path}: values must be in [0, 1000]`);
  }
  if (y1 > y2) issues.push(`${path}: ymin greater than ymax`);
  if (x1 > x2) issues.push(`${path}: xmin greater than xmax`);
}

function validateIdeogramJson(data) {
  const issues = [];
  if (!isPlainObject(data)) {
    return ["root: expected a JSON object"];
  }
  checkUnknownKeys(data, ["high_level_description", "style_description", "compositional_deconstruction"], "root", issues);
  if ("high_level_description" in data && typeof data.high_level_description !== "string") {
    issues.push("high_level_description: expected a string");
  }
  if ("style_description" in data) {
    const style = data.style_description;
    if (!isPlainObject(style)) {
      issues.push("style_description: expected a dict");
    } else {
      checkUnknownKeys(style, ["aesthetics", "lighting", "photo", "art_style", "medium", "color_palette"], "style_description", issues);
      const hasPhoto = Object.prototype.hasOwnProperty.call(style, "photo");
      const hasArtStyle = Object.prototype.hasOwnProperty.call(style, "art_style");
      if (hasPhoto === hasArtStyle) {
        issues.push("style_description: expected exactly one of photo or art_style");
      } else {
        const expected = hasPhoto
          ? ["aesthetics", "lighting", "photo", "medium"]
          : ["aesthetics", "lighting", "medium", "art_style"];
        if ("color_palette" in style) expected.push("color_palette");
        checkKeyOrder(style, expected, "style_description", issues);
      }
      if ("color_palette" in style) {
        validatePalette(style.color_palette, "style_description.color_palette", 16, issues);
      }
    }
  }
  const composition = data.compositional_deconstruction;
  if (!isPlainObject(composition)) {
    issues.push("compositional_deconstruction: expected a dict");
    return issues;
  }
  checkKeyOrder(composition, ["background", "elements"], "compositional_deconstruction", issues);
  if (typeof composition.background !== "string") {
    issues.push("compositional_deconstruction.background: expected a string");
  }
  if (!Array.isArray(composition.elements)) {
    issues.push("compositional_deconstruction.elements: expected a list");
    return issues;
  }
  composition.elements.forEach((element, index) => {
    const path = `elements[${index}]`;
    if (!isPlainObject(element)) {
      issues.push(`${path}: expected a dict`);
      return;
    }
    checkUnknownKeys(element, ["type", "bbox", "text", "desc", "color_palette"], path, issues);
    if (!["obj", "text"].includes(element.type)) {
      issues.push(`${path}: type must be obj or text`);
      return;
    }
    const expected = ["type"];
    if ("bbox" in element) expected.push("bbox");
    if (element.type === "text") expected.push("text");
    expected.push("desc");
    if ("color_palette" in element) expected.push("color_palette");
    checkKeyOrder(element, expected, path, issues);
    if ("bbox" in element) validateBbox(element.bbox, `${path}.bbox`, issues);
    if (element.type === "text" && typeof element.text !== "string") {
      issues.push(`${path}.text: expected a string`);
    }
    if (typeof element.desc !== "string") {
      issues.push(`${path}.desc: expected a string`);
    }
    if ("color_palette" in element) {
      validatePalette(element.color_palette, `${path}.color_palette`, 5, issues);
    }
  });
  return issues;
}

function updateJsonStatusFor(data) {
  const issues = validateIdeogramJson(data);
  if (issues.length) {
    setJsonStatus(`${issues.length} schema issue${issues.length === 1 ? "" : "s"}`, true);
  } else {
    setJsonStatus("Valid Ideogram JSON");
  }
}

function updateJson() {
  const data = defaultJson();
  els.jsonPreview.value = JSON.stringify(data, null, 2);
  updateJsonStatusFor(data);
}

function syncControlValue(control, value) {
  if (document.activeElement !== control && control.value !== value) {
    control.value = value;
  }
}

function syncPromptInputs() {
  syncControlValue(els.highLevelInput, state.highLevelDescription || state.caption || "");
  syncControlValue(els.backgroundInput, state.background || "");
  syncControlValue(els.stylePresetInput, state.stylePreset);
  els.styleFields.hidden = state.styleKind === "none";
  els.stylePhotoField.hidden = state.styleKind !== "photo";
  els.styleArtField.hidden = state.styleKind !== "art";
  syncControlValue(els.styleAestheticsInput, state.styleFields.aesthetics);
  syncControlValue(els.styleLightingInput, state.styleFields.lighting);
  syncControlValue(els.stylePhotoInput, state.styleFields.photo);
  syncControlValue(els.styleArtStyleInput, state.styleFields.artStyle);
  syncControlValue(els.styleMediumInput, state.styleFields.medium);
  syncControlValue(els.stylePaletteInput, paletteToText(state.styleFields.palette));
}

function setLoading(isLoading) {
  els.loadingState.hidden = !isLoading;
  if (isLoading) {
    els.emptyState.hidden = true;
  } else {
    els.emptyState.hidden = Boolean(state.imageUrl);
  }
}

function syncSelectedRows() {
  for (const row of els.itemsList.querySelectorAll(".item-row")) {
    row.classList.toggle("selected", row.dataset.id === state.selectedId);
  }
}

function revealItemRow(id, shouldFocus = false) {
  const row = els.itemsList.querySelector(`[data-id="${id}"]`);
  if (!row) return;
  const scrollContainer = els.itemsPanel || els.itemsList;
  const rowRect = row.getBoundingClientRect();
  const containerRect = scrollContainer.getBoundingClientRect();
  const target =
    scrollContainer.scrollTop +
    rowRect.top -
    containerRect.top -
    (scrollContainer.clientHeight - rowRect.height) / 2;
  const maxScroll = Math.max(0, scrollContainer.scrollHeight - scrollContainer.clientHeight);
  scrollContainer.scrollTop = clamp(target, 0, maxScroll);
  if (shouldFocus) {
    setTimeout(() => {
      const currentRow = els.itemsList.querySelector(`[data-id="${id}"]`);
      const input = currentRow?.querySelector(".label-input");
      input?.focus({ preventScroll: true });
      input?.select();
    }, 40);
  }
}

function selectItem(id, { scroll = false, focus = false } = {}) {
  if (state.selectedId === id) {
    if (scroll || focus) {
      requestAnimationFrame(() => revealItemRow(id, focus));
    }
    return;
  }
  state.selectedId = id;
  renderBoxes();
  syncSelectedRows();
  if (scroll || focus) {
    requestAnimationFrame(() => revealItemRow(id, focus));
  }
}

function readBoxStyle(bbox) {
  const [y1, x1, y2, x2] = bbox;
  return {
    top: `${y1 / 10}%`,
    left: `${x1 / 10}%`,
    width: `${(x2 - x1) / 10}%`,
    height: `${(y2 - y1) / 10}%`,
  };
}

function renderBoxes() {
  els.overlay.innerHTML = "";
  for (const item of state.elements) {
    const box = document.createElement("div");
    box.className = `box${item.id === state.selectedId ? " selected" : ""}${item.hidden ? " hidden" : ""}`;
    box.dataset.id = item.id;
    Object.assign(box.style, readBoxStyle(item.bbox));
    box.innerHTML = `<span class="box-label">${titleCase(item.label)}</span>`;
    for (const corner of ["nw", "ne", "sw", "se"]) {
      const handle = document.createElement("span");
      handle.className = `handle ${corner}`;
      handle.dataset.handle = corner;
      box.appendChild(handle);
    }
    box.addEventListener("pointerdown", startDrag);
    box.addEventListener("mousedown", startDrag);
    box.addEventListener("click", () => selectItem(item.id, { scroll: true, focus: true }));
    els.overlay.appendChild(box);
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function makeItemRow(item) {
  const row = document.createElement("div");
  row.className = `item-row${item.id === state.selectedId ? " selected" : ""}`;
  row.dataset.id = item.id;
  row.innerHTML = `
    <span class="swatch" style="background:${item.color || "#d0d0d0"}"></span>
    <div class="item-fields">
      <input class="label-input" value="${escapeHtml(item.label || "")}" aria-label="Item label" />
      <div class="item-meta">
        <select class="type-input" aria-label="Item type">
          <option value="obj"${item.type === "obj" ? " selected" : ""}>obj</option>
          <option value="text"${item.type === "text" ? " selected" : ""}>text</option>
        </select>
      </div>
      <label class="text-value-wrap"${item.type === "text" ? "" : " hidden"}>
        <span>Literal text</span>
        <input class="text-value-input" value="${escapeHtml(item.text || item.label || "")}" aria-label="Literal text" />
      </label>
      <textarea class="desc-input" aria-label="Item description">${escapeHtml(item.description || "")}</textarea>
    </div>
    <div class="item-actions">
      <button class="mini hide-btn" type="button" title="Hide">${item.hidden ? "Show" : "Hide"}</button>
      <button class="mini dup-btn" type="button" title="Duplicate">Dup</button>
      <button class="mini del-btn" type="button" title="Delete">Del</button>
    </div>
  `;
  row.addEventListener("click", (event) => {
    if (event.target.closest("input, textarea, select, button")) {
      return;
    }
    selectItem(item.id);
  });
  for (const control of row.querySelectorAll("input, textarea, select")) {
    control.addEventListener("pointerdown", (event) => event.stopPropagation());
    control.addEventListener("mousedown", (event) => event.stopPropagation());
    control.addEventListener("click", (event) => event.stopPropagation());
    control.addEventListener("focus", () => selectItem(item.id));
  }
  const labelInput = row.querySelector(".label-input");
  const typeInput = row.querySelector(".type-input");
  const textWrap = row.querySelector(".text-value-wrap");
  const textInput = row.querySelector(".text-value-input");
  const descInput = row.querySelector(".desc-input");

  labelInput.addEventListener("input", (event) => {
    const value = event.target.value;
    item.label = value;
    if (item.type === "text") {
      item.text = value;
      textInput.value = event.target.value;
      item.description = `text "${value}"`;
    } else {
      item.description = value;
    }
    descInput.value = item.description;
    item._lastLabel = value;
    updateJson();
    renderBoxes();
  });
  typeInput.addEventListener("change", (event) => {
    item.type = event.target.value === "text" ? "text" : "obj";
    if (item.type === "text") {
      item.text = item.text || item.label || item.description || "text";
      if (!item.description || item.description === item._lastLabel) {
        item.description = item.text;
        descInput.value = item.description;
      }
      textInput.value = item.text;
      textWrap.hidden = false;
    } else {
      textWrap.hidden = true;
    }
    updateJson();
  });
  textInput.addEventListener("input", (event) => {
    item.text = event.target.value;
    if (!item.label || item.label === item._lastLabel) {
      item.label = event.target.value;
      labelInput.value = event.target.value;
      item._lastLabel = event.target.value;
      renderBoxes();
    }
    updateJson();
  });
  descInput.addEventListener("input", (event) => {
    item.description = event.target.value;
    updateJson();
  });
  row.querySelector(".hide-btn").addEventListener("click", (event) => {
    event.stopPropagation();
    item.hidden = !item.hidden;
    render();
  });
  row.querySelector(".dup-btn").addEventListener("click", (event) => {
    event.stopPropagation();
    const copy = JSON.parse(JSON.stringify(item));
    copy.id = uid();
    copy.label = `${item.label || "object"} copy`;
    copy.bbox = offsetBox(copy.bbox, 20);
    state.elements.push(copy);
    state.selectedId = copy.id;
    render();
    requestAnimationFrame(() => revealItemRow(copy.id, true));
  });
  row.querySelector(".del-btn").addEventListener("click", (event) => {
    event.stopPropagation();
    state.elements = state.elements.filter((entry) => entry.id !== item.id);
    state.selectedId = state.elements[0]?.id || null;
    render();
  });
  return row;
}

function renderItems() {
  els.itemsList.innerHTML = "";
  els.emptyItems.hidden = state.elements.length > 0;
  for (const item of state.elements) {
    els.itemsList.appendChild(makeItemRow(item));
  }
}

function render() {
  renderBoxes();
  renderItems();
  syncPromptInputs();
  updateJson();
}

function offsetBox(bbox, amount) {
  const [y1, x1, y2, x2] = bbox;
  return [
    clamp(y1 + amount, 0, 990),
    clamp(x1 + amount, 0, 990),
    clamp(y2 + amount, 10, 1000),
    clamp(x2 + amount, 10, 1000),
  ];
}

function mapResultElement(item, index) {
  const type = item.type === "text" ? "text" : "obj";
  const label = item.label || item.text || `object ${index + 1}`;
  return {
    id: item.id || uid(),
    type,
    label,
    text: type === "text" ? item.text || label : item.text || "",
    description: item.description || item.text || item.label || `object ${index + 1}`,
    bbox: parseBbox(item.bbox || [250, 250, 750, 750]),
    color: item.color || "#D0D0D0",
    hidden: false,
    _lastLabel: label,
  };
}

async function analyzeFile(file) {
  state.file = file;
  state.imageUrl = URL.createObjectURL(file);
  els.previewImage.src = state.imageUrl;
  els.imageWrap.hidden = false;
  els.emptyState.hidden = true;
  setLoading(true);
  const form = new FormData();
  form.append("file", file);
  const response = await fetch("/api/analyze", { method: "POST", body: form });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || "Analysis failed.");
  }
  const result = await response.json();
  state.original = result;
  state.elements = (result.elements || []).map(mapResultElement);
  state.selectedId = state.elements[0]?.id || null;
  state.caption = result.caption || "";
  state.highLevelDescription = result.json?.high_level_description || result.caption || "";
  syncStyleFromJson(result.json?.style_description);
  state.background = result.json?.compositional_deconstruction?.background || result.background || "";
  state.palette = normalizePalette(result.palette || []);
  setLoading(false);
  render();
}

async function handleFile(file) {
  if (!file || !file.type.startsWith("image/")) {
    return;
  }
  try {
    await analyzeFile(file);
  } catch (error) {
    setLoading(false);
    window.alert(error.message || "Could not analyze the image.");
  }
}

function addBox() {
  const item = {
    id: uid(),
    type: "obj",
    label: "object",
    text: "",
    description: "object",
    bbox: [300, 300, 700, 700],
    color: "#BDBAB2",
    hidden: false,
    _lastLabel: "object",
  };
  state.elements.push(item);
  state.selectedId = item.id;
  render();
}

function resetToOriginal() {
  if (!state.original) {
    state.elements = [];
    state.selectedId = null;
    resetStyleFields();
    render();
    return;
  }
  state.elements = (state.original.elements || []).map(mapResultElement);
  state.selectedId = state.elements[0]?.id || null;
  state.caption = state.original.caption || "";
  state.highLevelDescription = state.original.json?.high_level_description || state.original.caption || "";
  syncStyleFromJson(state.original.json?.style_description);
  state.background = state.original.json?.compositional_deconstruction?.background || state.original.background || "";
  state.palette = normalizePalette(state.original.palette || []);
  render();
}

function normalizedPointer(event) {
  const rect = els.overlay.getBoundingClientRect();
  return {
    x: clamp(((event.clientX - rect.left) / rect.width) * 1000, 0, 1000),
    y: clamp(((event.clientY - rect.top) / rect.height) * 1000, 0, 1000),
  };
}

function startDrag(event) {
  const box = event.currentTarget;
  const id = box.dataset.id;
  const item = state.elements.find((entry) => entry.id === id);
  if (!item) return;
  selectItem(id, { scroll: true, focus: true });
  event.preventDefault();
  if (typeof event.pointerId === "number" && box.setPointerCapture) {
    box.setPointerCapture(event.pointerId);
  }
  state.drag = {
    id,
    handle: event.target.dataset.handle || "move",
    start: normalizedPointer(event),
    bbox: [...item.bbox],
  };
}

function updateDrag(event) {
  if (!state.drag) return;
  const item = state.elements.find((entry) => entry.id === state.drag.id);
  if (!item) return;
  const point = normalizedPointer(event);
  const dx = point.x - state.drag.start.x;
  const dy = point.y - state.drag.start.y;
  let [y1, x1, y2, x2] = state.drag.bbox;
  const handle = state.drag.handle;
  if (handle === "move") {
    const width = x2 - x1;
    const height = y2 - y1;
    x1 = clamp(x1 + dx, 0, 1000 - width);
    y1 = clamp(y1 + dy, 0, 1000 - height);
    x2 = x1 + width;
    y2 = y1 + height;
  } else {
    if (handle.includes("n")) y1 = clamp(y1 + dy, 0, y2 - 10);
    if (handle.includes("s")) y2 = clamp(y2 + dy, y1 + 10, 1000);
    if (handle.includes("w")) x1 = clamp(x1 + dx, 0, x2 - 10);
    if (handle.includes("e")) x2 = clamp(x2 + dx, x1 + 10, 1000);
  }
  item.bbox = [Math.round(y1), Math.round(x1), Math.round(y2), Math.round(x2)];
  renderBoxes();
  updateJson();
}

function stopDrag() {
  state.drag = null;
}

async function copyJson() {
  const text = els.jsonPreview.value;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.top = "-1000px";
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    if (!copied) {
      throw new Error("Clipboard access was blocked.");
    }
  }
  els.copyBtn.textContent = "Copied";
  setTimeout(() => {
    els.copyBtn.textContent = "Copy";
  }, 900);
}

function exportJson() {
  const blob = new Blob([els.jsonPreview.value], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "ideogram-prompt.json";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function parseBbox(value, fallback = [300, 300, 700, 700]) {
  if (!Array.isArray(value) || value.length < 4) {
    return fallback;
  }
  const numbers = value.slice(0, 4).map((entry) => Number(entry));
  if (numbers.some((entry) => !Number.isFinite(entry))) {
    return fallback;
  }
  let [y1, x1, y2, x2] = numbers.map((entry) => Math.round(clamp(entry, 0, 1000)));
  if (y2 < y1) [y1, y2] = [y2, y1];
  if (x2 < x1) [x1, x2] = [x2, x1];
  if (y2 - y1 < 10) y2 = clamp(y1 + 10, 10, 1000);
  if (x2 - x1 < 10) x2 = clamp(x1 + 10, 10, 1000);
  return [y1, x1, y2, x2];
}

function syncFromJsonObject(data) {
  const previous = state.elements;
  const composition = data?.compositional_deconstruction || {};
  const jsonElements = Array.isArray(composition.elements) ? composition.elements : [];
  state.highLevelDescription = cleanText(data.high_level_description, state.highLevelDescription || state.caption);
  state.caption = state.highLevelDescription;
  syncStyleFromJson(data.style_description);
  state.background = cleanText(composition.background, state.background || DEFAULT_BACKGROUND);
  const stylePalette = normalizePalette(data.style_description?.color_palette || []);
  if (stylePalette.length) {
    state.palette = stylePalette;
  }
  state.elements = jsonElements.map((entry, index) => {
    const existing = previous[index] || {};
    const type = entry.type === "text" ? "text" : "obj";
    const desc = cleanText(entry.desc, existing.description || existing.label || `object ${index + 1}`);
    const text = type === "text" ? cleanText(entry.text, existing.text || existing.label || desc) : cleanText(entry.text, existing.text || "");
    const label = type === "text" ? text || desc : desc || `object ${index + 1}`;
    return {
      id: existing.id || uid(),
      type,
      label,
      text,
      description: desc || label,
      bbox: parseBbox(entry.bbox, existing.bbox || [300, 300, 700, 700]),
      color: existing.color || "#BDBAB2",
      hidden: false,
      _lastLabel: label,
    };
  });
  if (!state.elements.some((entry) => entry.id === state.selectedId)) {
    state.selectedId = state.elements[0]?.id || null;
  }
}

function applyJsonDraft() {
  try {
    const data = JSON.parse(els.jsonPreview.value);
    syncFromJsonObject(data);
    renderBoxes();
    renderItems();
    syncPromptInputs();
    updateJsonStatusFor(data);
  } catch (error) {
    setJsonStatus(error instanceof SyntaxError ? "Invalid JSON" : "Unsupported JSON", true);
  }
}

function updatePromptField(field) {
  if (field === "highLevel") {
    state.highLevelDescription = els.highLevelInput.value;
    state.caption = state.highLevelDescription;
  } else if (field === "background") {
    state.background = els.backgroundInput.value;
  }
  updateJson();
}

function updateStyleField(field) {
  if (field === "aesthetics") state.styleFields.aesthetics = els.styleAestheticsInput.value;
  if (field === "lighting") state.styleFields.lighting = els.styleLightingInput.value;
  if (field === "photo") state.styleFields.photo = els.stylePhotoInput.value;
  if (field === "artStyle") state.styleFields.artStyle = els.styleArtStyleInput.value;
  if (field === "medium") state.styleFields.medium = els.styleMediumInput.value;
  if (field === "palette") state.styleFields.palette = parsePaletteText(els.stylePaletteInput.value);
  updateJson();
}

els.pickFileBtn.addEventListener("click", () => els.fileInput.click());
els.fileInput.addEventListener("change", () => handleFile(els.fileInput.files[0]));
els.addBoxBtn.addEventListener("click", addBox);
els.autoDetectBtn.addEventListener("click", () => state.file && handleFile(state.file));
els.resetBtn.addEventListener("click", resetToOriginal);
els.copyBtn.addEventListener("click", () => copyJson().catch(() => window.alert("Clipboard access was blocked.")));
els.exportBtn.addEventListener("click", exportJson);
els.highLevelInput.addEventListener("input", () => updatePromptField("highLevel"));
els.backgroundInput.addEventListener("input", () => updatePromptField("background"));
els.stylePresetInput.addEventListener("change", () => {
  applyStylePreset(els.stylePresetInput.value);
  syncPromptInputs();
  updateJson();
});
els.styleAestheticsInput.addEventListener("input", () => updateStyleField("aesthetics"));
els.styleLightingInput.addEventListener("input", () => updateStyleField("lighting"));
els.stylePhotoInput.addEventListener("input", () => updateStyleField("photo"));
els.styleArtStyleInput.addEventListener("input", () => updateStyleField("artStyle"));
els.styleMediumInput.addEventListener("input", () => updateStyleField("medium"));
els.stylePaletteInput.addEventListener("input", () => updateStyleField("palette"));
els.jsonPreview.addEventListener("input", applyJsonDraft);
window.addEventListener("pointermove", updateDrag);
window.addEventListener("pointerup", stopDrag);
window.addEventListener("mousemove", updateDrag);
window.addEventListener("mouseup", stopDrag);

for (const eventName of ["dragenter", "dragover"]) {
  els.dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    els.dropzone.classList.add("drag-over");
  });
}

for (const eventName of ["dragleave", "drop"]) {
  els.dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    els.dropzone.classList.remove("drag-over");
  });
}

els.dropzone.addEventListener("drop", (event) => {
  const file = event.dataTransfer.files[0];
  handleFile(file);
});

updateJson();
