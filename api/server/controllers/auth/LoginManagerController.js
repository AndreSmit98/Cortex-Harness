const cookies = require('cookie');
const { CacheKeys } = require('librechat-data-provider');
const { createLoginManagerHandlers, invalidateCachedAuthUserDoc } = require('@librechat/api');

const getInternalRefreshToken = (req) => {
  const parsed = req.headers.cookie ? cookies.parse(req.headers.cookie) : {};
  return parsed.refreshToken;
};

let controller;

const getController = () => {
  if (controller) {
    return controller;
  }
  const {
    findUser,
    createUser,
    updateUser,
    getUserById,
    findSession,
    deleteSession,
  } = require('~/models');
  const { setAuthTokens } = require('~/server/services/AuthService');
  const getLogStores = require('~/cache/getLogStores');
  const loginManagerStore = getLogStores(CacheKeys.LOGIN_MANAGER_SESSION);
  const authUserCacheStore = getLogStores(CacheKeys.AUTH_USER_DOC);

  const issueAuthTokens = async (userId, req, res, reuseSession) => {
    let session = null;
    if (reuseSession) {
      const refreshToken = getInternalRefreshToken(req);
      if (refreshToken) {
        session = await findSession({ userId, refreshToken }, { lean: false });
        if (session?.expiration <= new Date()) {
          session = null;
        }
      }
    }
    return await setAuthTokens(userId, res, session, req);
  };

  const clearAuthSession = async (userId, req) => {
    const refreshToken = getInternalRefreshToken(req);
    if (!refreshToken) {
      return;
    }
    const session = await findSession({ userId, refreshToken });
    if (session?._id) {
      await deleteSession({ sessionId: session._id });
    }
  };

  controller = createLoginManagerHandlers({
    store: loginManagerStore,
    findUser: (query) => findUser(query),
    getUserById: (userId) => getUserById(userId),
    createUser: async (user) => await createUser(user, undefined, true, true),
    updateUser: (userId, update) => updateUser(userId, update),
    invalidateUserCache: async (userId) => {
      await invalidateCachedAuthUserDoc(authUserCacheStore, { userId });
    },
    issueAuthTokens,
    clearAuthSession,
  });
  return controller;
};

module.exports = {
  start: (req, res) => getController().start(req, res),
  callback: (req, res) => getController().callback(req, res),
  refresh: (req, res) => getController().refresh(req, res),
  logout: (req, res) => getController().logout(req, res),
};
