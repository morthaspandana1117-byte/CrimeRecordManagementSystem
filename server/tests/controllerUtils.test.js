const test = require('node:test');
const assert = require('node:assert/strict');

const {
  isValidObjectId,
  isNonEmptyString,
  isValidDate,
  invalid,
  notFound,
  conflict,
  validateObjectId,
  validateReference,
  validateReferences,
  handleError,
} = require('../controllers/controllerUtils');

const createResponseMock = () => {
  const res = {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };

  return res;
};

test('isValidObjectId accepts valid IDs and rejects invalid IDs', () => {
  assert.equal(isValidObjectId('507f1f77bcf86cd799439011'), true);
  assert.equal(isValidObjectId('invalid-id'), false);
});

test('isNonEmptyString rejects empty and non-string values', () => {
  assert.equal(isNonEmptyString('Crime record'), true);
  assert.equal(isNonEmptyString('   '), false);
  assert.equal(isNonEmptyString(''), false);
  assert.equal(isNonEmptyString(null), false);
});

test('isValidDate accepts valid dates and rejects invalid dates', () => {
  assert.equal(Boolean(isValidDate('2026-09-10')), true);
  assert.equal(Boolean(isValidDate('not-a-date')), false);
  assert.equal(Boolean(isValidDate(null)), false);
});

test('invalid returns a 400 response with the expected error payload', () => {
  const res = createResponseMock();

  invalid(res, 'Invalid input', 'INVALID_INPUT');

  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, {
    success: false,
    message: 'Invalid input',
    error: 'INVALID_INPUT',
  });
});

test('notFound returns a 404 response for a missing resource', () => {
  const res = createResponseMock();

  notFound(res, 'criminal record');

  assert.equal(res.statusCode, 404);
  assert.deepEqual(res.body, {
    success: false,
    message: 'criminal record not found',
    error: 'CRIMINAL_RECORD_NOT_FOUND',
  });
});

test('conflict returns a 409 response with the expected payload', () => {
  const res = createResponseMock();

  conflict(res, 'Duplicate record');

  assert.equal(res.statusCode, 409);
  assert.deepEqual(res.body, {
    success: false,
    message: 'Duplicate record',
    error: 'DUPLICATE_RECORD',
  });
});

test('validateObjectId reports invalid IDs and accepts valid IDs', () => {
  const invalidRes = createResponseMock();
  const validRes = createResponseMock();

  assert.equal(validateObjectId(invalidRes, 'bad-id', 'criminalId'), false);
  assert.equal(invalidRes.statusCode, 400);
  assert.equal(invalidRes.body.error, 'INVALID_CRIMINALID');

  assert.equal(
    validateObjectId(validRes, '507f1f77bcf86cd799439011', 'criminalId'),
    true,
  );
  assert.equal(validRes.statusCode, null);
});

test('validateReference handles invalid, missing, and existing references', async () => {
  const invalidRes = createResponseMock();
  const missingRes = createResponseMock();
  const existingRes = createResponseMock();

  const Model = {
    async exists() {
      return { _id: '507f1f77bcf86cd799439011' };
    },
  };

  assert.equal(
    await validateReference(invalidRes, Model, 'bad-id', 'caseId'),
    false,
  );
  assert.equal(invalidRes.statusCode, 400);

  assert.equal(
    await validateReference(
      missingRes,
      { async exists() { return null; } },
      '507f1f77bcf86cd799439011',
      'caseId',
    ),
    false,
  );
  assert.equal(missingRes.statusCode, 404);

  assert.equal(
    await validateReference(
      existingRes,
      Model,
      '507f1f77bcf86cd799439011',
      'caseId',
    ),
    true,
  );
  assert.equal(existingRes.statusCode, null);
});

test('validateReferences rejects empty arrays, duplicates, and invalid IDs', async () => {
  const emptyRes = createResponseMock();
  const duplicateRes = createResponseMock();
  const invalidRes = createResponseMock();

  const Model = {
    async countDocuments() {
      return 2;
    },
  };

  assert.equal(await validateReferences(emptyRes, Model, [], 'officerIds'), false);
  assert.equal(emptyRes.statusCode, 400);

  assert.equal(
    await validateReferences(
      duplicateRes,
      Model,
      [
        '507f1f77bcf86cd799439011',
        '507f1f77bcf86cd799439011',
      ],
      'officerIds',
    ),
    false,
  );
  assert.equal(duplicateRes.statusCode, 400);

  assert.equal(
    await validateReferences(invalidRes, Model, ['bad-id'], 'officerIds'),
    false,
  );
  assert.equal(invalidRes.statusCode, 400);
});

test('validateReferences rejects missing records and accepts existing references', async () => {
  const missingRes = createResponseMock();
  const existingRes = createResponseMock();

  const ids = [
    '507f1f77bcf86cd799439011',
    '507f1f77bcf86cd799439012',
  ];

  assert.equal(
    await validateReferences(
      missingRes,
      { async countDocuments() { return 1; } },
      ids,
      'officerIds',
    ),
    false,
  );
  assert.equal(missingRes.statusCode, 400);
  assert.equal(missingRes.body.error, 'INVALID_OFFICERIDS_REFERENCE');

  assert.equal(
    await validateReferences(
      existingRes,
      { async countDocuments() { return 2; } },
      ids,
      'officerIds',
    ),
    true,
  );
  assert.equal(existingRes.statusCode, null);
});

test('handleError maps duplicate criminal IDs to a 409 response', () => {
  const res = createResponseMock();
  const originalError = console.error;
  console.error = () => {};

  try {
    handleError(
      res,
      { code: 11000, message: 'duplicate key criminalId' },
      'Test',
    );
  } finally {
    console.error = originalError;
  }

  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error, 'CRIMINAL_ID_ALREADY_EXISTS');
});

test('handleError maps other duplicate keys to a 409 response', () => {
  const res = createResponseMock();
  const originalError = console.error;
  console.error = () => {};

  try {
    handleError(
      res,
      { code: 11000, message: 'duplicate key email' },
      'Test',
    );
  } finally {
    console.error = originalError;
  }

  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error, 'DUPLICATE_RECORD');
});

test('handleError maps Mongoose validation and cast errors to 400', () => {
  for (const name of ['ValidationError', 'CastError']) {
    const res = createResponseMock();
    const originalError = console.error;
    console.error = () => {};

    try {
      handleError(res, { name, message: 'Invalid field value' }, 'Test');
    } finally {
      console.error = originalError;
    }

    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, 'VALIDATION_ERROR');
  }
});

test('handleError maps unexpected errors to a generic 500 response', () => {
  const res = createResponseMock();
  const originalError = console.error;
  console.error = () => {};

  try {
    handleError(res, new Error('Sensitive internal details'), 'Test');
  } finally {
    console.error = originalError;
  }

  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.body, {
    success: false,
    message: 'Server error',
    error: 'SERVER_ERROR',
  });
});