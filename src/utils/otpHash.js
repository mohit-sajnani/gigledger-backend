const path = require('path');
const { Worker } = require('worker_threads');

const WORKER_PATH = path.join(__dirname, 'otpHash.worker.js');

/**
 * bcryptjs is pure JS — even its "async" API runs the hash/compare work on
 * the main thread, just yielding between rounds. That's fine at low volume,
 * but stalls every other in-flight request under concurrent OTP traffic.
 * Running it in a worker thread keeps the hashing off the event loop
 * entirely, at the cost of one Worker spin-up per call.
 */
const runInWorker = (workerData) =>
  new Promise((resolve, reject) => {
    const worker = new Worker(WORKER_PATH, { workerData });

    worker.once('message', ({ result, error }) => {
      if (error) reject(new Error(error));
      else resolve(result);
    });
    worker.once('error', reject);
    worker.once('exit', (code) => {
      if (code !== 0) reject(new Error(`otpHash worker stopped with exit code ${code}`));
    });
  });

const hashOtpCode = (code) => runInWorker({ operation: 'hash', code });

const compareOtpCode = (code, hash) => runInWorker({ operation: 'compare', code, hash });

module.exports = { hashOtpCode, compareOtpCode };
