const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

const {
  CLIENT_MESSAGE_NOTIFICATION_CHANNEL_ID,
} = require("../lib/clientMessageNotifications.ts");
const {
  getPushRegistrationState,
  getPushRegistrationWarning,
  resetPushRegistrationStateForTests,
} = require("../lib/pushRegistrationState.ts");
const {
  getClientMessageRouteFromData,
} = require("../lib/notificationRouting.ts");

function loadWithMocks(targetPath, mocks) {
  const originalLoad = Module._load;

  Module._load = function patchedLoad(request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(mocks, request)) {
      return mocks[request];
    }

    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    delete require.cache[require.resolve(targetPath)];
    return require(targetPath);
  } finally {
    Module._load = originalLoad;
  }
}

function createPushNotificationsHarness({
  expoPushToken = "ExponentPushToken[test-token]",
  getDevicePushTokenAsync = async () => ({
    data: "native-device-token",
    type: "android",
  }),
  getPermissionsAsync = async () => ({
    canAskAgain: true,
    granted: true,
    ios: { status: 0 },
    status: "granted",
  }),
  maybeSingle = async () => ({
    data: {
      device_id: "device-123",
      expo_push_token: expoPushToken,
      id: "row-123",
      platform: "android",
    },
    error: null,
  }),
  requestPermissionsAsync = async () => ({
    canAskAgain: true,
    granted: true,
    ios: { status: 0 },
    status: "granted",
  }),
  secureStoreGetItemAsync,
  secureStoreSetItemAsync,
} = {}) {
  let configuredHandler = null;
  let deleteMode = false;
  let deleteFilters = [];
  let deleteSelectCalled = false;
  let pushTokenListener = null;
  let removedPushTokenListener = false;
  let setNotificationChannelCalls = [];
  let upsertPayload = null;
  let upsertOptions = null;
  let upsertPayloads = [];
  let secureStoreValue =
    typeof secureStoreGetItemAsync === "function" ? undefined : "device-123";
  let secureStoreSetCalls = [];
  let emittedClientMessageCount = 0;

  const pushNotifications = loadWithMocks("../lib/pushNotifications.ts", {
    "expo-constants": {
      easConfig: { projectId: "test-project-id" },
      expoConfig: { extra: { eas: { projectId: "test-project-id" } } },
    },
    "expo-notifications": {
      AndroidImportance: { HIGH: "high" },
      IosAuthorizationStatus: { PROVISIONAL: 3 },
      addNotificationReceivedListener(listener) {
        return {
          remove() {},
        };
      },
      addNotificationResponseReceivedListener(listener) {
        return {
          remove() {},
        };
      },
      addPushTokenListener(listener) {
        pushTokenListener = listener;
        return {
          remove() {
            removedPushTokenListener = true;
          },
        };
      },
      async getDevicePushTokenAsync() {
        return getDevicePushTokenAsync();
      },
      async getExpoPushTokenAsync() {
        return { data: expoPushToken };
      },
      async getLastNotificationResponseAsync() {
        return null;
      },
      async getPermissionsAsync() {
        return getPermissionsAsync();
      },
      async requestPermissionsAsync() {
        return requestPermissionsAsync();
      },
      async setNotificationChannelAsync(channelId, channel) {
        setNotificationChannelCalls.push({ channelId, channel });
      },
      setNotificationHandler(handler) {
        configuredHandler = handler;
      },
    },
    "expo-secure-store": {
      async getItemAsync() {
        if (typeof secureStoreGetItemAsync === "function") {
          return secureStoreGetItemAsync();
        }
        return secureStoreValue;
      },
      async setItemAsync(key, value) {
        if (typeof secureStoreSetItemAsync === "function") {
          return secureStoreSetItemAsync(key, value);
        }
        secureStoreValue = value;
        secureStoreSetCalls.push({ key, value });
      },
    },
    "react-native": {
      Platform: { OS: "android" },
    },
    "./authNativeIsolation": {
      shouldSkipAuthNativeWork() {
        return false;
      },
    },
    "./clientMessageEvents": {
      emitClientMessageReceived() {
        emittedClientMessageCount += 1;
      },
    },
    "./notificationRouting": {
      getClientMessageRouteFromNotification() {
        return "/messages";
      },
      isClientMessageNotification() {
        return true;
      },
    },
    "./supabase": {
      supabase: {
        from(table) {
          assert.equal(table, "user_push_tokens");

          return {
            delete() {
              deleteMode = true;
              deleteFilters = [];
              deleteSelectCalled = false;
              return this;
            },
            eq(column, value) {
              deleteFilters.push({ operator: "eq", column, value });
              return this;
            },
            neq(column, value) {
              deleteFilters.push({ operator: "neq", column, value });
              return this;
            },
            upsert(payload, options) {
              upsertPayload = payload;
              upsertOptions = options;
              upsertPayloads.push(payload);
              return this;
            },
            select() {
              if (deleteMode) {
                deleteSelectCalled = true;
              }
              return this;
            },
            async maybeSingle() {
              deleteMode = false;
              return maybeSingle();
            },
            then(onFulfilled, onRejected) {
              deleteMode = false;
              return Promise.resolve({
                data: [],
                error: null,
              }).then(onFulfilled, onRejected);
            },
          };
        },
      },
    },
  });

  pushNotifications.resetPushNotificationsForTests();

  return {
    emittedClientMessageCount,
    getConfiguredHandler: () => configuredHandler,
    getDeleteFilters: () => deleteFilters,
    getDeleteSelectCalled: () => deleteSelectCalled,
    getEmittedClientMessageCount: () => emittedClientMessageCount,
    getPushTokenListener: () => pushTokenListener,
    getRemovedPushTokenListener: () => removedPushTokenListener,
    getSetNotificationChannelCalls: () => setNotificationChannelCalls,
    getUpsertOptions: () => upsertOptions,
    getUpsertPayload: () => upsertPayload,
    getUpsertPayloads: () => upsertPayloads,
    getSecureStoreSetCalls: () => secureStoreSetCalls,
    pushNotifications,
  };
}

test.beforeEach(() => {
  resetPushRegistrationStateForTests();
});

test("client message notifications stay visible in the foreground", async () => {
  const harness = createPushNotificationsHarness();
  harness.pushNotifications.configureSchedovaNotificationHandler();

  const behavior = await harness
    .getConfiguredHandler()
    .handleNotification({ request: { content: { data: { type: "client_message" } } } });

  assert.equal(behavior.shouldShowAlert, true);
  assert.equal(behavior.shouldShowBanner, true);
  assert.equal(behavior.shouldShowList, true);
  assert.equal(behavior.shouldPlaySound, true);
  assert.equal(behavior.shouldSetBadge, true);
  assert.equal(harness.getEmittedClientMessageCount(), 1);
});

test("push registration captures permission-denied state without trying to persist a token", async () => {
  const harness = createPushNotificationsHarness({
    getPermissionsAsync: async () => ({
      canAskAgain: false,
      granted: false,
      ios: { status: 0 },
      status: "denied",
    }),
  });

  const token = await harness.pushNotifications.registerForPushNotifications("user-123", {
    source: "test-denied",
  });

  assert.equal(token, null);
  assert.equal(harness.getUpsertPayload(), null);
  assert.equal(getPushRegistrationState().phase, "permission-denied");
  assert.deepEqual(getPushRegistrationWarning(getPushRegistrationState()), {
    action: "open-settings",
    message:
      "Turn notifications on in Settings so you don't miss client replies.",
    title: "Notifications are off",
  });
});

test("push registration persists a generated expo token and records success state", async () => {
  const harness = createPushNotificationsHarness({
    expoPushToken: "ExponentPushToken[registered-token]",
  });

  const token = await harness.pushNotifications.registerForPushNotifications("user-123", {
    source: "test-success",
  });

  assert.equal(token, "ExponentPushToken[registered-token]");
  assert.deepEqual(harness.getSetNotificationChannelCalls(), [
    {
      channelId: CLIENT_MESSAGE_NOTIFICATION_CHANNEL_ID,
      channel: {
        importance: "high",
        name: "Client messages",
        sound: "default",
      },
    },
  ]);
  assert.deepEqual(harness.getDeleteFilters(), [
    {
      operator: "eq",
      column: "user_id",
      value: "user-123",
    },
    {
      operator: "eq",
      column: "device_id",
      value: "device-123",
    },
    {
      operator: "neq",
      column: "expo_push_token",
      value: "ExponentPushToken[registered-token]",
    },
  ]);
  assert.equal(harness.getDeleteSelectCalled(), true);
  assert.deepEqual(harness.getUpsertOptions(), {
    onConflict: "user_id,expo_push_token",
  });
  assert.equal(harness.getUpsertPayload().user_id, "user-123");
  assert.equal(
    harness.getUpsertPayload().expo_push_token,
    "ExponentPushToken[registered-token]",
  );
  assert.equal(getPushRegistrationState().phase, "registered");
  assert.equal(
    getPushRegistrationState().expoPushToken,
    "ExponentPushToken[registered-token]",
  );
});

test("push registration surfaces token persistence failures for the in-app warning", async () => {
  const harness = createPushNotificationsHarness({
    maybeSingle: async () => ({
      data: null,
      error: {
        code: "42501",
        details: "new row violates row-level security policy",
        hint: null,
        message: "new row violates row-level security policy",
      },
    }),
  });

  const token = await harness.pushNotifications.registerForPushNotifications("user-123", {
    source: "test-persist-failure",
  });

  assert.equal(token, null);
  assert.equal(getPushRegistrationState().phase, "registration-failed");
  assert.equal(getPushRegistrationState().errorCode, "42501");
  assert.deepEqual(getPushRegistrationWarning(getPushRegistrationState()), {
    action: "retry",
    message: "new row violates row-level security policy",
    title: "Notifications need attention",
  });
});

test("push token refresh listeners forward native token changes and clean up subscriptions", () => {
  const harness = createPushNotificationsHarness();
  const received = [];

  const removeListener = harness.pushNotifications.addPushTokenRefreshListener((token) => {
    received.push(token);
  });

  harness.getPushTokenListener()({
    data: "native-refresh-token",
    type: "android",
  });
  removeListener();

  assert.deepEqual(received, [
    {
      data: "native-refresh-token",
      type: "android",
    },
  ]);
  assert.equal(harness.getRemovedPushTokenListener(), true);
});

test("client message routes carry the exact message id into the inbox thread opener", () => {
  const route = getClientMessageRouteFromData({
    clientId: "client-123",
    messageId: "message-123",
    openRequestAt: "2026-08-07T13:25:00.000Z",
    type: "client_message",
  });

  assert.deepEqual(route, {
    pathname: "/messages",
    params: {
      openClientId: "client-123",
      openMessageId: "message-123",
      openRequestAt: "2026-08-07T13:25:00.000Z",
    },
  });
});

test("push sign-out cleanup removes current-device rows for the signed-in account", async () => {
  const harness = createPushNotificationsHarness();

  const removedCount =
    await harness.pushNotifications.unregisterCurrentDevicePushTokens("user-123", {
      source: "sign-out",
    });

  assert.equal(removedCount, 0);
  assert.deepEqual(harness.getDeleteFilters(), [
    {
      operator: "eq",
      column: "user_id",
      value: "user-123",
    },
    {
      operator: "eq",
      column: "device_id",
      value: "device-123",
    },
  ]);
  assert.equal(harness.getDeleteSelectCalled(), true);
});

test("concurrent push registration shares one stored device id", async () => {
  let storedDeviceId = null;
  let secureStoreReads = 0;
  let secureStoreWrites = 0;
  const harness = createPushNotificationsHarness({
    secureStoreGetItemAsync: async () => {
      secureStoreReads += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return storedDeviceId;
    },
    secureStoreSetItemAsync: async (_key, value) => {
      secureStoreWrites += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      storedDeviceId = value;
    },
  });

  const [firstToken, secondToken] = await Promise.all([
    harness.pushNotifications.registerForPushNotifications("user-123", {
      source: "concurrent-first",
    }),
    harness.pushNotifications.registerForPushNotifications("user-123", {
      source: "concurrent-second",
    }),
  ]);

  assert.equal(firstToken, "ExponentPushToken[test-token]");
  assert.equal(secondToken, "ExponentPushToken[test-token]");
  assert.equal(secureStoreReads, 1);
  assert.equal(secureStoreWrites, 1);
  assert.ok(storedDeviceId);
  assert.equal(new Set(harness.getUpsertPayloads().map((row) => row.device_id)).size, 1);
});
