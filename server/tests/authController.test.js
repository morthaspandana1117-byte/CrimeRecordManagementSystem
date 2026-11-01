const test = require('node:test');
const assert = require('node:assert/strict');

const {
  login,
  getMe,
  forgotPassword,
  resetPassword,
} = require('../controllers/authController');

function createResponse() {
  return {
    statusCode: 200,
    body: undefined,

    status(code) {
      this.statusCode = code;
      return this;
    },

    json(data) {
      this.body = data;
      return this;
    },
  };
}

function createRequest({ body = {}, params = {}, user = {} } = {}) {
  return { body, params, user };
}

test('login returns 400 when username or password is missing', async () => {
  const res = createResponse();

  await login(createRequest({ body: { username: 'testuser' } }), res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'MISSING_CREDENTIALS');
});

test('forgotPassword returns 400 for an invalid email', async () => {
  const res = createResponse();

  await forgotPassword(
    createRequest({ body: { email: 'invalid-email' } }),
    res
  );

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'INVALID_EMAIL');
});

test('forgotPassword returns 400 when email is missing', async () => {
  const res = createResponse();

  await forgotPassword(createRequest(), res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'INVALID_EMAIL');
});

test('resetPassword returns 400 when required fields are missing', async () => {
  const res = createResponse();

  await resetPassword(
    createRequest({
      params: { token: 'sample-token' },
      body: { password: 'secure123' },
    }),
    res
  );

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'MISSING_PASSWORD');
});

test('resetPassword returns 400 when passwords do not match', async () => {
  const res = createResponse();

  await resetPassword(
    createRequest({
      params: { token: 'sample-token' },
      body: {
        password: 'secure123',
        confirmPassword: 'different123',
      },
    }),
    res
  );

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'PASSWORD_MISMATCH');
});

test('resetPassword returns 400 when password has fewer than six characters', async () => {
  const res = createResponse();

  await resetPassword(
    createRequest({
      params: { token: 'sample-token' },
      body: {
        password: '12345',
        confirmPassword: '12345',
      },
    }),
    res
  );

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'WEAK_PASSWORD');
});

test('getMe returns 404 when the user does not exist', async (t) => {
  const User = require('../models/User');
  const { mock } = require('node:test');

  mock.method(User, 'findById', () => ({
    select: async () => null,
  }));

  t.after(() => mock.restoreAll());

  const res = createResponse();

  await getMe(
    createRequest({ user: { userId: 'nonexistent-user-id' } }),
    res
  );

  assert.equal(res.statusCode, 404);
  assert.equal(res.body.error, 'USER_NOT_FOUND');
});

test('login returns 401 when the user does not exist', async (t) => {
  const { mock } = require('node:test');
  const User = require('../models/User');
  const auditService = require('../services/auditService');

  mock.method(User, 'findOne', async () => null);
  mock.method(auditService, 'log', async () => undefined);

  t.after(() => mock.restoreAll());

  const res = createResponse();

  await login(
    createRequest({
      body: { username: 'unknown-user', password: 'wrong-password' },
    }),
    res
  );

  assert.equal(res.statusCode, 401);
  assert.equal(res.body.error, 'INVALID_CREDENTIALS');
});

test('login accepts a valid password and returns a signed token', async (t) => {
  const bcrypt = require('bcryptjs');
  const jwt = require('jsonwebtoken');
  const User = require('../models/User');
  const auditService = require('../services/auditService');
  const user = {
    _id: 'user-123',
    username: 'admin-user',
    email: 'admin@example.test',
    role: 'system_admin',
    status: 'approved',
    isActive: true,
    passwordHash: 'stored-password-hash',
  };

  const compare = t.mock.method(bcrypt, 'compare', async () => true);
  const findOne = t.mock.method(User, 'findOne', async () => user);
  const sign = t.mock.method(jwt, 'sign', () => 'signed-test-token');
  t.mock.method(auditService, 'log', async () => undefined);

  const res = createResponse();
  await login(
    createRequest({ body: { username: ' admin-user ', password: 'correct-password' } }),
    res,
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.token, 'signed-test-token');
  assert.equal(res.body.user.id, user._id);
  assert.equal(res.body.user.systemRole, 'system_admin');
  assert.equal(findOne.mock.calls.length, 1);
  assert.deepEqual(compare.mock.calls[0].arguments, ['correct-password', user.passwordHash]);
  assert.equal(sign.mock.calls.length, 1);
});

test('login rejects an incorrect password without issuing a token', async (t) => {
  const bcrypt = require('bcryptjs');
  const jwt = require('jsonwebtoken');
  const User = require('../models/User');
  const auditService = require('../services/auditService');
  const user = {
    _id: 'user-456',
    username: 'admin-user',
    email: 'admin@example.test',
    role: 'system_admin',
    status: 'approved',
    isActive: true,
    passwordHash: 'stored-password-hash',
  };

  const compare = t.mock.method(bcrypt, 'compare', async () => false);
  t.mock.method(User, 'findOne', async () => user);
  const sign = t.mock.method(jwt, 'sign', () => 'should-not-be-issued');
  const auditLog = t.mock.method(auditService, 'log', async () => undefined);

  const res = createResponse();
  await login(
    createRequest({ body: { username: 'admin-user', password: 'wrong-password' } }),
    res,
  );

  assert.equal(res.statusCode, 401);
  assert.equal(res.body.error, 'INVALID_CREDENTIALS');
  assert.equal(res.body.token, undefined);
  assert.deepEqual(compare.mock.calls[0].arguments, ['wrong-password', user.passwordHash]);
  assert.equal(sign.mock.calls.length, 0);
  assert.equal(auditLog.mock.calls[0].arguments[0].action, 'LOGIN_FAILED');
});

test('resetPassword returns 400 when the reset token is invalid', async (t) => {
  const { mock } = require('node:test');
  const User = require('../models/User');

  mock.method(User, 'findOne', () => ({
    select: async () => null,
  }));

  t.after(() => mock.restoreAll());

  const res = createResponse();

  await resetPassword(
    createRequest({
      params: { token: 'invalid-reset-token' },
      body: {
        password: 'secure123',
        confirmPassword: 'secure123',
      },
    }),
    res
  );

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'INVALID_RESET_TOKEN');
});

