const { AMOUNT_FORMAT } = require("./portfolio-amount.lib");

const MIN_CONFIDENCE = 65;

class PortfolioExtractionError extends Error {
  constructor(message, details, statusCode = 422) {
    super(message);
    this.name = "PortfolioExtractionError";
    this.statusCode = statusCode;
    this.details = details;
  }
}

function validateRows(rows, layoutIssues = []) {
  const issues = [...layoutIssues];
  const seenCompanies = new Set();
  const data = [];

  rows.forEach((row, index) => {
    const rowNumber = index + 1;
    const rowIssues = [];
    const company = String(row.company || "").trim();

    if (!company || row.companyConfidence < MIN_CONFIDENCE) {
      rowIssues.push({
        field: "company",
        reason: !company
          ? "Company name was not detected"
          : "Company name OCR confidence is below the accepted threshold",
      });
    }

    const companyKey = company.toLocaleLowerCase();
    if (company && seenCompanies.has(companyKey)) {
      rowIssues.push({
        field: "company",
        reason: "Company name is duplicated",
      });
    }
    if (company) {
      seenCompanies.add(companyKey);
    }

    if (!Number.isInteger(row.shares) || row.shares <= 0) {
      rowIssues.push({
        field: "shares",
        reason: "Share quantity is missing or invalid",
      });
    } else if (row.sharesConfidence < MIN_CONFIDENCE) {
      rowIssues.push({
        field: "shares",
        reason: "Share quantity OCR confidence is below the accepted threshold",
      });
    }

    if (row.amountLines.length !== 2) {
      rowIssues.push({
        field: "amounts",
        reason: `Expected exactly two amount lines, found ${row.amountLines.length}`,
      });
    }

    const values = [];
    for (const [amountIndex, amount] of row.amounts.entries()) {
      const field = amountIndex === 0 ? "currentValue" : "referenceValue";

      if (
        amount.value === null ||
        !AMOUNT_FORMAT.test(amount.text.replace(/\s/g, "")) ||
        amount.confidence < MIN_CONFIDENCE
      ) {
        rowIssues.push({
          field,
          reason:
            amount.reason ||
            "Amount is invalid or OCR confidence is below the accepted threshold",
          observed: amount.text,
          layoutText: amount.layoutText,
          confidence: amount.confidence,
        });
      } else {
        values.push(amount.value);
      }
    }

    if (rowIssues.length) {
      issues.push({ row: rowNumber, company: company || null, fields: rowIssues });
      return;
    }

    data.push({
      company,
      shares: row.shares,
      currentValue: values[0],
      referenceValue: values[1],
    });
  });

  if (issues.length || !data.length) {
    throw new PortfolioExtractionError(
      "Portfolio extraction is uncertain; no validated result was returned",
      {
        rows: issues,
        expectedRows: rows.length,
        validatedRows: data.length,
      },
    );
  }



  return data;
}

module.exports = {
  MIN_CONFIDENCE,
  PortfolioExtractionError,
  validateRows,
};
