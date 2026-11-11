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
    select: () => ({ lean: async () => null }),
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

test('login returns an explicit service-unavailable response when its audit event cannot be persisted', async (t) => {
  const bcrypt = require('bcryptjs');
  const jwt = require('jsonwebtoken');
  const User = require('../models/User');
  const auditService = require('../services/auditService');
  const user = {
    _id: 'user-audit-failure',
    username: 'audit-failure-user',
    email: 'audit-failure@example.test',
    role: 'system_admin',
    status: 'approved',
    isActive: true,
    passwordHash: 'stored-password-hash',
  };

  t.mock.method(bcrypt, 'compare', async () => true);
  t.mock.method(User, 'findOne', async () => user);
  t.mock.method(jwt, 'sign', () => 'should-not-be-returned');
  t.mock.method(auditService, 'log', async () => {
    throw new Error('simulated audit failure');
  });

  const res = createResponse();
  await login(
    createRequest({ body: { username: user.username, password: 'correct-password' } }),
    res,
  );

  assert.equal(res.statusCode, 503);
  assert.equal(res.body.error, 'AUDIT_LOGGING_FAILED');
});

test('resetPassword rolls back the password and reset-token state when audit persistence fails', async (t) => {
  const User = require('../models/User');
  const auditService = require('../services/auditService');
  const originalPasswordHash = 'old-password-hash';
  const originalResetToken = 'old-reset-token-hash';
  const originalResetExpiry = new Date(Date.now() + 60_000);
  const user = {
    _id: 'reset-audit-failure',
    role: 'system_admin',
    isActive: true,
    status: 'approved',
    passwordHash: originalPasswordHash,
    passwordResetToken: originalResetToken,
    passwordResetExpires: originalResetExpiry,
    save: async () => {},
  };
  const saveCalls = [];
  user.save = async () => {
    saveCalls.push({
      passwordHash: user.passwordHash,
      passwordResetToken: user.passwordResetToken,
      passwordResetExpires: user.passwordResetExpires,
    });
  };

  t.mock.method(User, 'findOne', () => ({
    select: async () => user,
  }));
  t.mock.method(User, 'updateOne', async (_filter, update) => {
    if (update.$set?.passwordHash) user.passwordHash = update.$set.passwordHash;
    if (update.$set?.passwordResetToken) user.passwordResetToken = update.$set.passwordResetToken;
    if (update.$set?.passwordResetExpires) user.passwordResetExpires = update.$set.passwordResetExpires;
    if (update.$unset?.passwordResetToken) user.passwordResetToken = undefined;
    if (update.$unset?.passwordResetExpires) user.passwordResetExpires = undefined;
    return { matchedCount: 1 };
  });
  t.mock.method(auditService, 'isTransactionCapableTopology', async () => false);
  t.mock.method(auditService, 'log', async () => {
    throw new Error('simulated audit failure');
  });

  const res = createResponse();
  await resetPassword(
    createRequest({
      params: { token: 'valid-reset-token' },
      body: { password: 'new-password', confirmPassword: 'new-password' },
    }),
    res,
  );

  assert.equal(res.statusCode, 503);
  assert.equal(res.body.error, 'AUDIT_LOGGING_FAILED');
  assert.equal(user.passwordHash, originalPasswordHash);
  assert.equal(user.passwordResetToken, originalResetToken);
  assert.equal(user.passwordResetExpires, originalResetExpiry);
  assert.equal(saveCalls.length, 0);
});

test('resetPassword allows only one concurrent request to consume a reset token', async (t) => {
  const User = require('../models/User');
  const auditService = require('../services/auditService');
  const user = {
    _id: new (require('mongoose').Types.ObjectId)(),
    role: 'system_admin',
    isActive: true,
    status: 'approved',
    passwordHash: 'old-password-hash',
    passwordResetToken: require('crypto').createHash('sha256').update('one-time-token').digest('hex'),
    passwordResetExpires: new Date(Date.now() + 60_000),
  };
  let updateCount = 0;
  t.mock.method(User, 'findOne', () => ({
    select: async () => ({ ...user }),
  }));
  t.mock.method(User, 'updateOne', async () => {
    updateCount += 1;
    return { matchedCount: updateCount === 1 ? 1 : 0 };
  });
  t.mock.method(auditService, 'isTransactionCapableTopology', async () => false);
  t.mock.method(auditService, 'log', async () => undefined);

  const makeRequest = () => createRequest({
    params: { token: 'one-time-token' },
    body: { password: 'new-password', confirmPassword: 'new-password' },
  });
  const [first, second] = await Promise.all([
    resetPassword(makeRequest(), createResponse()),
    resetPassword(makeRequest(), createResponse()),
  ]);

  assert.deepEqual([first.statusCode, second.statusCode].sort(), [200, 400]);
  assert.equal(updateCount, 2);
});

test('standalone reset rollback does not overwrite a newer account update', async (t) => {
  const User = require('../models/User');
  const auditService = require('../services/auditService');
  const originalPasswordHash = 'old-password-hash';
  const user = {
    _id: new (require('mongoose').Types.ObjectId)(),
    role: 'system_admin',
    isActive: true,
    status: 'approved',
    passwordHash: originalPasswordHash,
    passwordResetToken: require('crypto').createHash('sha256').update('concurrent-token').digest('hex'),
    passwordResetExpires: new Date(Date.now() + 60_000),
  };
  let updateCount = 0;
  t.mock.method(User, 'findOne', () => ({
    select: async () => ({ ...user }),
  }));
  t.mock.method(User, 'updateOne', async (_filter, update) => {
    updateCount += 1;
    if (updateCount === 1) {
      user.passwordHash = update.$set.passwordHash;
      user.passwordResetToken = undefined;
      user.passwordResetExpires = undefined;
      return { matchedCount: 1 };
    }
    user.passwordHash = 'newer-password-hash';
    return { matchedCount: 0 };
  });
  t.mock.method(auditService, 'isTransactionCapableTopology', async () => false);
  t.mock.method(auditService, 'log', async () => {
    throw new Error('simulated audit failure');
  });

  const res = createResponse();
  await resetPassword(
    createRequest({
      params: { token: 'concurrent-token' },
      body: { password: 'new-password', confirmPassword: 'new-password' },
    }),
    res,
  );

  assert.equal(res.statusCode, 503);
  assert.equal(user.passwordHash, 'newer-password-hash');
  assert.equal(updateCount, 2);
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
