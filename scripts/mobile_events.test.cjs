const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");

const context = vm.createContext({ console });
vm.runInContext(
  fs.readFileSync(path.join(__dirname, "finance_api_v1.gs"), "utf8"),
  context
);

const events = [
  {
    ID: "pending",
    WORKSPACE_ID: "workspace-a",
    PROCESSING_STATUS: "PENDENTE_REVISAO",
    RECEIVED_AT: "2026-11-27T12:00:00Z",
    ACCOUNT_ID: "account-a",
    DESCRIPTION: "Evento incompleto",
    PAYLOAD_JSON: '{"missing":["valor"]}'
  },
  {
    ID: "inserted",
    WORKSPACE_ID: "workspace-a",
    PROCESSING_STATUS: "INSERIDO_AVULSO",
    RECEIVED_AT: "2026-11-27T13:00:00Z",
    PAYLOAD_JSON: '{"source":"sms"}'
  },
  {
    ID: "other-workspace",
    WORKSPACE_ID: "workspace-b",
    PROCESSING_STATUS: "PENDENTE_REVISAO",
    RECEIVED_AT: "2026-11-27T14:00:00Z"
  },
  {
    ID: "deleted",
    WORKSPACE_ID: "workspace-a",
    PROCESSING_STATUS: "PENDENTE_REVISAO",
    DELETED_AT: "2026-11-27"
  }
];
const eventHeaders = [
  "ID", "WORKSPACE_ID", "EXTERNAL_ID", "ENTRY_TYPE", "RECEIVED_AT",
  "TRANSACTION_DATE", "DESCRIPTION", "AMOUNT", "CURRENCY", "ACCOUNT_ID",
  "CARD_LAST_FOUR", "MERCHANT", "CATEGORY_LABEL", "NOTES",
  "PROCESSING_STATUS", "PAYLOAD_JSON", "DELETED_AT"
];
const rows = {
  ACCOUNTS: [
    { ID: "account-a", WORKSPACE_ID: "workspace-a", NAME: "Conta", CURRENCY: "BRL" }
  ],
  CATEGORIES: [
    { ID: "category-a", WORKSPACE_ID: "workspace-a", DISPLAY_NAME: "Mercado" }
  ],
  TRANSACTIONS: [
    {
      ID: "tx-a", WORKSPACE_ID: "workspace-a", REVIEW_STATUS: "UNVERIFIED",
      ACCOUNT_ID: "account-a", CATEGORY_ID: "category-a", AMOUNT: 42,
      CURRENCY: "BRL", DESCRIPTION: "Compra", SOURCE_KEY: "inserted",
      CREATED_AT: "2026-11-27T13:00:00Z"
    },
    { ID: "tx-approved", WORKSPACE_ID: "workspace-a", REVIEW_STATUS: "APPROVED" },
    { ID: "tx-other", WORKSPACE_ID: "workspace-b", REVIEW_STATUS: "UNVERIFIED" },
    { ID: "tx-deleted", WORKSPACE_ID: "workspace-a", REVIEW_STATUS: "UNVERIFIED", DELETED_AT: "2026-11-27" }
  ],
  INSTALLMENT_PLANS: [
    {
      ID: "plan-a", WORKSPACE_ID: "workspace-a", REVIEW_STATUS: "UNVERIFIED",
      ACCOUNT_ID: "account-a", TOTAL_AMOUNT: 180, DESCRIPTION: "Parcelamento",
      CREATED_AT: "2026-11-27T11:00:00Z"
    }
  ]
};

context.financeApiV1ReadTable_ = (name) => {
  assert.equal(name, "EXTERNAL_EVENTS");
  return {
    headers: eventHeaders,
    rows: events.map((event) => eventHeaders.map((header) => event[header] ?? ""))
  };
};
context.financeApiV1DashboardReadRows_ = (name, _fields, workspaceId) =>
  rows[name].filter((record) =>
    record.WORKSPACE_ID === workspaceId && !record.DELETED_AT
  );

test("review combines scoped pending events, transactions and plans before pagination", () => {
  const first = context.financeApiV1ListMobileEvents_("workspace-a", "review", 2, 0);
  const second = context.financeApiV1ListMobileEvents_("workspace-a", "review", 2, 2);
  assert.equal(first.total, 3);
  assert.equal(first.items.length, 2);
  assert.deepEqual(Array.from(first.items, (item) => item.ID), ["tx-a", "pending"]);
  assert.equal(first.items[0].KIND, "TRANSACTION");
  assert.equal(first.items[0].CATEGORY_LABEL, "Mercado");
  assert.equal(first.items[0].PAYLOAD_JSON, '{"source":"sms"}');
  assert.equal(second.items[0].ID, "plan-a");
  assert.equal(second.items[0].CURRENCY, "BRL");
});

test("logs include original payloads but not another workspace or deleted rows", () => {
  const result = context.financeApiV1ListMobileEvents_("workspace-a", "logs", 50, 0);
  assert.equal(result.total, 2);
  assert.deepEqual(Array.from(result.items, (item) => item.ID), ["inserted", "pending"]);
  assert.equal(result.items[0].PAYLOAD_JSON, '{"source":"sms"}');
});

test("mobile events route authenticates and enforces workspace permissions", () => {
  let authorized = false;
  context.financeApiV1AssertSetup_ = () => {};
  context.financeApiV1Authenticate_ = (token) => {
    if (token !== "session") throw new Error("unauthenticated");
    return { userId: "user-a" };
  };
  context.financeApiV1SelectWorkspace_ = (_user, workspaceId) => workspaceId;
  context.financeApiV1RequireRole_ = (_user, workspaceId) => {
    if (workspaceId !== "workspace-a") throw new Error("forbidden");
    authorized = true;
  };
  context.financeApiV1Json_ = (value) => value;
  context.financeApiV1ErrorResponse_ = (error) => ({ ok: false, error: error.message });
  const get = (token, workspaceId) => context.financeApiV1DoGet_({
    parameter: { resource: "mobile_events", access_token: token, workspaceId }
  });
  assert.equal(get("", "workspace-a").ok, false);
  assert.equal(get("session", "workspace-b").ok, false);
  const result = get("session", "workspace-a");
  assert.equal(authorized, true);
  assert.equal(result.ok, true);
  assert.equal(result.meta.total, 3);
});
