const http = require("http");

const CONFIG = {
  host: "0.0.0.0",
  port: 8000,
  path: "/",
  totalRequests: 100000,
  concurrency: 1000,
  timeout: 10000,
  progressEvery: 1000,
};

let completed = 0;
let successful = 0;
let failed = 0;
let totalLatency = 0;
let minLatency = Infinity;
let maxLatency = 0;

const statusCodes = new Map();

const latencySamples = [];

const startTime = process.hrtime.bigint();

function nowMs() {
  return Number(process.hrtime.bigint() - startTime) / 1_000_000;
}

function recordStatus(statusCode) {
  statusCodes.set(statusCode, (statusCodes.get(statusCode) || 0) + 1);
}

function makeRequest() {
  return new Promise((resolve) => {
    const requestStart = process.hrtime.bigint();

    const req = http.request(
      {
        hostname: CONFIG.host,
        port: CONFIG.port,
        path: CONFIG.path,
        method: "GET",
        headers: {
          Connection: "keep-alive",
        },
      },
      (res) => {
        res.resume();

        res.on("end", () => {
          const latency =
            Number(process.hrtime.bigint() - requestStart) / 1_000_000;

          totalLatency += latency;
          minLatency = Math.min(minLatency, latency);
          maxLatency = Math.max(maxLatency, latency);

          latencySamples.push(latency);

          recordStatus(res.statusCode);

          if (res.statusCode >= 200 && res.statusCode < 400) {
            successful++;
          } else {
            failed++;
          }

          completed++;

          resolve();
        });
      },
    );

    req.setTimeout(CONFIG.timeout, () => {
      req.destroy(new Error("Request timeout"));
    });

    req.on("error", () => {
      failed++;
      completed++;

      resolve();
    });

    req.end();
  });
}

function percentile(values, percentile) {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);

  const index = Math.ceil((percentile / 100) * sorted.length) - 1;

  return sorted[Math.max(0, index)];
}

async function worker() {
  while (true) {
    const requestNumber = completed + activeWorkers;

    if (requestNumber >= CONFIG.totalRequests) {
      return;
    }

    activeWorkers++;

    await makeRequest();

    activeWorkers--;

    if (completed > 0 && completed % CONFIG.progressEvery === 0) {
      const elapsed = nowMs() / 1000;

      console.log(
        `Progress: ${completed}/${CONFIG.totalRequests} | ` +
          `RPS: ${(completed / elapsed).toFixed(2)}`,
      );
    }
  }
}

let activeWorkers = 0;

async function run() {
  console.log("");
  console.log("======================================");
  console.log("        Node.js Load Test");
  console.log("======================================");
  console.log(
    `Target       : http://${CONFIG.host}:${CONFIG.port}${CONFIG.path}`,
  );
  console.log(`Requests     : ${CONFIG.totalRequests}`);
  console.log(`Concurrency  : ${CONFIG.concurrency}`);
  console.log(`Timeout      : ${CONFIG.timeout} ms`);
  console.log("======================================");
  console.log("");

  const workers = [];

  for (let i = 0; i < CONFIG.concurrency; i++) {
    workers.push(worker());
  }

  await Promise.all(workers);

  const elapsedMs = nowMs();
  const elapsedSeconds = elapsedMs / 1000;

  const requestsPerSecond = completed / elapsedSeconds;

  const averageLatency = completed > 0 ? totalLatency / completed : 0;

  console.log("");
  console.log("======================================");
  console.log("             TEST RESULT");
  console.log("======================================");

  console.log(`Duration       : ${elapsedSeconds.toFixed(2)} sec`);

  console.log(`Completed      : ${completed}`);

  console.log(`Successful     : ${successful}`);

  console.log(`Failed         : ${failed}`);

  console.log(`Requests/sec   : ${requestsPerSecond.toFixed(2)}`);

  console.log(`Average latency: ${averageLatency.toFixed(2)} ms`);

  console.log(
    `Min latency    : ${
      minLatency === Infinity ? "N/A" : minLatency.toFixed(2)
    } ms`,
  );

  console.log(`Max latency    : ${maxLatency.toFixed(2)} ms`);

  console.log("");
  console.log("Latency percentiles:");

  console.log(
    `P50            : ${percentile(latencySamples, 50).toFixed(2)} ms`,
  );

  console.log(
    `P90            : ${percentile(latencySamples, 90).toFixed(2)} ms`,
  );

  console.log(
    `P95            : ${percentile(latencySamples, 95).toFixed(2)} ms`,
  );

  console.log(
    `P99            : ${percentile(latencySamples, 99).toFixed(2)} ms`,
  );

  console.log("");
  console.log("Status codes:");

  for (const [status, count] of statusCodes) {
    console.log(`  ${status}: ${count}`);
  }

  console.log("======================================");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
