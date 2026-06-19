const DEFAULT_SETTINGS = {
  background: "#101615",
  zoom: 100,
  previewMode: "split",
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

  dom.resetPalette.addEventListener("click", () => {
    state.settings.background = DEFAULT_SETTINGS.background;
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
  const overlay = vectorOverlayColor(settings.background);

  for (let index = 0; index < data.length; index += 4) {
    const alpha = data[index + 3] / 255;
    const red = data[index];
    const green = data[index + 1];
    const blue = data[index + 2];

    if (alpha < 0.04) {
      data[index] = background.r;
      data[index + 1] = background.g;
      data[index + 2] = background.b;
      data[index + 3] = 255;
      continue;
    }

    data[index] = Math.abs(red - overlay.r);
    data[index + 1] = Math.abs(green - overlay.g);
    data[index + 2] = Math.abs(blue - overlay.b);
    data[index + 3] = 255;
  }

  return imageData;
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
    const { BlendMode, PDFDocument, rgb } = window.PDFLib;
    const sourcePdf = await PDFDocument.load(state.fileBytes);
    const outputPdf = await PDFDocument.create();
    const pageIndices = sourcePdf.getPageIndices();
    const copiedPages = await outputPdf.copyPages(sourcePdf, pageIndices);
    const overlay = vectorOverlayColor(state.settings.background);
    const overlayColor = rgb(overlay.r / 255, overlay.g / 255, overlay.b / 255);

    for (let index = 0; index < copiedPages.length; index += 1) {
      const pageNumber = index + 1;
      const page = copiedPages[index];
      const { width, height } = page.getSize();

      setStatus(`Converting page ${pageNumber} of ${copiedPages.length}...`, pageNumber / copiedPages.length * 92);
      outputPdf.addPage(page);
      prependWhitePageBackground(outputPdf, page, width, height);

      page.drawRectangle({
        x: 0,
        y: 0,
        width,
        height,
        color: overlayColor,
        blendMode: BlendMode.Difference,
      });
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

function prependWhitePageBackground(pdfDoc, page, width, height) {
  const {
    fill,
    popGraphicsState,
    pushGraphicsState,
    rectangle,
    setFillingRgbColor,
  } = window.PDFLib;

  page.node.normalize();
  const backgroundStream = page.createContentStream(
    pushGraphicsState(),
    setFillingRgbColor(1, 1, 1),
    rectangle(0, 0, width, height),
    fill(),
    popGraphicsState(),
  );
  const backgroundRef = pdfDoc.context.register(backgroundStream);
  page.node.Contents().insert(0, backgroundRef);
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

function vectorOverlayColor(backgroundHex) {
  const background = hexToRgb(backgroundHex);
  return {
    r: 255 - background.r,
    g: 255 - background.g,
    b: 255 - background.b,
  };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function refreshIcons() {
  if (window.lucide) {
    window.lucide.createIcons();
  }
}
