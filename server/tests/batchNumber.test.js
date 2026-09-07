const test = require('node:test');
const assert = require('node:assert/strict');

const { isValidBatchNumber } = require('../controllers/controllerUtils');

test('accepts exactly six numeric batch numbers', () => {
  assert.equal(isValidBatchNumber('123456'), true);
  assert.equal(isValidBatchNumber('000000'), true);
});

test('rejects non-numeric or wrong-length batch numbers', () => {
  assert.equal(isValidBatchNumber('12345'), false);
  assert.equal(isValidBatchNumber('1234567'), false);
  assert.equal(isValidBatchNumber('12A456'), false);
  assert.equal(isValidBatchNumber(''), false);
});
