const test = require("node:test");
const assert = require("node:assert/strict");

const {
  findReusableQuickStartClient,
  findReusableQuickStartService,
} = require("../lib/quickStartMatching.ts");

test("selected quick-start client is reused immediately", () => {
  const client = findReusableQuickStartClient({
    clients: [
      { id: "client-1", name: "Jamie Smith", phone: "5551112222" },
      { id: "client-2", name: "Alex Green", phone: "5553334444" },
    ],
    selectedClientId: "client-2",
    name: "Someone Else",
    phone: "",
  });

  assert.equal(client?.id, "client-2");
});

test("quick-start reuses a unique name match when phone is blank", () => {
  const client = findReusableQuickStartClient({
    clients: [{ id: "client-1", name: "Jamie Smith", phone: "5551112222" }],
    selectedClientId: "",
    name: "Jamie Smith",
    phone: "",
  });

  assert.equal(client?.id, "client-1");
});

test("quick-start does not reuse duplicate client names without a phone match", () => {
  const client = findReusableQuickStartClient({
    clients: [
      { id: "client-1", name: "Jamie Smith", phone: "5551112222" },
      { id: "client-2", name: "Jamie Smith", phone: "5553334444" },
    ],
    selectedClientId: "",
    name: "Jamie Smith",
    phone: "",
  });

  assert.equal(client, null);
});

test("selected quick-start service is reused immediately", () => {
  const service = findReusableQuickStartService({
    services: [
      { id: "service-1", name: "Haircut", price: 35, duration_minutes: 30 },
      { id: "service-2", name: "Color", price: 80, duration_minutes: 90 },
    ],
    selectedServiceId: "service-2",
    name: "Haircut",
    price: 35,
    duration: 30,
  });

  assert.equal(service?.id, "service-2");
});

test("quick-start only reuses a service when name, price, and duration all match", () => {
  const services = [
    { id: "service-1", name: "Haircut", price: 35, duration_minutes: 30 },
  ];

  const matchingService = findReusableQuickStartService({
    services,
    selectedServiceId: "",
    name: "Haircut",
    price: 35,
    duration: 30,
  });
  const changedPriceService = findReusableQuickStartService({
    services,
    selectedServiceId: "",
    name: "Haircut",
    price: 40,
    duration: 30,
  });

  assert.equal(matchingService?.id, "service-1");
  assert.equal(changedPriceService, null);
});
