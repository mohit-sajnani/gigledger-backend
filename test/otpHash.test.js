const test = require('node:test');
const assert = require('node:assert/strict');
const { hashOtpCode, compareOtpCode } = require('../src/utils/otpHash');

test('hashOtpCode produces a hash that compareOtpCode verifies as matching', async () => {
  const hash = await hashOtpCode('123456');
  assert.equal(await compareOtpCode('123456', hash), true);
});

test('compareOtpCode returns false for a non-matching code', async () => {
  const hash = await hashOtpCode('123456');
  assert.equal(await compareOtpCode('000000', hash), false);
});

test('compareOtpCode resolves false (not a hang or throw) for a malformed hash', async () => {
  assert.equal(await compareOtpCode('123456', 'not-a-real-bcrypt-hash'), false);
});
