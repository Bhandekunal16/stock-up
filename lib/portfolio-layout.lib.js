const MONEY_PATTERN = /\d[\d,]*\.\d{2}/;
const SHARE_PATTERN = /^(\d+)\s+shares?\b/i;
const ALPHA_PATTERN = /[A-Za-z]/;
const otsuThreshold = require("./image-threshold.lib");

function lineWords(blocks) {
  const lines = [];

  for (const block of blocks || []) {
    for (const paragraph of block.paragraphs || []) {
      for (const line of paragraph.lines || []) {
        const words = (line.words || [])
          .filter((word) => word.text && word.bbox)
          .map((word) => ({
            ...word,
            text: word.text.trim(),
          }));

        if (words.length) {
          lines.push({
            bbox: line.bbox,
            words,
            text: words.map((word) => word.text).join(" "),
            confidence: line.confidence,
          });
        }
      }
    }
  }

  return lines.sort((a, b) => a.bbox.y0 - b.bbox.y0);
}

function findNameColumnBoundary(lines) {
  const starts = lines
    .flatMap((line) =>
      line.words
        .filter((word) => ALPHA_PATTERN.test(word.text))
        .map((word) => word.bbox.x0),
    )
    .sort((a, b) => a - b);

  let largestGap = 0;
  let boundary = Number.POSITIVE_INFINITY;

  for (let index = 1; index < starts.length; index += 1) {
    const gap = starts[index] - starts[index - 1];
    if (gap > largestGap) {
      largestGap = gap;
      boundary = (starts[index] + starts[index - 1]) / 2;
    }
  }

  return boundary;
}

function getCompanyText(line, nameBoundary) {
  if (SHARE_PATTERN.test(line.text)) {
    return null;
  }

  const nameWords = line.words.filter(
    (word) =>
      word.bbox.x0 < nameBoundary &&
      (ALPHA_PATTERN.test(word.text) || /^\d+$/.test(word.text)) &&
      !MONEY_PATTERN.test(word.text),
  );
  const company = nameWords.map((word) => word.text).join(" ").trim();

  if (!company || !nameWords.length) {
    return null;
  }

  return {
    company,
    confidence:
      nameWords.reduce((sum, word) => sum + Number(word.confidence || 0), 0) /
      nameWords.length,
    bbox: line.bbox,
    centerY: (line.bbox.y0 + line.bbox.y1) / 2,
  };
}

function collectMoneyLines(lines) {
  const moneyLines = [];

  for (const line of lines) {
    const words = line.words.filter((word) => MONEY_PATTERN.test(word.text));
    if (!words.length) {
      continue;
    }

    moneyLines.push({
      words,
      bbox: line.bbox,
      centerY: (line.bbox.y0 + line.bbox.y1) / 2,
      confidence:
        words.reduce((sum, word) => sum + Number(word.confidence || 0), 0) /
        words.length,
    });
  }

  return moneyLines;
}

function findHorizontalSeparators(image) {
  if (!image?.grayscale || !image.width || !image.height) {
    return [];
  }

  const { threshold, background } = otsuThreshold(image.grayscale);
  const contrastThreshold = Math.max(8, Math.abs(threshold - background) * 0.25);
  const separators = [];
  let runStart = -1;
  const minimumCoverage = image.width * 0.65;

  for (let y = 0; y < image.height; y += 1) {
    let contrastingPixels = 0;
    const offset = y * image.width;
    for (let x = 0; x < image.width; x += 1) {
      if (Math.abs(image.grayscale[offset + x] - background) > contrastThreshold) {
        contrastingPixels += 1;
      }
    }

    if (contrastingPixels >= minimumCoverage) {
      if (runStart < 0) {
        runStart = y;
      }
    } else if (runStart >= 0) {
      separators.push((runStart + y - 1) / 2);
      runStart = -1;
    }
  }

  if (runStart >= 0) {
    separators.push((runStart + image.height - 1) / 2);
  }

  return separators;
}

function rowBand(centerY, separators) {
  return separators.filter((separator) => separator < centerY).length;
}

function nearestRowIndex(rows, centerY, separators) {
  const band = rowBand(centerY, separators);
  let nearestIndex = -1;
  let nearestDistance = Number.POSITIVE_INFINITY;

  rows.forEach((row, index) => {
    if (row.band !== band) {
      return;
    }

    const distance = Math.abs(row.centerY - centerY);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestIndex = index;
    }
  });

  return nearestIndex;
}

module.exports = function detectPortfolioLayout(blocks, image) {
  const lines = lineWords(blocks);
  if (!lines.length) {
    return { rows: [], issues: [{ field: "layout", reason: "No text detected" }] };
  }

  const nameBoundary = findNameColumnBoundary(lines);
  const companyCandidates = lines
    .map((line) => getCompanyText(line, nameBoundary))
    .filter(Boolean)
    .sort((a, b) => a.centerY - b.centerY);
  const separators = findHorizontalSeparators(image);
  const shareLines = lines
    .map((line) => {
      const match = line.text.match(SHARE_PATTERN);
      return match
        ? {
            shares: Number(match[1]),
            confidence:
              line.words
                .filter((word) => /^\d+$/.test(word.text) || /^shares?$/i.test(word.text))
                .reduce(
                  (sum, word, _, list) =>
                    sum + Number(word.confidence || 0) / list.length,
                  0,
                ),
            centerY: (line.bbox.y0 + line.bbox.y1) / 2,
          }
        : null;
    })
    .filter(Boolean);

  const moneyLines = collectMoneyLines(lines);
  const rows = companyCandidates.map((candidate) => ({
    company: candidate.company,
    companyConfidence: candidate.confidence,
    centerY: candidate.centerY,
    band: rowBand(candidate.centerY, separators),
    shareLines: [],
    amountLines: [],
  }));
  const issues = [];

  for (const shareLine of shareLines) {
    const rowIndex = nearestRowIndex(rows, shareLine.centerY, separators);
    if (rowIndex >= 0) {
      rows[rowIndex].shareLines.push(shareLine);
    } else {
      issues.push({
        field: "shares",
        reason: "A share quantity could not be associated with a company row",
      });
    }
  }

  for (const moneyLine of moneyLines) {
    const rowIndex = nearestRowIndex(rows, moneyLine.centerY, separators);
    if (rowIndex >= 0) {
      rows[rowIndex].amountLines.push(moneyLine);
    } else {
      issues.push({
        field: "amounts",
        reason: "A monetary line could not be associated with a company row",
      });
    }
  }

  const matchedRows = rows.filter(
    (row) => row.shareLines.length > 0 || row.amountLines.length > 0,
  );

  if (!matchedRows.length) {
    issues.push({
      field: "company",
      reason: "No company/share rows could be identified",
    });
  }

  return {
    rows: matchedRows.map((row) => ({
      company: row.company,
      companyConfidence: row.companyConfidence,
      shares: row.shareLines.length === 1 ? row.shareLines[0].shares : null,
      sharesConfidence:
        row.shareLines.length === 1 ? row.shareLines[0].confidence : 0,
      amountLines: row.amountLines.sort((a, b) => a.centerY - b.centerY),
    })),
    issues,
  };
};
