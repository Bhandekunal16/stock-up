const { sharp } = require("../provider/dependency.map");
const [MAX_IMAGE_DIMENSION, ACCEPTED_FORMATS, MAX_IMAGE_PIXELS] = [
  2400,
  new Set(["jpeg", "png", "webp"]),
  20_000_000,
];

class InvalidImageError extends TypeError {
  constructor(message, cause) {
    super(message, { cause });
    this.name = "InvalidImageError";
    this.statusCode = 400;
  }
}

module.exports = async function preprocessImage(imageBuffer) {
  if (!Buffer.isBuffer(imageBuffer) || !imageBuffer.length)
    throw new TypeError("A valid image buffer is required");

  const source = sharp(imageBuffer, { limitInputPixels: MAX_IMAGE_PIXELS });
  let metadata;
  try {
    metadata = await source.metadata();
  } catch (error) {
    throw new InvalidImageError("Uploaded file is not a valid image", error);
  }

  if (!ACCEPTED_FORMATS.has(metadata.format))
    throw new TypeError("Only JPEG, PNG, and WebP images are supported");

  if (!metadata.width || !metadata.height)
    throw new TypeError("Invalid image dimensions");

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
    throw new InvalidImageError("Uploaded image could not be decoded", e);
  }

  const { data: grayscale, info } = grayscaleResult;
  const { width, height, channels } = info;

  if (!width || !height || channels !== 1)
    throw new Error("Image normalization produced invalid pixel data");

  return { buffer, grayscale, width, height };
};
