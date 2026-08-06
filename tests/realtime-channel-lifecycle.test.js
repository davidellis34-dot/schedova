const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createUserScopedRealtimeChannelName,
  matchesUserScopedRealtimeChannel,
  openUserScopedRealtimeChannel,
  removeUserScopedRealtimeChannels,
  resetRealtimeChannelLifecycleForTests,
} = require("../lib/realtimeChannelLifecycle.ts");

function createMockChannel(topic, events) {
  return {
    topic,
    on(...args) {
      events.push(["on", topic, args[0]]);
      return this;
    },
    subscribe(...args) {
      events.push(["subscribe", topic, args.length]);
      return this;
    },
  };
}

function createMockRealtimeClient(initialTopics = []) {
  const events = [];
  let channels = initialTopics.map((topic) => createMockChannel(topic, events));

  return {
    events,
    channel(topic) {
      events.push(["channel", topic]);
      const channel = createMockChannel(`realtime:${topic}`, events);
      channels.push(channel);
      return channel;
    },
    getChannels() {
      return [...channels];
    },
    async removeChannel(channel) {
      events.push(["remove", channel.topic]);
      channels = channels.filter((entry) => entry !== channel);
      return "ok";
    },
  };
}

test.beforeEach(() => {
  resetRealtimeChannelLifecycleForTests();
});

test("user-scoped realtime channel names stay unique across remount-style opens", () => {
  const first = createUserScopedRealtimeChannelName(
    "dashboard-client-replies-",
    "user-123",
  );
  const second = createUserScopedRealtimeChannelName(
    "dashboard-client-replies-",
    "user-123",
  );

  assert.notEqual(first, second);
  assert.match(first, /^dashboard-client-replies-user-123-\d+$/);
  assert.match(second, /^dashboard-client-replies-user-123-\d+$/);
});

test("duplicate cleanup only removes channels for the same screen and user", async () => {
  const client = createMockRealtimeClient([
    "realtime:dashboard-client-replies-user-123-1",
    "realtime:dashboard-client-replies-user-123-2",
    "realtime:dashboard-client-replies-user-999-1",
    "realtime:messages-inbox-user-123-1",
  ]);

  const removedCount = await removeUserScopedRealtimeChannels(client, {
    prefix: "dashboard-client-replies-",
    userId: "user-123",
  });

  assert.equal(removedCount, 2);
  assert.deepEqual(
    client.events.filter(([event]) => event === "remove"),
    [
      ["remove", "realtime:dashboard-client-replies-user-123-1"],
      ["remove", "realtime:dashboard-client-replies-user-123-2"],
    ],
  );
  assert.equal(
    client
      .getChannels()
      .some((channel) =>
        matchesUserScopedRealtimeChannel(channel, {
          prefix: "dashboard-client-replies-",
          userId: "user-123",
        }),
      ),
    false,
  );
});

test("opening a realtime channel removes duplicates and registers callbacks before subscribe", async () => {
  const client = createMockRealtimeClient([
    "realtime:messages-inbox-user-123-1",
  ]);

  const openedChannel = await openUserScopedRealtimeChannel(client, {
    prefix: "messages-inbox-",
    userId: "user-123",
    registerCallbacks(channel) {
      channel.on("postgres_changes", {}, () => {});
    },
  });

  assert.ok(openedChannel);
  assert.deepEqual(client.events.map(([event]) => event), [
    "remove",
    "channel",
    "on",
    "subscribe",
  ]);
  assert.match(openedChannel.topic, /^realtime:messages-inbox-user-123-\d+$/);
});

test("opening a realtime channel aborts before creating a new subscription when the effect is stale", async () => {
  const client = createMockRealtimeClient([
    "realtime:dashboard-client-replies-user-123-1",
  ]);

  const openedChannel = await openUserScopedRealtimeChannel(client, {
    prefix: "dashboard-client-replies-",
    shouldAbort: () => true,
    userId: "user-123",
    registerCallbacks(channel) {
      channel.on("postgres_changes", {}, () => {});
    },
  });

  assert.equal(openedChannel, null);
  assert.deepEqual(client.events.map(([event]) => event), ["remove"]);
});
