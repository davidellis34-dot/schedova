const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  clearDashboardPrimaryCache,
  getDashboardPrimaryCache,
  setDashboardPrimaryCache,
} = require("../lib/dashboardCache.ts");

const ROOT = path.resolve(__dirname, "..");

function readSource(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

test("dashboard primary cache invalidation clears only the requested user", () => {
  setDashboardPrimaryCache("user-a", {
    appointments: [],
    clients: [],
    services: [{ id: "service-a" }],
  });
  setDashboardPrimaryCache("user-b", {
    appointments: [],
    clients: [],
    services: [{ id: "service-b" }],
  });

  clearDashboardPrimaryCache("user-a");

  assert.equal(getDashboardPrimaryCache("user-a"), null);
  assert.deepEqual(getDashboardPrimaryCache("user-b")?.services, [
    { id: "service-b" },
  ]);

  clearDashboardPrimaryCache("user-b");
});

test("service mutations invalidate the user-scoped dashboard cache", () => {
  const source = readSource("app/add-service.tsx");

  assert.match(
    source,
    /import\s+\{\s*clearDashboardPrimaryCache\s*\}\s+from\s+"..\/lib\/dashboardCache";/,
  );
  assert.equal(
    (source.match(/clearDashboardPrimaryCache\(currentUserId\);/g) || []).length,
    2,
    "add-service should clear the current user's dashboard cache after save and delete",
  );
});
