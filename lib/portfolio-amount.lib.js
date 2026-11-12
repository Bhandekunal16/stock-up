const sharp = require("sharp");
const otsuThreshold = require("./image-threshold.lib");

const AMOUNT_FORMAT = /^(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2}$/;

function getCurrencyBoundary(grayscale, imageWidth, word) {
  const { x0, x1, y0, y1 } = word.bbox;
  const startsWithParenthesis = word.text.trim().startsWith("(");
  const symbols = word.symbols || [];
  const decimal = symbols.find((symbol) => symbol.text === ".")?.bbox;
  const scanStart = Math.max(0, Math.floor(x0));
  const scanEnd = Math.min(
    imageWidth,
    Math.ceil(decimal?.x0 ?? x1),
  );
  const top = Math.max(0, Math.floor(y0));
  const bottom = Math.max(top + 1, Math.ceil(y1));
  const height = bottom - top;
  const minGap = Math.max(2, Math.round(height * 0.05));
  const region = [];
  for (let y = top; y < bottom; y += 1) {
    for (let x = scanStart; x < scanEnd; x += 1) {
      region.push(grayscale[y * imageWidth + x]);
    }
  }
  const { threshold: pixelThreshold } = otsuThreshold(region);
  const isInk = (value) => value > pixelThreshold;

  // A full-height blank run marks the visual boundary between the currency
  // glyph (and an optional opening parenthesis) and the numeric characters.
  let sawInk = false;
  let gapStart = -1;
  let gapCount = 0;

  for (let x = scanStart; x < scanEnd; x += 1) {
    let inkCount = 0;
    for (let y = top; y < bottom; y += 1) {
      if (isInk(grayscale[y * imageWidth + x])) {
        inkCount += 1;
      }
    }

    if (inkCount === 0) {
      if (sawInk) {
        if (gapStart < 0) {
          gapStart = x;
        }
        if (x - gapStart + 1 >= minGap) {
          gapCount += 1;
          if (!startsWithParenthesis || gapCount === 2) {
            return x + 1;
          }
          sawInk = false;
          gapStart = -1;
        }
      }
      continue;
    }

    sawInk = true;
    gapStart = -1;
  }

  return null;
}

function parseAmount(text) {
  const normalized = String(text || "").trim();
  if (!AMOUNT_FORMAT.test(normalized)) {
    return null;
  }

  const value = Number(normalized.replace(/,/g, ""));
  return Number.isFinite(value) ? value : null;
}

async function recognizeNumericCrop(worker, image, word, startX, thresholded) {
  const left = Math.min(image.width - 1, Math.max(0, Math.floor(startX)));
  const padding = Math.max(
    2,
    Math.round((word.bbox.y1 - word.bbox.y0) * 0.15),
  );
  const top = Math.max(0, Math.floor(word.bbox.y0) - padding);
  const right = Math.min(image.width, Math.ceil(word.bbox.x1));
  const bottom = Math.min(image.height, Math.ceil(word.bbox.y1) + padding);
  const width = right - left;
  const height = bottom - top;

  if (width < 2 || height < 2) {
    return { text: "", confidence: 0 };
  }

  let crop = sharp(image.buffer).extract({ left, top, width, height });
  if (thresholded) {
    const raw = await sharp(image.buffer)
      .extract({ left, top, width, height })
      .greyscale()
      .raw()
      .toBuffer();
    crop = crop.greyscale().threshold(otsuThreshold(raw).threshold);
  }

  const cropBuffer = await crop
    .resize({ width: Math.max(width * 3, 240) })
    .png()
    .toBuffer();

  await worker.setParameters({
    tessedit_pageseg_mode: "7",
    tessedit_char_whitelist: "0123456789,.",
    preserve_interword_spaces: "1",
  });

  const { data } = await worker.recognize(cropBuffer, {}, { blocks: true });
  const symbols = (data.blocks || [])
    .flatMap((block) => block.paragraphs || [])
    .flatMap((paragraph) => paragraph.lines || [])
    .flatMap((line) => line.words || [])
    .flatMap((word) => word.symbols || []);
  const confidence = symbols.length
    ? symbols.reduce((sum, symbol) => sum + Number(symbol.confidence || 0), 0) /
      symbols.length
    : Number(data.confidence || 0);

  return {
    text: data.text || "",
    confidence,
  };
}

async function recognizeAmount(worker, image, word) {
  const numericStart = getCurrencyBoundary(
    image.grayscale,
    image.width,
    word,
  );

  if (numericStart === null) {
    return {
      value: null,
      text: word.text,
      confidence: Number(word.confidence || 0),
      reason: "Currency and numeric characters could not be separated by layout",
    };
  }

  let recognition = await recognizeNumericCrop(
    worker,
    image,
    word,
    numericStart,
    false,
  );
  let value = parseAmount(recognition.text);

  if (value === null || recognition.confidence < 65) {
    const fallback = await recognizeNumericCrop(
      worker,
      image,
      word,
      numericStart,
      true,
    );
    if (
      parseAmount(fallback.text) !== null &&
      fallback.confidence > recognition.confidence
    ) {
      recognition = fallback;
      value = parseAmount(fallback.text);
    }
  }

  const layoutText = (word.symbols || [])
    .filter((symbol) => {
      return symbol.bbox.x1 > numericStart;
    })
    .map((symbol) => symbol.text)
    .join("")
    .replace(/[^0-9,.]/g, "");
  const layoutValue = parseAmount(layoutText);
  if (value !== null && layoutValue !== value) {
    return {
      value: null,
      text: recognition.text.trim(),
      confidence: recognition.confidence,
      reason:
        "The row-layout reading and isolated numeric OCR reading disagree",
      layoutText,
    };
  }

  return {
    value,
    text: recognition.text.trim(),
    confidence: recognition.confidence,
    reason:
      value === null
        ? "Amount did not match a valid monetary format"
        : recognition.confidence < 65
          ? "Amount OCR confidence is below the accepted threshold"
          : null,
  };
}

module.exports = {
  AMOUNT_FORMAT,
  getCurrencyBoundary,
  parseAmount,
  recognizeAmount,
};
