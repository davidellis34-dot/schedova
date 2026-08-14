const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

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

test("missing calendar hour preferences fall back to the default viewport hours", async () => {
  const calendarPreferences = loadWithMocks("../lib/calendarPreferences.ts", {
    "@react-native-async-storage/async-storage": {
      async getItem(key) {
        if (key === "calendar_start_hour" || key === "calendar_end_hour") {
          return null;
        }

        return null;
      },
    },
  });

  const preferences = await calendarPreferences.getCalendarPreferences();

  assert.equal(
    preferences.startHour,
    calendarPreferences.DEFAULT_CALENDAR_PREFERENCES.startHour,
  );
  assert.equal(
    preferences.endHour,
    calendarPreferences.DEFAULT_CALENDAR_PREFERENCES.endHour,
  );
  assert.equal(
    preferences.intervalMinutes,
    calendarPreferences.DEFAULT_CALENDAR_PREFERENCES.intervalMinutes,
  );
});
