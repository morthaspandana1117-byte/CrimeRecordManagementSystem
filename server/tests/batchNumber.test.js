const test = require('node:test');
const assert = require('node:assert/strict');

const { isValidBatchNumber } = require('../controllers/controllerUtils');

test('accepts exactly six alphanumeric batch numbers', () => {
  assert.equal(isValidBatchNumber('B12445'), true);
  assert.equal(isValidBatchNumber('ABC123'), true);
  assert.equal(isValidBatchNumber('123456'), true);
});

test('rejects wrong-length or non-alphanumeric batch numbers', () => {
  assert.equal(isValidBatchNumber('12345'), false);
  assert.equal(isValidBatchNumber('1234567'), false);
  assert.equal(isValidBatchNumber('AB-1234'), false);
  assert.equal(isValidBatchNumber(''), false);
});
