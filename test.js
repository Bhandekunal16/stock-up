// test.js
// Reads a screener.in company page as a stream (chunk by chunk), parses the
// key ratios, and can poll to produce a continuous stream of price records.
//
// Usage:
//   node test.js                          one-shot: stream the body, print parsed data
//   node test.js --watch                  poll every 60s, print one JSON line per poll
//   node test.js --watch --every 30       poll every 30s
//   node test.js --url https://www.screener.in/company/TATAGOLD/
//
// Requires Node 18+ (built-in fetch). No npm packages needed.

const DEFAULT_URL = "https://www.screener.in/company/TATAGOLD/consolidated/";

const args = process.argv.slice(2);
const getArg = (name, fallback) => {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
};

const TARGET_URL = process.env.TARGET_URL || getArg("--url", DEFAULT_URL);
const WATCH = args.includes("--watch");
const EVERY_SEC = Math.max(5, Number(getArg("--every", 60))); // don't hammer the site

// ---------- 1. stream the response body ----------

// Turns response.body (a ReadableStream of bytes) into an async stream of text.
async function* streamText(response) {
  const decoder = new TextDecoder("utf-8");
  for await (const chunk of response.body) {
    yield decoder.decode(chunk, { stream: true }); // stream:true keeps split characters intact
  }
  const rest = decoder.decode();
  if (rest) yield rest;
}

async function fetchPage(url, onChunk) {
  const res = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 (portfolio-stream/1.0)",
      accept: "text/html",
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);

  let html = "";
  let chunks = 0;
  for await (const text of streamText(res)) {
    html += text;
    chunks++;
    if (onChunk) onChunk(text, chunks);
  }
  return { html, chunks };
}

// ---------- 2. parse the page ----------

const toNumber = (s) => {
  const n = parseFloat(String(s).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
};

const stripTags = (s) => s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

// Reads the <ul id="top-ratios"> list: Market Cap, Current Price, High / Low, Stock P/E ...
function parseRatios(html) {
  const block = html.match(/<ul[^>]*id="top-ratios"[^>]*>([\s\S]*?)<\/ul>/);
  const out = {};
  if (!block) return out;

  for (const [, li] of block[1].matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)) {
    const nameHtml = li.match(/<span class="name">([\s\S]*?)<\/span>/);
    if (!nameHtml) continue;
    const name = stripTags(nameHtml[1]);
    const numbers = [...li.matchAll(/<span class="number">([^<]*)<\/span>/g)].map((m) =>
      toNumber(m[1])
    );
    out[name] = numbers.length > 1 ? numbers : numbers[0] ?? null; // "High / Low" has two numbers
  }
  return out;
}

function toSnapshot(html) {
  const ratios = parseRatios(html);
  const title = html.match(/<h1[^>]*>([^<]*)<\/h1>/);
  const [high, low] = Array.isArray(ratios["High / Low"]) ? ratios["High / Low"] : [null, null];
  return {
    time: new Date().toISOString(),
    company: title ? title[1].trim() : null,
    price: ratios["Current Price"] ?? null,
    marketCap: ratios["Market Cap"] ?? null,
    stockPE: ratios["Stock P/E"] ?? null,
    high,
    low,
    ratios,
  };
}

// ---------- 3. continuous stream of records ----------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Async generator: yields one record per poll, forever.
async function* priceStream(url, everySec) {
  let lastKey = null;
  while (true) {
    try {
      const { html } = await fetchPage(url);
      const snap = toSnapshot(html);
      const key = JSON.stringify([snap.price, snap.marketCap, snap.stockPE]);
      yield { ...snap, changed: key !== lastKey };
      lastKey = key;
    } catch (err) {
      yield { time: new Date().toISOString(), error: err.message };
    }
    await sleep(everySec * 1000);
  }
}

// ---------- main ----------

async function main() {
  if (!WATCH) {
    console.log(`Streaming ${TARGET_URL}\n`);
    const { html, chunks } = await fetchPage(TARGET_URL, (text, n) =>
      console.log(`chunk ${n}: ${text.length} chars`)
    );
    console.log(`\nDone: ${chunks} chunks, ${html.length} chars total\n`);
    const snap = toSnapshot(html);
    delete snap.ratios.undefined;
    console.log(JSON.stringify(snap, null, 2));
    if (snap.price === null) {
      console.log("\nNo price found. The page layout may have changed or the request was blocked.");
    }
    return;
  }

  console.error(`Watching ${TARGET_URL} every ${EVERY_SEC}s (Ctrl+C to stop)`);
  for await (const record of priceStream(TARGET_URL, EVERY_SEC)) {
    console.log(JSON.stringify(record)); // one JSON object per line (NDJSON)
    // Put your own sink here, e.g. insert `record` into MongoDB.
  }
}

process.on("SIGINT", () => process.exit(0));
main().catch((err) => {
  console.error("Failed:", err.message);
  process.exit(1);
});