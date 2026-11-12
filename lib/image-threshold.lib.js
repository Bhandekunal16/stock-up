function otsuThreshold(pixels) {
  const histogram = new Uint32Array(256);
  for (const pixel of pixels) {
    histogram[pixel] += 1;
  }

  const total = pixels.length;
  let totalIntensity = 0;
  let background = 0;
  for (let value = 0; value < histogram.length; value += 1) {
    totalIntensity += value * histogram[value];
    if (histogram[value] > histogram[background]) {
      background = value;
    }
  }

  let backgroundWeight = 0;
  let backgroundIntensity = 0;
  let bestVariance = -1;
  let threshold = 0;

  for (let value = 0; value < histogram.length; value += 1) {
    backgroundWeight += histogram[value];
    if (!backgroundWeight) {
      continue;
    }

    const foregroundWeight = total - backgroundWeight;
    if (!foregroundWeight) {
      break;
    }

    backgroundIntensity += value * histogram[value];
    const backgroundMean = backgroundIntensity / backgroundWeight;
    const foregroundMean =
      (totalIntensity - backgroundIntensity) / foregroundWeight;
    const variance =
      backgroundWeight *
      foregroundWeight *
      (backgroundMean - foregroundMean) ** 2;

    if (variance > bestVariance) {
      bestVariance = variance;
      threshold = value;
    }
  }

  return { threshold, background };
}

module.exports = otsuThreshold;
