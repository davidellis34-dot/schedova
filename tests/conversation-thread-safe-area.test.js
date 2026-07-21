const test = require("node:test");
const assert = require("node:assert/strict");

const {
  CONVERSATION_HEADER_ACTION_SIZE,
  getConversationHeaderActionOutcome,
  getConversationThreadLayout,
} = require("../lib/conversationThreadLayout.ts");

test("conversation header stays below Dynamic Island and notch safe areas", () => {
  const dynamicIsland = getConversationThreadLayout({ top: 59, bottom: 34 });
  const notch = getConversationThreadLayout({ top: 44, bottom: 34 });

  assert.equal(dynamicIsland.headerPaddingTop, 67);
  assert.equal(notch.headerPaddingTop, 52);
  assert.equal(dynamicIsland.composerPaddingBottom, 42);
});

test("conversation header preserves usable spacing on small iPhones and Android", () => {
  const smallIphone = getConversationThreadLayout({ top: 20, bottom: 0 });
  const android = getConversationThreadLayout({ top: 24, bottom: 0 });

  assert.equal(smallIphone.headerPaddingTop, 28);
  assert.equal(android.headerPaddingTop, 32);
  assert.equal(smallIphone.composerPaddingBottom, 18);
  assert.equal(android.composerPaddingBottom, 18);
});

test("conversation header actions provide separate close and options intents", () => {
  assert.equal(CONVERSATION_HEADER_ACTION_SIZE, 44);
  assert.deepEqual(getConversationHeaderActionOutcome("close"), {
    closeThread: true,
    openOptions: false,
  });
  assert.deepEqual(getConversationHeaderActionOutcome("more"), {
    closeThread: false,
    openOptions: true,
  });
});
