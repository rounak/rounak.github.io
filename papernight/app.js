const DEFAULT_BACKGROUND = "#101615";

const state = {
  fileBytes: null,
  fileName: "",
  convertedUrl: "",
};

const dom = {};

window.addEventListener("DOMContentLoaded", () => {
  cacheDom();
  bindEvents();
  const engineReady = librariesReady();
  document.documentElement.dataset.pdfEngine = engineReady ? "ready" : "missing";
  setStatus(engineReady ? "Choose a PDF." : "PDF engine failed to load.", 0);
});

function cacheDom() {
  ["fileInput", "fileMeta", "convertButton", "progressBar", "statusLine"].forEach((id) => {
    dom[id] = document.getElementById(id);
  });
}

function bindEvents() {
  dom.fileInput.addEventListener("change", (event) => {
    const [file] = event.target.files || [];
    if (file) {
      loadPdfFile(file);
    }
  });

  dom.convertButton.addEventListener("click", convertPdf);
}

function librariesReady() {
  return Boolean(window.PDFLib);
}

async function loadPdfFile(file) {
  if (!isPdf(file)) {
    resetFileState("Choose a PDF file.");
    return;
  }

  if (!librariesReady()) {
    resetFileState("PDF engine failed to load.");
    return;
  }

  try {
    setStatus("Loading PDF...", 10);
    revokeDownloadUrl();

    state.fileBytes = await file.arrayBuffer();
    state.fileName = file.name;

    dom.fileMeta.textContent = `${file.name} - ${formatBytes(file.size)}`;
    dom.convertButton.disabled = false;
    setStatus("Ready to convert.", 0);
  } catch (error) {
    console.error(error);
    resetFileState("Could not read that PDF.");
  } finally {
    dom.fileInput.value = "";
  }
}

function resetFileState(message) {
  revokeDownloadUrl();
  state.fileBytes = null;
  state.fileName = "";
  dom.fileMeta.textContent = "No file selected";
  dom.convertButton.disabled = true;
  setStatus(message, 0);
}

function isPdf(file) {
  return file.type === "application/pdf" || /\.pdf$/i.test(file.name);
}

async function convertPdf() {
  if (!state.fileBytes) {
    setStatus("Choose a PDF first.", 0);
    return;
  }

  dom.convertButton.disabled = true;

  try {
    const { BlendMode, PDFDocument, rgb } = window.PDFLib;
    const sourcePdf = await PDFDocument.load(state.fileBytes);
    const outputPdf = await PDFDocument.create();
    const pageIndices = sourcePdf.getPageIndices();
    const copiedPages = await outputPdf.copyPages(sourcePdf, pageIndices);
    const overlay = vectorOverlayColor(DEFAULT_BACKGROUND);
    const overlayColor = rgb(overlay.r / 255, overlay.g / 255, overlay.b / 255);

    for (let index = 0; index < copiedPages.length; index += 1) {
      const pageNumber = index + 1;
      const page = copiedPages[index];
      const { width, height } = page.getSize();

      setStatus(
        `Converting page ${pageNumber} of ${copiedPages.length}...`,
        (pageNumber / copiedPages.length) * 92,
      );

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

    setStatus("Building PDF...", 96);
    const pdfBytes = await outputPdf.save();
    downloadBlob(new Blob([pdfBytes], { type: "application/pdf" }));
    setStatus("Converted. Download started.", 100);
  } catch (error) {
    console.error(error);
    setStatus("Conversion failed.", 0);
  } finally {
    dom.convertButton.disabled = !state.fileBytes;
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

function downloadBlob(blob) {
  revokeDownloadUrl();
  state.convertedUrl = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = state.convertedUrl;
  link.download = darkFileName(state.fileName);
  document.body.append(link);
  link.click();
  link.remove();
}

function revokeDownloadUrl() {
  if (state.convertedUrl) {
    URL.revokeObjectURL(state.convertedUrl);
    state.convertedUrl = "";
  }
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
