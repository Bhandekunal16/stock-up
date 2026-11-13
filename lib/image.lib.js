const { sharp } = require("../provider/dependency.map");
const {
  invalidImage,
  invalidFile,
  invalidDamnation,
  invalidData,
  notDecodable,
  imageTypes,
  MAX_IMAGE_DIMENSION,
  MAX_IMAGE_PIXELS,
} = require("../provider/config.map");
const ACCEPTED_FORMATS = new Set(imageTypes);

class InvalidImageError extends TypeError {
  constructor(message, cause) {
    super(message, { cause });
    this.name = "InvalidImageError";
    this.statusCode = 400;
  }
}

module.exports = async function preprocessImage(imageBuffer) {
  if (!Buffer.isBuffer(imageBuffer) || !imageBuffer.length)
    throw new TypeError(invalidFile);

  const source = sharp(imageBuffer, { limitInputPixels: MAX_IMAGE_PIXELS });
  let metadata;
  try {
    metadata = await source.metadata();
  } catch (e) {
    throw new InvalidImageError(invalidImage, e);
  }

  if (!ACCEPTED_FORMATS.has(metadata.format)) throw new TypeError(invalidFile);
  if (!metadata.width || !metadata.height)
    throw new TypeError(invalidDamnation);

  const normalized = sharp(imageBuffer, { limitInputPixels: MAX_IMAGE_PIXELS })
    .rotate()
    .resize({
      width: MAX_IMAGE_DIMENSION,
      height: MAX_IMAGE_DIMENSION,
      fit: "inside",
      withoutEnlargement: true,
    })
    .flatten({ background: "#000000" })
    .grayscale()
    .median(3)
    .normalize()
    .sharpen({ sigma: 0.8, m1: 0.5, m2: 1 });

  let grayscaleResult, buffer;

  try {
    [grayscaleResult, buffer] = await Promise.all([
      normalized.clone().raw().toBuffer({ resolveWithObject: true }),
      normalized.png().toBuffer(),
    ]);
  } catch (e) {
    throw new InvalidImageError(notDecodable, e.message);
  }

  const { data: grayscale, info } = grayscaleResult;
  const { width, height, channels } = info;
  if (!width || !height || channels !== 1) throw new Error(invalidData);
  return { buffer, grayscale, width, height };
};
