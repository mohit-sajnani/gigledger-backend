const path = require('path');
const { Worker } = require('worker_threads');

const WORKER_PATH = path.join(__dirname, 'otpHash.worker.js');
const MAX_CONCURRENT_WORKERS = 4;

/**
 * bcryptjs is pure JS — even its "async" API runs the hash/compare work on
 * the main thread, just yielding between rounds. That's fine at low volume,
 * but stalls every other in-flight request under concurrent OTP traffic.
 * Running it in a worker thread keeps the hashing off the event loop.
 *
 * Each call still gets its own short-lived worker (simplest to reason about,
 * and it exits cleanly on its own — no persistent-worker lifecycle to
 * manage), but only MAX_CONCURRENT_WORKERS may run at once. Spawning was
 * previously unbounded, which meant the already-unthrottled /register and
 * /resend-otp endpoints could be flooded to open unlimited OS threads —
 * this queue caps that regardless of request volume.
 */
let activeCount = 0;
const queue = [];

const runNext = () => {
  if (activeCount >= MAX_CONCURRENT_WORKERS || queue.length === 0) return;

  const { workerData, resolve, reject } = queue.shift();
  activeCount += 1;

  const worker = new Worker(WORKER_PATH, { workerData });
  let settled = false;
  const finish = (fn, value) => {
    if (settled) return;
    settled = true;
    activeCount -= 1;
    fn(value);
    runNext();
  };

  worker.once('message', ({ result, error }) => {
    if (error) finish(reject, new Error(error));
    else finish(resolve, result);
  });
  worker.once('error', (err) => finish(reject, err));
  worker.once('exit', (code) => {
    if (code !== 0) finish(reject, new Error(`otpHash worker stopped with exit code ${code}`));
  });
};

const runInWorker = (workerData) =>
  new Promise((resolve, reject) => {
    queue.push({ workerData, resolve, reject });
    runNext();
  });

const hashOtpCode = (code) => runInWorker({ operation: 'hash', code });

const compareOtpCode = (code, hash) => runInWorker({ operation: 'compare', code, hash });

module.exports = { hashOtpCode, compareOtpCode };
