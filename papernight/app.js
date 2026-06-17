const DEFAULT_SETTINGS = {
  background: "#101615",
  text: "#f3efe3",
  contrast: 108,
  preserveImages: true,
  quality: "balanced",
  zoom: 100,
  previewMode: "split",
};

const QUALITY_SETTINGS = {
  compact: { scale: 1.2, format: "jpg", quality: 0.86 },
  balanced: { scale: 1.55, format: "jpg", quality: 0.92 },
  crisp: { scale: 2, format: "png", quality: 1 },
};

const state = {
  pdf: null,
  pageIndex: 1,
  pageCount: 0,
  fileName: "",
  fileBytes: null,
  renderToken: 0,
  renderedPreview: null,
  convertedUrl: "",
  settings: { ...DEFAULT_SETTINGS },
};

const dom = {};

window.addEventListener("DOMContentLoaded", () => {
  cacheDom();
  const engineReady = configureLibraries();
  bindEvents();
  syncControls();
  refreshIcons();
  setStatus(engineReady ? "Ready" : "PDF engine failed to load.", 0);
});

function cacheDom() {
  const ids = [
    "fileMeta",
    "openButton",
    "convertButton",
    "downloadLink",
    "dropZone",
    "fileInput",
    "backgroundColor",
    "textColor",
    "contrastRange",
    "contrastValue",
    "preserveImages",
    "qualitySelect",
    "resetPalette",
    "progressBar",
    "statusLine",
    "prevPage",
    "nextPage",
    "pageIndicator",
    "zoomRange",
    "zoomValue",
    "previewFrame",
    "emptyState",
    "originalCanvas",
    "darkCanvas",
  ];

  ids.forEach((id) => {
    dom[id] = document.getElementById(id);
  });

  dom.previewModeButtons = Array.from(document.querySelectorAll("[data-preview-mode]"));
}

function configureLibraries() {
  const engineReady = librariesReady();
  document.documentElement.dataset.pdfEngine = engineReady ? "ready" : "missing";

  if (window.pdfjsLib) {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc =
      new URL("./vendor/pdf.worker.min.js", window.location.href).toString();
  }

  return engineReady;
}

function librariesReady() {
  return Boolean(window.pdfjsLib && window.PDFLib);
}

function bindEvents() {
  dom.openButton.addEventListener("click", () => dom.fileInput.click());
  dom.fileInput.addEventListener("change", (event) => {
    const [file] = event.target.files || [];
    if (file) {
      loadPdfFile(file);
    }
  });

  ["dragenter", "dragover"].forEach((eventName) => {
    dom.dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      dom.dropZone.classList.add("drag-over");
    });
  });

  ["dragleave", "drop"].forEach((eventName) => {
    dom.dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      dom.dropZone.classList.remove("drag-over");
    });
  });

  dom.dropZone.addEventListener("drop", (event) => {
    const [file] = event.dataTransfer.files || [];
    if (file) {
      loadPdfFile(file);
    }
  });

  dom.backgroundColor.addEventListener("input", (event) => {
    state.settings.background = event.target.value;
    invalidateDownload();
    renderDarkPreviewOnly();
  });

  dom.textColor.addEventListener("input", (event) => {
    state.settings.text = event.target.value;
    invalidateDownload();
    renderDarkPreviewOnly();
  });

  dom.contrastRange.addEventListener("input", (event) => {
    state.settings.contrast = Number(event.target.value);
    dom.contrastValue.value = `${state.settings.contrast}%`;
    invalidateDownload();
    renderDarkPreviewOnly();
  });

  dom.preserveImages.addEventListener("change", (event) => {
    state.settings.preserveImages = event.target.checked;
    invalidateDownload();
    renderDarkPreviewOnly();
  });

  dom.qualitySelect.addEventListener("change", (event) => {
    state.settings.quality = event.target.value;
    invalidateDownload();
  });

  dom.resetPalette.addEventListener("click", () => {
    state.settings.background = DEFAULT_SETTINGS.background;
    state.settings.text = DEFAULT_SETTINGS.text;
    state.settings.contrast = DEFAULT_SETTINGS.contrast;
    syncControls();
    invalidateDownload();
    renderDarkPreviewOnly();
  });

  dom.convertButton.addEventListener("click", convertPdf);

  dom.prevPage.addEventListener("click", () => {
    if (state.pageIndex > 1) {
      state.pageIndex -= 1;
      renderPreview();
    }
  });

  dom.nextPage.addEventListener("click", () => {
    if (state.pageIndex < state.pageCount) {
      state.pageIndex += 1;
      renderPreview();
    }
  });

  dom.zoomRange.addEventListener("input", (event) => {
    state.settings.zoom = Number(event.target.value);
    dom.zoomValue.textContent = `${state.settings.zoom}%`;
    renderPreview();
  });

  dom.previewModeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      state.settings.previewMode = button.dataset.previewMode;
      dom.previewModeButtons.forEach((item) => {
        item.classList.toggle("active", item === button);
      });
      dom.previewFrame.dataset.mode = state.settings.previewMode;
    });
  });
}

function syncControls() {
  dom.backgroundColor.value = state.settings.background;
  dom.textColor.value = state.settings.text;
  dom.contrastRange.value = String(state.settings.contrast);
  dom.contrastValue.value = `${state.settings.contrast}%`;
  dom.preserveImages.checked = state.settings.preserveImages;
  dom.qualitySelect.value = state.settings.quality;
  dom.zoomRange.value = String(state.settings.zoom);
  dom.zoomValue.textContent = `${state.settings.zoom}%`;
  dom.previewFrame.dataset.mode = state.settings.previewMode;
}

async function loadPdfFile(file) {
  if (!isPdf(file)) {
    setStatus("Choose a PDF file.", 0);
    return;
  }

  if (!librariesReady()) {
    setStatus("PDF engine failed to load.", 0);
    return;
  }

  try {
    setStatus("Loading PDF...", 8);
    invalidateDownload();
    state.pdf = null;
    state.renderedPreview = null;
    state.fileName = file.name;

    const arrayBuffer = await file.arrayBuffer();
    state.fileBytes = arrayBuffer.slice(0);
    const loadingTask = window.pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) });
    state.pdf = await loadingTask.promise;
    state.pageCount = state.pdf.numPages;
    state.pageIndex = 1;

    dom.fileMeta.textContent = `${file.name} - ${state.pageCount} page${state.pageCount === 1 ? "" : "s"} - ${formatBytes(file.size)}`;
    dom.convertButton.disabled = false;
    dom.previewFrame.classList.add("has-file");
    updatePageControls();
    setStatus("Preview ready.", 0);
    await renderPreview();
  } catch (error) {
    console.error(error);
    state.pdf = null;
    state.fileBytes = null;
    dom.fileMeta.textContent = "No PDF loaded";
    dom.convertButton.disabled = true;
    dom.previewFrame.classList.remove("has-file");
    updatePageControls();
    setStatus("Could not read that PDF.", 0);
  } finally {
    dom.fileInput.value = "";
  }
}

function isPdf(file) {
  return file.type === "application/pdf" || /\.pdf$/i.test(file.name);
}

async function renderPreview() {
  if (!state.pdf) {
    return;
  }

  const token = ++state.renderToken;
  const pageNumber = state.pageIndex;
  const scale = 1.25 * (state.settings.zoom / 100);
  dom.previewFrame.classList.add("rendering");
  setStatus(`Rendering page ${pageNumber}...`, 0);

  try {
    const imageData = await renderPdfPageToCanvas(pageNumber, scale, dom.originalCanvas);
    if (token !== state.renderToken) {
      return;
    }
    state.renderedPreview = copyImageData(imageData);
    paintDarkCanvas(imageData, dom.darkCanvas);
    updatePageControls();
    setStatus("Preview ready.", 0);
  } catch (error) {
    console.error(error);
    setStatus("Preview render failed.", 0);
  } finally {
    if (token === state.renderToken) {
      dom.previewFrame.classList.remove("rendering");
    }
  }
}

function renderDarkPreviewOnly() {
  if (!state.renderedPreview || !state.pdf) {
    return;
  }
  paintDarkCanvas(copyImageData(state.renderedPreview), dom.darkCanvas);
}

async function renderPdfPageToCanvas(pageNumber, scale, canvas) {
  const page = await state.pdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale });
  const width = Math.ceil(viewport.width);
  const height = Math.ceil(viewport.height);
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.save();
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.restore();

  await page.render({
    canvasContext: context,
    viewport,
    background: "rgba(255,255,255,1)",
  }).promise;

  return context.getImageData(0, 0, width, height);
}

function paintDarkCanvas(sourceImageData, canvas) {
  canvas.width = sourceImageData.width;
  canvas.height = sourceImageData.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  const transformed = applyDarkMode(sourceImageData, state.settings);
  context.putImageData(transformed, 0, 0);
}

function applyDarkMode(imageData, settings) {
  const data = imageData.data;
  const background = hexToRgb(settings.background);
  const text = hexToRgb(settings.text);
  const contrast = settings.contrast / 100;
  const preserveImages = settings.preserveImages;

  for (let index = 0; index < data.length; index += 4) {
    const alpha = data[index + 3] / 255;
    const red = data[index];
    const green = data[index + 1];
    const blue = data[index + 2];
    const luminance = relativeLuminance(red, green, blue);
    const saturation = colorSaturation(red, green, blue);

    if (alpha < 0.04) {
      data[index] = background.r;
      data[index + 1] = background.g;
      data[index + 2] = background.b;
      data[index + 3] = 255;
      continue;
    }

    if (preserveImages && isLikelyColorContent(luminance, saturation)) {
      const preserved = toneMapColor(red, green, blue, luminance, background);
      data[index] = preserved.r;
      data[index + 1] = preserved.g;
      data[index + 2] = preserved.b;
      data[index + 3] = 255;
      continue;
    }

    let ink = 1 - luminance;
    ink = (ink - 0.5) * contrast + 0.5;
    ink = clamp(ink, 0, 1);
    ink = smoothStep(0.02, 0.98, ink);

    data[index] = Math.round(mix(background.r, text.r, ink));
    data[index + 1] = Math.round(mix(background.g, text.g, ink));
    data[index + 2] = Math.round(mix(background.b, text.b, ink));
    data[index + 3] = 255;
  }

  return imageData;
}

function isLikelyColorContent(luminance, saturation) {
  return saturation > 0.18 && luminance > 0.08 && luminance < 0.94;
}

function toneMapColor(red, green, blue, luminance, background) {
  const targetLuminance = luminance > 0.72 ? 0.58 : Math.max(0.18, luminance * 0.78 + 0.05);
  const factor = targetLuminance / Math.max(luminance, 0.01);
  const mapped = {
    r: clamp(Math.round(red * factor), 0, 255),
    g: clamp(Math.round(green * factor), 0, 255),
    b: clamp(Math.round(blue * factor), 0, 255),
  };

  return {
    r: Math.round(mix(background.r, mapped.r, 0.82)),
    g: Math.round(mix(background.g, mapped.g, 0.82)),
    b: Math.round(mix(background.b, mapped.b, 0.82)),
  };
}

async function convertPdf() {
  if (!state.pdf) {
    setStatus("Open a PDF first.", 0);
    return;
  }

  dom.convertButton.disabled = true;
  dom.downloadLink.classList.add("disabled");
  dom.downloadLink.setAttribute("aria-disabled", "true");

  try {
    const quality = QUALITY_SETTINGS[state.settings.quality] || QUALITY_SETTINGS.balanced;
    const outputPdf = await window.PDFLib.PDFDocument.create();

    for (let pageNumber = 1; pageNumber <= state.pageCount; pageNumber += 1) {
      setStatus(`Converting page ${pageNumber} of ${state.pageCount}...`, pageNumber / state.pageCount * 92);

      const page = await state.pdf.getPage(pageNumber);
      const baseViewport = page.getViewport({ scale: 1 });
      const renderCanvas = document.createElement("canvas");
      const renderedImage = await renderPageToImageData(page, quality.scale, renderCanvas);
      const darkImage = applyDarkMode(renderedImage, state.settings);
      const imageBytes = await canvasToImageBytes(renderCanvas, darkImage, quality);
      const embeddedImage =
        quality.format === "png"
          ? await outputPdf.embedPng(imageBytes)
          : await outputPdf.embedJpg(imageBytes);

      const pdfPage = outputPdf.addPage([baseViewport.width, baseViewport.height]);
      pdfPage.drawImage(embeddedImage, {
        x: 0,
        y: 0,
        width: baseViewport.width,
        height: baseViewport.height,
      });

      renderCanvas.width = 1;
      renderCanvas.height = 1;
    }

    setStatus("Building download...", 96);
    const pdfBytes = await outputPdf.save();
    const blob = new Blob([pdfBytes], { type: "application/pdf" });
    setDownloadBlob(blob);
    setStatus("Dark PDF ready.", 100);
  } catch (error) {
    console.error(error);
    setStatus("Conversion failed. Try Compact quality for very large PDFs.", 0);
  } finally {
    dom.convertButton.disabled = false;
  }
}

async function renderPageToImageData(page, scale, canvas) {
  const viewport = page.getViewport({ scale });
  const width = Math.ceil(viewport.width);
  const height = Math.ceil(viewport.height);
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);

  await page.render({
    canvasContext: context,
    viewport,
    background: "rgba(255,255,255,1)",
  }).promise;

  return context.getImageData(0, 0, width, height);
}

async function canvasToImageBytes(canvas, imageData, quality) {
  const context = canvas.getContext("2d");
  context.putImageData(imageData, 0, 0);
  const mimeType = quality.format === "png" ? "image/png" : "image/jpeg";
  const blob = await canvasToBlob(canvas, mimeType, quality.quality);
  return new Uint8Array(await blob.arrayBuffer());
}

function canvasToBlob(canvas, mimeType, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error("Could not encode canvas."));
        }
      },
      mimeType,
      quality,
    );
  });
}

function setDownloadBlob(blob) {
  if (state.convertedUrl) {
    URL.revokeObjectURL(state.convertedUrl);
  }

  state.convertedUrl = URL.createObjectURL(blob);
  dom.downloadLink.href = state.convertedUrl;
  dom.downloadLink.download = darkFileName(state.fileName);
  dom.downloadLink.classList.remove("disabled");
  dom.downloadLink.removeAttribute("aria-disabled");
}

function invalidateDownload() {
  if (!state.convertedUrl) {
    return;
  }

  URL.revokeObjectURL(state.convertedUrl);
  state.convertedUrl = "";
  dom.downloadLink.removeAttribute("href");
  dom.downloadLink.classList.add("disabled");
  dom.downloadLink.setAttribute("aria-disabled", "true");
  setStatus("Settings changed. Convert again.", 0);
}

function updatePageControls() {
  dom.pageIndicator.textContent = state.pageCount
    ? `Page ${state.pageIndex} / ${state.pageCount}`
    : "Page - / -";
  dom.prevPage.disabled = !state.pdf || state.pageIndex <= 1;
  dom.nextPage.disabled = !state.pdf || state.pageIndex >= state.pageCount;
}

function setStatus(message, progress) {
  dom.statusLine.textContent = message;
  dom.progressBar.style.width = `${clamp(progress, 0, 100)}%`;
}

function darkFileName(fileName) {
  const fallback = "paper-night";
  const cleanName = (fileName || fallback).replace(/\.pdf$/i, "");
  return `${cleanName}-dark.pdf`;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB"];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;
  return `${value.toFixed(value >= 10 || exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

function copyImageData(imageData) {
  return new ImageData(new Uint8ClampedArray(imageData.data), imageData.width, imageData.height);
}

function hexToRgb(hex) {
  const normalized = hex.replace("#", "");
  const value = Number.parseInt(normalized, 16);
  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255,
  };
}

function relativeLuminance(red, green, blue) {
  return (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;
}

function colorSaturation(red, green, blue) {
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  return max === 0 ? 0 : (max - min) / max;
}

function smoothStep(edge0, edge1, value) {
  const x = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return x * x * (3 - 2 * x);
}

function mix(start, end, amount) {
  return start + (end - start) * amount;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function refreshIcons() {
  if (window.lucide) {
    window.lucide.createIcons();
  }
}
