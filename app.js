const imageInput = document.querySelector("#imageInput");
const referenceLengthInput = document.querySelector("#referenceLength");
const thicknessInput = document.querySelector("#thickness");
const densityInput = document.querySelector("#density");
const sensitivityInput = document.querySelector("#sensitivity");
const estimateBtn = document.querySelector("#estimateBtn");
const resetBtn = document.querySelector("#resetBtn");
const emptyState = document.querySelector("#emptyState");
const canvas = document.querySelector("#previewCanvas");
const ctx = canvas.getContext("2d", { willReadFrequently: true });

const weightResult = document.querySelector("#weightResult");
const areaResult = document.querySelector("#areaResult");
const confidenceResult = document.querySelector("#confidenceResult");

let sourceImage = null;
let drawInfo = null;
let referencePoints = [];
let lastMask = null;

const defaultCanvas = { width: 960, height: 640 };

function resetResults() {
  weightResult.textContent = "-- kg";
  areaResult.textContent = "-- m²";
  confidenceResult.textContent = "--";
  confidenceResult.classList.remove("is-warning");
}

function resetAll() {
  sourceImage = null;
  drawInfo = null;
  referencePoints = [];
  lastMask = null;
  imageInput.value = "";
  canvas.width = defaultCanvas.width;
  canvas.height = defaultCanvas.height;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  emptyState.classList.remove("hidden");
  resetResults();
}

function fitImageToCanvas(img) {
  const maxWidth = 1200;
  const maxHeight = 820;
  const ratio = Math.min(maxWidth / img.naturalWidth, maxHeight / img.naturalHeight, 1);
  const drawWidth = Math.round(img.naturalWidth * ratio);
  const drawHeight = Math.round(img.naturalHeight * ratio);

  canvas.width = drawWidth;
  canvas.height = drawHeight;

  return {
    x: 0,
    y: 0,
    width: drawWidth,
    height: drawHeight,
    scale: ratio,
  };
}

function drawBaseImage() {
  if (!sourceImage || !drawInfo) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(sourceImage, drawInfo.x, drawInfo.y, drawInfo.width, drawInfo.height);
}

function drawReferenceLine() {
  if (!referencePoints.length) return;

  ctx.save();
  ctx.lineWidth = Math.max(3, canvas.width * 0.004);
  ctx.strokeStyle = "#f2c14e";
  ctx.fillStyle = "#172017";

  referencePoints.forEach((point) => {
    ctx.beginPath();
    ctx.arc(point.x, point.y, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  });

  if (referencePoints.length === 2) {
    const [a, b] = referencePoints;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  ctx.restore();
}

function redraw(maskOverlay = true) {
  drawBaseImage();
  if (maskOverlay && lastMask) drawMask(lastMask);
  drawReferenceLine();
}

function getCanvasPoint(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / rect.width) * canvas.width,
    y: ((event.clientY - rect.top) / rect.height) * canvas.height,
  };
}

function rgbToHsv(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let h = 0;

  if (delta !== 0) {
    if (max === r) h = ((g - b) / delta) % 6;
    else if (max === g) h = (b - r) / delta + 2;
    else h = (r - g) / delta + 4;
    h *= 60;
    if (h < 0) h += 360;
  }

  const s = max === 0 ? 0 : delta / max;
  return { h, s, v: max };
}

function isLeafPixel(r, g, b, sensitivity) {
  const { h, s, v } = rgbToHsv(r, g, b);
  const greenLike = h >= 38 && h <= 126;
  const yellowBrownLike = h >= 16 && h <= 54;
  const redBrownLike = h >= 0 && h <= 24;
  const satMin = 0.12 + (100 - sensitivity) * 0.0022;
  const notTooDark = v > 0.09;
  const notWashedOut = !(s < 0.12 && v > 0.72);
  const notBlue = !(h >= 165 && h <= 260);

  return (greenLike || yellowBrownLike || redBrownLike) && s >= satMin && notTooDark && notWashedOut && notBlue;
}

function detectLeafMask() {
  drawBaseImage();
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  const sensitivity = Number(sensitivityInput.value);
  const mask = new Uint8Array(canvas.width * canvas.height);
  let maskPixels = 0;

  for (let i = 0, pixelIndex = 0; i < data.length; i += 4, pixelIndex += 1) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];

    if (isLeafPixel(r, g, b, sensitivity)) {
      mask[pixelIndex] = 1;
      maskPixels += 1;
    }
  }

  lastMask = {
    data: mask,
    pixels: maskPixels,
    width: canvas.width,
    height: canvas.height,
  };

  return lastMask;
}

function drawMask(mask) {
  const maskCanvas = document.createElement("canvas");
  maskCanvas.width = mask.width;
  maskCanvas.height = mask.height;
  const maskCtx = maskCanvas.getContext("2d");
  const overlay = ctx.createImageData(mask.width, mask.height);
  for (let i = 0; i < mask.data.length; i += 1) {
    if (mask.data[i]) {
      const offset = i * 4;
      overlay.data[offset] = 54;
      overlay.data[offset + 1] = 102;
      overlay.data[offset + 2] = 65;
      overlay.data[offset + 3] = 88;
    }
  }
  maskCtx.putImageData(overlay, 0, 0);
  ctx.drawImage(maskCanvas, 0, 0);
}

function getReferencePixels() {
  if (referencePoints.length !== 2) return 0;
  const [a, b] = referencePoints;
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function estimateConfidence(maskRatio, hasReference) {
  let score = 42;
  if (hasReference) score += 28;
  if (canvas.width * canvas.height > 300000) score += 8;
  if (maskRatio > 0.04 && maskRatio < 0.7) score += 14;
  if (Number(thicknessInput.value) > 0 && Number(densityInput.value) > 0) score += 8;
  return Math.min(96, Math.max(20, Math.round(score)));
}

function estimateWeight() {
  if (!sourceImage) {
    alert("请先上传烟叶图片。");
    return;
  }

  const referencePixels = getReferencePixels();
  const referenceLengthCm = Number(referenceLengthInput.value);

  if (!referencePixels || !referenceLengthCm) {
    alert("请先在图片上点击两次画出参考线，并填写真实长度。");
    return;
  }

  const thicknessCm = Number(thicknessInput.value);
  const densityKgM3 = Number(densityInput.value);

  if (!thicknessCm || !densityKgM3) {
    alert("请填写堆积平均厚度和松散堆积密度。");
    return;
  }

  const mask = detectLeafMask();
  const cmPerPixel = referenceLengthCm / referencePixels;
  const areaM2 = (mask.pixels * cmPerPixel * cmPerPixel) / 10000;
  const volumeM3 = areaM2 * (thicknessCm / 100);
  const weightKg = volumeM3 * densityKgM3;
  const maskRatio = mask.pixels / (mask.width * mask.height);
  const confidence = estimateConfidence(maskRatio, true);

  redraw(true);
  weightResult.textContent = `${weightKg.toFixed(2)} kg`;
  areaResult.textContent = `${areaM2.toFixed(3)} m²`;
  confidenceResult.textContent = `${confidence}%`;
  confidenceResult.classList.toggle("is-warning", confidence < 70);
}

imageInput.addEventListener("change", (event) => {
  const file = event.target.files?.[0];
  if (!file) return;

  if (!["image/jpeg", "image/png"].includes(file.type)) {
    alert("请上传 JPG、JPEG 或 PNG 图片。");
    imageInput.value = "";
    return;
  }

  const img = new Image();
  img.onload = () => {
    sourceImage = img;
    drawInfo = fitImageToCanvas(img);
    referencePoints = [];
    lastMask = null;
    resetResults();
    emptyState.classList.add("hidden");
    redraw(false);
    URL.revokeObjectURL(img.src);
  };
  img.src = URL.createObjectURL(file);
});

canvas.addEventListener("click", (event) => {
  if (!sourceImage) return;
  const point = getCanvasPoint(event);
  if (referencePoints.length >= 2) referencePoints = [];
  referencePoints.push(point);
  redraw(Boolean(lastMask));
});

estimateBtn.addEventListener("click", estimateWeight);
resetBtn.addEventListener("click", resetAll);

document.querySelectorAll("[data-ref]").forEach((button) => {
  button.addEventListener("click", () => {
    referenceLengthInput.value = button.dataset.ref;
  });
});

[referenceLengthInput, thicknessInput, densityInput, sensitivityInput].forEach((input) => {
  input.addEventListener("input", () => {
    if (!sourceImage) return;
    if (lastMask) estimateWeight();
  });
});

resetAll();
