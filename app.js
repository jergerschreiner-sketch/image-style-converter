const imageInput = document.querySelector("#imageInput");
const generateButton = document.querySelector("#generateButton");
const downloadButton = document.querySelector("#downloadButton");
const previewCanvas = document.querySelector("#previewCanvas");
const emptyState = document.querySelector("#emptyState");
const posterizeInput = document.querySelector("#posterize");
const edgeDensityInput = document.querySelector("#edgeDensity");
const goldWidthInput = document.querySelector("#goldWidth");
const refinementInput = document.querySelector("#refinement");
const borderWidthInput = document.querySelector("#borderWidth");
const presetButtons = document.querySelectorAll(".segment");
const shapeButtons = document.querySelectorAll(".shape-option");

const ctx = previewCanvas.getContext("2d", { willReadFrequently: true });

const state = {
  image: null,
  fileName: "artwork",
  preset: "original",
  shape: "none",
  hasOutput: false,
};

imageInput.addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;

  const image = await loadImage(file);
  state.image = image;
  state.fileName = file.name.replace(/\.[^.]+$/, "") || "artwork";
  generateButton.disabled = false;
  renderArtwork();
});

generateButton.addEventListener("click", renderArtwork);

downloadButton.addEventListener("click", () => {
  if (!state.hasOutput) return;

  const link = document.createElement("a");
  link.download = `${state.fileName}-illustration.png`;
  link.href = previewCanvas.toDataURL("image/png");
  link.click();
});

presetButtons.forEach((button) => {
  button.addEventListener("click", () => {
    presetButtons.forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    state.preset = button.dataset.preset;
    if (state.image) renderArtwork();
  });
});

shapeButtons.forEach((button) => {
  button.addEventListener("click", () => {
    shapeButtons.forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    state.shape = button.dataset.shape;
    if (state.image) renderArtwork();
  });
});

[posterizeInput, edgeDensityInput, goldWidthInput, refinementInput, borderWidthInput].forEach((input) => {
  input.addEventListener("input", () => {
    if (state.image) renderArtwork();
  });
});

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = reject;
    image.src = url;
  });
}

function renderArtwork() {
  const source = state.image;
  if (!source) return;

  const refinement = Number(refinementInput.value);
  const maxArtworkWidth = 1320 + refinement * 170;
  const maxArtworkHeight = 840 + refinement * 110;
  const hasDecoration = state.shape !== "none";
  const border = hasDecoration ? Number(borderWidthInput.value) + refinement * 2 : 0;
  const fit = contain(source.width, source.height, maxArtworkWidth, maxArtworkHeight);
  const artworkWidth = Math.round(fit.width);
  const artworkHeight = Math.round(fit.height);

  previewCanvas.width = artworkWidth + border * 4;
  previewCanvas.height = artworkHeight + border * 4;
  ctx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);

  const x = hasDecoration ? border * 2 : 0;
  const y = hasDecoration ? border * 2 : 0;
  const shape = makeArtworkFrame(state.shape, x, y, artworkWidth, artworkHeight);

  if (hasDecoration) {
    drawFrameShadow(ctx, shape);
    drawArtworkFrame(ctx, shape, border);
    ctx.save();
    traceArtworkFrame(ctx, shape);
    ctx.clip();
  }

  const work = document.createElement("canvas");
  work.width = artworkWidth;
  work.height = artworkHeight;
  const workCtx = work.getContext("2d", { willReadFrequently: true });
  workCtx.drawImage(source, 0, 0, artworkWidth, artworkHeight);

  const imageData = workCtx.getImageData(0, 0, artworkWidth, artworkHeight);
  const styled = stylizeImage(imageData);
  workCtx.putImageData(styled.imageData, 0, 0);
  ctx.drawImage(work, x, y);

  drawIllustrationEdges(
    ctx,
    styled.edgeMask,
    styled.detailMask,
    styled.highlightMask,
    styled.palette,
    x,
    y,
    artworkWidth,
    artworkHeight,
  );

  if (hasDecoration) {
    ctx.restore();
    drawArtworkFrame(ctx, shape, border, styled.palette);
    drawFrameDetails(ctx, shape, styled.palette);
  }
  emptyState.classList.add("hidden");
  downloadButton.disabled = false;
  state.hasOutput = true;
}

function stylizeImage(imageData) {
  const original = new Uint8ClampedArray(imageData.data);
  const palette = analyzePalette(original);
  const data = imageData.data;
  const width = imageData.width;
  const height = imageData.height;
  const levels = Number(posterizeInput.value);
  const refinement = Number(refinementInput.value);
  const softened = boxBlurRgba(original, width, height, refinement >= 4 ? 1 : 2);
  const luminance = new Float32Array(width * height);
  const originalLuminance = new Float32Array(width * height);
  const highlightSource = new Float32Array(width * height);

  for (let i = 0; i < data.length; i += 4) {
    let [h, s, l] = rgbToHsl(softened[i], softened[i + 1], softened[i + 2]);
    const tuned = tuneColor(h, s, l);
    h = tuned.h;
    s = tuned.s;
    l = tuned.l;

    const hueSteps = Math.max(8, levels + 5);
    const lightSteps = Math.max(4, levels);
    const saturationSteps = Math.max(4, levels - 1);
    const quantizedH = Math.round(h * hueSteps) / hueSteps;
    const quantizedL = Math.round(l * lightSteps) / lightSteps;
    const quantizedS = Math.round(s * saturationSteps) / saturationSteps;
    const [r, g, b] = hslToRgb(quantizedH, clamp(quantizedS, 0, 1), clamp(quantizedL, 0, 1));
    const detailMix = 0.12 + refinement * 0.035;
    const mixed = mixRgb([r, g, b], [original[i], original[i + 1], original[i + 2]], detailMix);

    data[i] = mixed[0];
    data[i + 1] = mixed[1];
    data[i + 2] = mixed[2];
    data[i + 3] = 255;
    luminance[i / 4] = 0.2126 * softened[i] + 0.7152 * softened[i + 1] + 0.0722 * softened[i + 2];
    originalLuminance[i / 4] = 0.2126 * original[i] + 0.7152 * original[i + 1] + 0.0722 * original[i + 2];
    highlightSource[i / 4] = 0.2126 * mixed[0] + 0.7152 * mixed[1] + 0.0722 * mixed[2];
  }

  applyUnsharpMask(data, width, height, 0.18 + refinement * 0.11);
  const edgeMask = createEdgeMask(luminance, width, height, false);
  const detailMask = createFineDetailMask(originalLuminance, luminance, width, height);
  const highlightMask = createEdgeMask(highlightSource, width, height, true);
  return { imageData, edgeMask, detailMask, highlightMask, palette };
}

function tuneColor(h, s, l) {
  if (state.preset === "ink") {
    return {
      h,
      s: clamp(s * 0.32 + 0.04, 0, 0.3),
      l: clamp(l * 1.12 + 0.05, 0.16, 0.96),
    };
  }

  if (state.preset === "fresh") {
    return {
      h,
      s: clamp(s * 0.92 + 0.08, 0, 0.72),
      l: clamp(l * 1.1 + 0.07, 0.12, 0.96),
    };
  }

  if (state.preset === "dramatic") {
    return {
      h,
      s: clamp(s * 1.35 + 0.08, 0, 0.92),
      l: clamp(l * 0.82 + 0.04, 0.04, 0.84),
    };
  }

  return {
    h,
    s: clamp(s * 0.98 + 0.04, 0, 0.78),
    l: clamp(l * 1.04 + 0.03, 0.07, 0.94),
  };
}

function createEdgeMask(luminance, width, height, highlightsOnly) {
  const baseThreshold = highlightsOnly ? 118 : 108;
  const refinement = Number(refinementInput.value);
  const presetBoost = state.preset === "dramatic" || state.preset === "ink" ? 8 : 0;
  const threshold =
    baseThreshold -
    Number(edgeDensityInput.value) * (highlightsOnly ? 0.55 : 0.72) -
    refinement * 2.5 -
    presetBoost;
  const mask = new Uint8ClampedArray(width * height);

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x;
      const gx =
        -luminance[index - width - 1] -
        luminance[index - 1] * 2 -
        luminance[index + width - 1] +
        luminance[index - width + 1] +
        luminance[index + 1] * 2 +
        luminance[index + width + 1];
      const gy =
        -luminance[index - width - 1] -
        luminance[index - width] * 2 -
        luminance[index - width + 1] +
        luminance[index + width - 1] +
        luminance[index + width] * 2 +
        luminance[index + width + 1];
      const strength = Math.sqrt(gx * gx + gy * gy);
      const isBright = luminance[index] > 178;
      const isVeryDark = luminance[index] < 34;
      if (strength > threshold && (!highlightsOnly || isBright) && !isVeryDark) {
        mask[index] = 255;
      }
    }
  }

  return mask;
}

function createFineDetailMask(originalLuminance, softenedLuminance, width, height) {
  const refinement = Number(refinementInput.value);
  const threshold = 22 - refinement * 2.2;
  const mask = new Uint8ClampedArray(width * height);

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x;
      const localContrast = Math.abs(originalLuminance[index] - softenedLuminance[index]);
      const horizontal = Math.abs(originalLuminance[index - 1] - originalLuminance[index + 1]);
      const vertical = Math.abs(originalLuminance[index - width] - originalLuminance[index + width]);
      const detail = localContrast * 0.7 + Math.max(horizontal, vertical) * 0.55;

      if (detail > threshold && originalLuminance[index] > 42 && originalLuminance[index] < 228) {
        mask[index] = 255;
      }
    }
  }

  return mask;
}

function drawIllustrationEdges(
  targetCtx,
  mask,
  detailMask,
  highlightMask,
  palette,
  offsetX,
  offsetY,
  width,
  height,
) {
  const edgeCanvas = document.createElement("canvas");
  edgeCanvas.width = width;
  edgeCanvas.height = height;
  const edgeCtx = edgeCanvas.getContext("2d");
  const edgeData = edgeCtx.createImageData(width, height);
  const line = palette.line;

  for (let i = 0; i < mask.length; i += 1) {
    if (!mask[i]) continue;
    const out = i * 4;
    edgeData.data[out] = line[0];
    edgeData.data[out + 1] = line[1];
    edgeData.data[out + 2] = line[2];
    edgeData.data[out + 3] = 210;
  }

  edgeCtx.putImageData(edgeData, 0, 0);
  const widthSetting = Number(goldWidthInput.value);
  const refinement = Number(refinementInput.value);

  targetCtx.save();
  targetCtx.globalCompositeOperation = "source-over";
  for (let radius = widthSetting; radius > 0; radius -= 1) {
    targetCtx.globalAlpha = radius === widthSetting ? 0.16 : 0.42 + refinement * 0.025;
    targetCtx.drawImage(edgeCanvas, offsetX - radius, offsetY);
    targetCtx.drawImage(edgeCanvas, offsetX + radius, offsetY);
    targetCtx.drawImage(edgeCanvas, offsetX, offsetY - radius);
    targetCtx.drawImage(edgeCanvas, offsetX, offsetY + radius);
  }
  targetCtx.globalAlpha = 0.82;
  targetCtx.drawImage(edgeCanvas, offsetX, offsetY);

  const detailCanvas = makeMaskCanvas(detailMask, width, height, palette.accent, 128);
  targetCtx.globalAlpha = 0.28 + refinement * 0.045;
  targetCtx.drawImage(detailCanvas, offsetX, offsetY);

  const highlightCanvas = document.createElement("canvas");
  highlightCanvas.width = width;
  highlightCanvas.height = height;
  const highlightCtx = highlightCanvas.getContext("2d");
  const highlightData = highlightCtx.createImageData(width, height);
  const shine = palette.highlight;
  for (let i = 0; i < highlightMask.length; i += 1) {
    if (!highlightMask[i]) continue;
    const out = i * 4;
    highlightData.data[out] = shine[0];
    highlightData.data[out + 1] = shine[1];
    highlightData.data[out + 2] = shine[2];
    highlightData.data[out + 3] = 150;
  }
  highlightCtx.putImageData(highlightData, 0, 0);
  targetCtx.globalAlpha = 0.72;
  targetCtx.drawImage(highlightCanvas, offsetX, offsetY);
  targetCtx.restore();
}

function makeMaskCanvas(mask, width, height, color, alpha) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const maskCtx = canvas.getContext("2d");
  const imageData = maskCtx.createImageData(width, height);

  for (let i = 0; i < mask.length; i += 1) {
    if (!mask[i]) continue;
    const out = i * 4;
    imageData.data[out] = color[0];
    imageData.data[out + 1] = color[1];
    imageData.data[out + 2] = color[2];
    imageData.data[out + 3] = alpha;
  }

  maskCtx.putImageData(imageData, 0, 0);
  return canvas;
}

function makeArtworkFrame(kind, x, y, width, height) {
  return { kind, x, y, width, height };
}

function drawFrameShadow(targetCtx, shape) {
  targetCtx.save();
  targetCtx.shadowColor = "rgba(23, 32, 51, 0.16)";
  targetCtx.shadowBlur = 28;
  targetCtx.shadowOffsetY = 16;
  targetCtx.fillStyle = "#fff";
  traceArtworkFrame(targetCtx, shape);
  targetCtx.fill();
  targetCtx.restore();
}

function drawArtworkFrame(targetCtx, shape, border, palette = null) {
  targetCtx.save();
  traceArtworkFrame(targetCtx, shape);
  targetCtx.lineJoin = "round";
  targetCtx.lineCap = "round";
  targetCtx.strokeStyle = "#ffffff";
  targetCtx.lineWidth = border;
  targetCtx.stroke();
  targetCtx.strokeStyle = rgbCss(palette?.accent ?? [214, 161, 41]);
  targetCtx.lineWidth = Math.max(3, border * 0.14);
  targetCtx.stroke();
  targetCtx.strokeStyle = rgbCss(palette?.highlight ?? [255, 245, 215]);
  targetCtx.lineWidth = Math.max(1.4, border * 0.055);
  targetCtx.stroke();
  targetCtx.restore();
}

function drawFrameDetails(targetCtx, shape, palette) {
  if (shape.kind === "comic") {
    targetCtx.save();
    traceArtworkFrame(targetCtx, shape);
    targetCtx.strokeStyle = rgbCss(palette.line);
    targetCtx.lineWidth = Math.max(2, Math.min(shape.width, shape.height) * 0.006);
    targetCtx.stroke();
    targetCtx.restore();
  }
}

function traceArtworkFrame(targetCtx, shape) {
  const { kind, x, y, width, height } = shape;
  const r = Math.min(width, height) * 0.055;

  if (kind === "paper") {
    roundedRectPath(targetCtx, x, y, width, height, r);
    return;
  }

  if (kind === "comic") {
    roundedRectPath(targetCtx, x, y, width, height, Math.max(8, r * 0.45));
    return;
  }

  if (kind === "film") {
    filmPath(targetCtx, x, y, width, height);
    return;
  }

  roundedRectPath(targetCtx, x, y, width, height, 0);
}

function roundedRectPath(targetCtx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  targetCtx.beginPath();
  targetCtx.moveTo(x + r, y);
  targetCtx.lineTo(x + width - r, y);
  targetCtx.quadraticCurveTo(x + width, y, x + width, y + r);
  targetCtx.lineTo(x + width, y + height - r);
  targetCtx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  targetCtx.lineTo(x + r, y + height);
  targetCtx.quadraticCurveTo(x, y + height, x, y + height - r);
  targetCtx.lineTo(x, y + r);
  targetCtx.quadraticCurveTo(x, y, x + r, y);
  targetCtx.closePath();
}

function ticketPath(targetCtx, x, y, width, height) {
  const r = Math.min(width, height) * 0.045;
  const notch = Math.min(width, height) * 0.075;
  const middle = y + height / 2;

  targetCtx.beginPath();
  targetCtx.moveTo(x + r, y);
  targetCtx.lineTo(x + width - r, y);
  targetCtx.quadraticCurveTo(x + width, y, x + width, y + r);
  targetCtx.lineTo(x + width, middle - notch);
  targetCtx.quadraticCurveTo(x + width - notch, middle - notch * 0.75, x + width - notch, middle);
  targetCtx.quadraticCurveTo(x + width - notch, middle + notch * 0.75, x + width, middle + notch);
  targetCtx.lineTo(x + width, y + height - r);
  targetCtx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  targetCtx.lineTo(x + r, y + height);
  targetCtx.quadraticCurveTo(x, y + height, x, y + height - r);
  targetCtx.lineTo(x, middle + notch);
  targetCtx.quadraticCurveTo(x + notch, middle + notch * 0.75, x + notch, middle);
  targetCtx.quadraticCurveTo(x + notch, middle - notch * 0.75, x, middle - notch);
  targetCtx.lineTo(x, y + r);
  targetCtx.quadraticCurveTo(x, y, x + r, y);
  targetCtx.closePath();
}

function badgePath(targetCtx, x, y, width, height) {
  const cut = Math.min(width, height) * 0.14;
  const midCut = Math.min(width, height) * 0.055;

  targetCtx.beginPath();
  targetCtx.moveTo(x + cut, y + midCut);
  targetCtx.lineTo(x + width - cut, y + midCut);
  targetCtx.quadraticCurveTo(x + width - midCut, y + midCut, x + width - midCut, y + cut);
  targetCtx.lineTo(x + width - midCut, y + height - cut);
  targetCtx.quadraticCurveTo(x + width - midCut, y + height - midCut, x + width - cut, y + height - midCut);
  targetCtx.lineTo(x + cut, y + height - midCut);
  targetCtx.quadraticCurveTo(x + midCut, y + height - midCut, x + midCut, y + height - cut);
  targetCtx.lineTo(x + midCut, y + cut);
  targetCtx.quadraticCurveTo(x + midCut, y + midCut, x + cut, y + midCut);
  targetCtx.closePath();
}

function filmPath(targetCtx, x, y, width, height) {
  const corner = Math.min(width, height) * 0.045;
  const tooth = Math.min(width, height) * 0.032;
  const step = Math.max(42, Math.min(width, height) * 0.085);
  const right = x + width;
  const bottom = y + height;

  targetCtx.beginPath();
  targetCtx.moveTo(x + corner, y);
  for (let sx = x + corner; sx < right - corner; sx += step) {
    const ex = Math.min(sx + step * 0.52, right - corner);
    targetCtx.lineTo(sx, y);
    targetCtx.lineTo(sx + step * 0.16, y + tooth);
    targetCtx.lineTo(ex, y + tooth);
    targetCtx.lineTo(Math.min(sx + step * 0.68, right - corner), y);
  }
  targetCtx.lineTo(right - corner, y);
  targetCtx.quadraticCurveTo(right, y, right, y + corner);
  targetCtx.lineTo(right, bottom - corner);
  targetCtx.quadraticCurveTo(right, bottom, right - corner, bottom);
  for (let sx = right - corner; sx > x + corner; sx -= step) {
    const ex = Math.max(sx - step * 0.52, x + corner);
    targetCtx.lineTo(sx, bottom);
    targetCtx.lineTo(sx - step * 0.16, bottom - tooth);
    targetCtx.lineTo(ex, bottom - tooth);
    targetCtx.lineTo(Math.max(sx - step * 0.68, x + corner), bottom);
  }
  targetCtx.lineTo(x + corner, bottom);
  targetCtx.quadraticCurveTo(x, bottom, x, bottom - corner);
  targetCtx.lineTo(x, y + corner);
  targetCtx.quadraticCurveTo(x, y, x + corner, y);
  targetCtx.closePath();
}

function analyzePalette(data) {
  const hueBins = new Array(24).fill(0).map(() => ({ weight: 0, h: 0, s: 0, l: 0 }));
  const dark = [0, 0, 0];
  const bright = [0, 0, 0];
  let darkWeight = 0;
  let brightWeight = 0;

  for (let i = 0; i < data.length; i += 80) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const [h, s, l] = rgbToHsl(r, g, b);
    const colorWeight = (0.18 + s) * (1 - Math.abs(l - 0.5) * 0.65);
    const bin = hueBins[Math.floor(h * hueBins.length) % hueBins.length];
    bin.weight += colorWeight;
    bin.h += h * colorWeight;
    bin.s += s * colorWeight;
    bin.l += l * colorWeight;

    if (l < 0.42) {
      const weight = 0.25 + (0.42 - l) + s * 0.45;
      dark[0] += r * weight;
      dark[1] += g * weight;
      dark[2] += b * weight;
      darkWeight += weight;
    }

    if (l > 0.62) {
      const weight = 0.25 + (l - 0.62) + s * 0.25;
      bright[0] += r * weight;
      bright[1] += g * weight;
      bright[2] += b * weight;
      brightWeight += weight;
    }
  }

  const main = hueBins.reduce((best, item) => (item.weight > best.weight ? item : best), hueBins[0]);
  const hue = main.weight ? main.h / main.weight : 0.08;
  const saturation = main.weight ? main.s / main.weight : 0.42;
  const darkRgb =
    darkWeight > 0
      ? dark.map((value) => Math.round(value / darkWeight))
      : hslToRgb(hue, clamp(saturation, 0.28, 0.68), 0.22);
  const brightRgb =
    brightWeight > 0
      ? bright.map((value) => Math.round(value / brightWeight))
      : hslToRgb(hue, clamp(saturation * 0.45, 0.12, 0.38), 0.9);

  const lineHsl = rgbToHsl(darkRgb[0], darkRgb[1], darkRgb[2]);
  const accent = hslToRgb(hue, clamp(saturation * 0.9 + 0.16, 0.34, 0.78), 0.56);
  const line = hslToRgb(lineHsl[0], clamp(lineHsl[1] * 0.8 + 0.18, 0.22, 0.65), 0.24);
  const highlight = mixRgb(brightRgb, [255, 255, 255], 0.52);

  return { accent, line, highlight };
}

function applyUnsharpMask(data, width, height, amount) {
  const source = new Uint8ClampedArray(data);
  const blurred = boxBlurRgba(source, width, height, 1);

  for (let i = 0; i < data.length; i += 4) {
    data[i] = clamp(Math.round(source[i] + (source[i] - blurred[i]) * amount), 0, 255);
    data[i + 1] = clamp(Math.round(source[i + 1] + (source[i + 1] - blurred[i + 1]) * amount), 0, 255);
    data[i + 2] = clamp(Math.round(source[i + 2] + (source[i + 2] - blurred[i + 2]) * amount), 0, 255);
    data[i + 3] = 255;
  }
}

function boxBlurRgba(input, width, height, radius) {
  const temp = new Uint8ClampedArray(input.length);
  const output = new Uint8ClampedArray(input.length);
  const windowSize = radius * 2 + 1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const out = (y * width + x) * 4;
      let r = 0;
      let g = 0;
      let b = 0;
      for (let dx = -radius; dx <= radius; dx += 1) {
        const sampleX = clamp(x + dx, 0, width - 1);
        const index = (y * width + sampleX) * 4;
        r += input[index];
        g += input[index + 1];
        b += input[index + 2];
      }
      temp[out] = r / windowSize;
      temp[out + 1] = g / windowSize;
      temp[out + 2] = b / windowSize;
      temp[out + 3] = 255;
    }
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const out = (y * width + x) * 4;
      let r = 0;
      let g = 0;
      let b = 0;
      for (let dy = -radius; dy <= radius; dy += 1) {
        const sampleY = clamp(y + dy, 0, height - 1);
        const index = (sampleY * width + x) * 4;
        r += temp[index];
        g += temp[index + 1];
        b += temp[index + 2];
      }
      output[out] = r / windowSize;
      output[out + 1] = g / windowSize;
      output[out + 2] = b / windowSize;
      output[out + 3] = 255;
    }
  }

  return output;
}

function mixRgb(a, b, amount) {
  return [
    Math.round(a[0] * (1 - amount) + b[0] * amount),
    Math.round(a[1] * (1 - amount) + b[1] * amount),
    Math.round(a[2] * (1 - amount) + b[2] * amount),
  ];
}

function rgbCss(rgb) {
  return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
}

function tracePolygon(targetCtx, points) {
  targetCtx.beginPath();
  targetCtx.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i += 1) {
    targetCtx.lineTo(points[i][0], points[i][1]);
  }
  targetCtx.closePath();
}

function contain(width, height, maxWidth, maxHeight) {
  const scale = Math.min(maxWidth / width, maxHeight / height, 1.65);
  return {
    width: width * scale,
    height: height * scale,
  };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function rgbToHsl(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      default:
        h = (r - g) / d + 4;
    }
    h /= 6;
  }

  return [h, s, l];
}

function hslToRgb(h, s, l) {
  let r;
  let g;
  let b;

  if (s === 0) {
    r = l;
    g = l;
    b = l;
  } else {
    const hue2rgb = (p, q, t) => {
      let next = t;
      if (next < 0) next += 1;
      if (next > 1) next -= 1;
      if (next < 1 / 6) return p + (q - p) * 6 * next;
      if (next < 1 / 2) return q;
      if (next < 2 / 3) return p + (q - p) * (2 / 3 - next) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }

  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}
