import assert from "node:assert/strict";
import test from "node:test";
import {
  buildEmbeds,
  computeBackoffUntil,
  parseProducts,
  priceText,
  productGridUrl,
  runMonitor,
  isAuthorized,
  shouldSkipForInterval,
  truncate
} from "../api/cron.js";

function productHtml(pid, name, price = "255.00", href = `/socks/${pid}.html`) {
  return `
    <div class="product productType-master" data-pid="${pid}">
      <span class="product-metadata d-none"
        data-pid="${pid}" data-name="${name}" data-price="${price}"
        data-brand="Chrome Hearts" data-category="Socks"></span>
      <div class="product-tile">
        <a class="pdp-link-image hover" href="${href}">
          <img class="tile-image" src="/dw/image/v2/BFBV_PRD/example.png?sw=800&amp;sh=1000" />
        </a>
        <a class="link" aria-label="${name}" href="${href}">${name}</a>
      </div>
    </div>
  `;
}

function fakeStore(initialState = null) {
  let state = initialState || { seen: {}, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  let locked = false;

  return {
    backend: "fake",
    get state() {
      return state;
    },
    async loadState() {
      return structuredClone(state);
    },
    async saveState(nextState) {
      state = structuredClone(nextState);
    },
    async acquireLock() {
      if (locked) return null;
      locked = true;
      return "lock-token";
    },
    async releaseLock() {
      locked = false;
    }
  };
}

function baseCfg() {
  return {
    stateKey: "state",
    lockKey: "lock",
    lockSeconds: 10,
    checkMinIntervalSeconds: 0,
    maxBackoffSeconds: 900,
    notifyInitial: false
  };
}

test("parseProducts extracts product details and absolute URLs", () => {
  const products = parseProducts(productHtml("PID1", "ONE &amp; TWO"));

  assert.deepEqual(Object.keys(products), ["PID1"]);
  assert.equal(products.PID1.name, "ONE & TWO");
  assert.equal(products.PID1.price, "255.00");
  assert.equal(products.PID1.category, "Socks");
  assert.equal(products.PID1.productType, "master");
  assert.equal(products.PID1.url, "https://www.chromehearts.com/socks/PID1.html");
  assert.ok(products.PID1.image.startsWith("https://www.chromehearts.com/dw/image/"));
});

test("productGridUrl carries root paging parameters", () => {
  const url = new URL(productGridUrl(24, 12));
  assert.equal(url.searchParams.get("cgid"), "root");
  assert.equal(url.searchParams.get("start"), "24");
  assert.equal(url.searchParams.get("sz"), "12");
});

test("buildEmbeds limits Discord payload fields", () => {
  const longName = "X".repeat(300);
  const embeds = buildEmbeds([
    {
      pid: "PID2",
      name: longName,
      price: "1000",
      category: "Socks",
      productType: "standard",
      url: "https://www.chromehearts.com/socks/PID2.html",
      image: ""
    }
  ]);

  assert.equal(embeds.length, 1);
  assert.equal(embeds[0].title.length, 256);
  assert.equal(embeds[0].fields.find((field) => field.name === "Price").value, "$1,000");
});

test("interval skip respects recent successful run", () => {
  const state = { lastRunAt: new Date().toISOString() };
  assert.equal(shouldSkipForInterval(state, { checkMinIntervalSeconds: 50 }), true);
  assert.equal(shouldSkipForInterval(state, { checkMinIntervalSeconds: 0 }), false);
});

test("backoff increases and includes an ISO timestamp", () => {
  const backoff = computeBackoffUntil({ errorStreak: 2 }, { checkMinIntervalSeconds: 50, maxBackoffSeconds: 900 }, {});
  assert.equal(backoff.errorStreak, 3);
  assert.ok(Date.parse(backoff.backoffUntil) > Date.now());
});

test("utility formatting is stable", () => {
  assert.equal(priceText("750.00"), "$750");
  assert.equal(truncate("abcdef", 4), "a...");
});

test("auth check rejects missing or wrong bearer token", () => {
  assert.equal(isAuthorized({ headers: {} }, "secret"), false);
  assert.equal(isAuthorized({ headers: { authorization: "Bearer nope" } }, "secret"), false);
  assert.equal(isAuthorized({ headers: { authorization: "Bearer secret" } }, "secret"), true);
  assert.equal(isAuthorized({ headers: {} }, ""), true);
});

test("runMonitor baselines first run without sending Discord", async () => {
  const storage = fakeStore();
  let sendCount = 0;
  const result = await runMonitor(baseCfg(), storage, {
    async fetchProducts() {
      return { PID1: { pid: "PID1", name: "One", url: "https://example.com/1" } };
    },
    async sendDiscord() {
      sendCount += 1;
    }
  });

  const state = storage.state;
  assert.equal(result.baseline, true);
  assert.equal(sendCount, 0);
  assert.ok(state.seen.PID1);
});

test("runMonitor does not mark a new product seen when Discord fails", async () => {
  const storage = fakeStore({
    seen: { PID1: { pid: "PID1", name: "One", url: "https://example.com/1" } },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    errorStreak: 0,
    backoffUntil: null
  });

  await assert.rejects(
    () =>
      runMonitor(baseCfg(), storage, {
        async fetchProducts() {
          return {
            PID1: { pid: "PID1", name: "One", url: "https://example.com/1" },
            PID2: { pid: "PID2", name: "Two", url: "https://example.com/2" }
          };
        },
        async sendDiscord() {
          throw new Error("discord down");
        }
      }),
    /discord down/
  );

  const state = storage.state;
  assert.ok(state.seen.PID1);
  assert.equal(state.seen.PID2, undefined);
  assert.equal(state.errorStreak, 1);
  assert.ok(Date.parse(state.backoffUntil) > Date.now());
});
