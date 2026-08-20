const { parentPort, workerData } = require('worker_threads');
const bcrypt = require('bcryptjs');

const OTP_SALT_ROUNDS = 10;

try {
  const { operation, code, hash } = workerData;
  const result = operation === 'hash' ? bcrypt.hashSync(code, OTP_SALT_ROUNDS) : bcrypt.compareSync(code, hash);
  parentPort.postMessage({ result });
} catch (err) {
  parentPort.postMessage({ error: err.message });
}
