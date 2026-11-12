const Tesseract = require("tesseract.js");
const preprocessImage = require("./image.lib");
const detectPortfolioLayout = require("./portfolio-layout.lib");
const { recognizeAmount } = require("./portfolio-amount.lib");
const {
  PortfolioExtractionError,
  validateRows,
} = require("./portfolio-validation.lib");

module.exports = class TesseractEngine {
  async runner(imageBuffer) {
    let image;
    try {
      image = await preprocessImage(imageBuffer);
    } catch (error) {
      if (error instanceof TypeError || error.name === "InputError") {
        error.statusCode = 400;
      }
      throw error;
    }

    const worker = await Tesseract.createWorker("eng");

    try {
      await worker.setParameters({
        tessedit_pageseg_mode: "11",
        preserve_interword_spaces: "1",
      });

      const { data } = await worker.recognize(
        image.buffer,
        {},
        { blocks: true },
      );
      const { rows, issues: layoutIssues } = detectPortfolioLayout(
        data.blocks,
        image,
      );

      for (const row of rows) {
        row.amounts = [];

        for (const amountLine of row.amountLines) {
          if (amountLine.words.length !== 1) {
            row.amounts.push({
              value: null,
              text: amountLine.words.map((word) => word.text).join(" "),
              confidence: amountLine.confidence,
              reason: "Multiple monetary tokens were detected in one amount line",
            });
            continue;
          }

          row.amounts.push(
            await recognizeAmount(worker, image, amountLine.words[0]),
          );
        }
      }

      return validateRows(rows, layoutIssues);
    } catch (error) {
      if (error instanceof PortfolioExtractionError) {
        throw error;
      }

      throw new Error(`OCR processing failed: ${error.message}`, {
        cause: error,
      });
    } finally {
      await worker.terminate();
    }
  }
};
