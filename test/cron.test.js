import assert from "node:assert/strict";
import test from "node:test";
import {
  buildProductEmbed,
  buildEmbeds,
  computeBackoffUntil,
  enrichProduct,
  parseProducts,
  priceText,
  productGridUrl,
  runMonitor,
  isAuthorized,
  shouldSkipForInterval,
  truncate
} from "../api/cron.js";
import { stockDiff } from "../scripts/stock-watch.js";

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
  assert.equal(embeds[0].fields.find((field) => field.name === "Availability").value, "Awaiting size data");
  assert.equal(embeds[0].author.name, "Chrome Hearts Drop Monitor");
  assert.equal(/[✦✧✹✠☾✣◆◇†⌁]/.test(JSON.stringify(embeds[0])), false);
});

test("buildProductEmbed includes PDP description, price, image, stock, and size fields", () => {
  const embed = buildProductEmbed({
    pid: "MASTER1",
    masterPid: "MASTER1",
    selectedVariantPid: "VAR1",
    name: "BLACK HOODIE",
    price: "750.00",
    brand: "Chrome Hearts",
    category: "Hoodie",
    description: "Black cotton fleece hoodie with Chrome Hearts sleeve print.\nMade in USA.",
    productType: "master",
    url: "https://www.chromehearts.com/hoodie/black-hoodie/MASTER1.html",
    image: "https://www.chromehearts.com/image.png",
    exactStockKnown: false,
    totalStock: null,
    productAvailable: true,
    readyToOrder: true,
    stockSource: "Product-Variation JSON",
    inStockSizeCount: 2,
    cappedOrderableTotal: 20,
    sizes: [
      { code: "XSM", label: "XS", inStock: true },
      { code: "LRG", label: "L", inStock: false },
      { code: "2XL", label: "XXL", inStock: true }
    ]
  });

  assert.equal(embed.title, "BLACK HOODIE");
  assert.equal(embed.description, "Black cotton fleece hoodie with Chrome Hearts sleeve print.\nMade in USA.");
  assert.equal(embed.image.url, "https://www.chromehearts.com/image.png");
  assert.equal(embed.fields.find((field) => field.name === "Price").value, "$750");
  assert.equal(embed.fields.find((field) => field.name === "Availability").value, "2 of 3 sizes available");
  assert.equal(embed.fields.find((field) => field.name === "Available sizes").value, "XS, XXL");
  assert.equal(embed.fields.find((field) => field.name === "Unavailable sizes").value, "L");
  assert.equal(embed.fields.find((field) => field.name === "† Inventory"), undefined);
  assert.equal(embed.fields.find((field) => field.name === "⌁ SFCC signal"), undefined);
  assert.equal(embed.fields.find((field) => field.name === "Inventory"), undefined);
  assert.equal(embed.fields.find((field) => field.name === "SFCC signal"), undefined);
  assert.equal(embed.description.includes("//"), false);
  assert.equal(embed.description.includes("Silver signal"), false);
  assert.equal(/[✦✧✹✠☾✣◆◇†⌁]/.test(JSON.stringify(embed)), false);
  assert.equal(embed.color, 0xb8f3d4);
});

test("buildProductEmbed only shows inventory when exact stock is known", () => {
  const embed = buildProductEmbed({
    pid: "PID1",
    name: "EXACT ITEM",
    price: "100.00",
    url: "https://www.chromehearts.com/item/PID1.html",
    exactStockKnown: true,
    totalStock: 7,
    inStockSizeCount: 1,
    sizes: [{ code: "OSZ", label: "OS", inStock: true, exactStock: 7 }]
  });

  assert.equal(embed.fields.find((field) => field.name === "Exact stock").value, "7 units");
  assert.equal(embed.fields.find((field) => field.name === "Available sizes").value, "OS (7)");
  assert.equal(embed.description, "Chrome Hearts, product, $100");
});

test("enrichProduct falls back to grid data when PDP fetch fails", async () => {
  const product = {
    pid: "PID1",
    name: "GRID NAME",
    price: "100",
    url: "https://www.chromehearts.com/example.html",
    image: "https://www.chromehearts.com/grid.png"
  };
  const enriched = await enrichProduct(
    product,
    { requestTimeoutMs: 1000, userAgent: "test" },
    {
      async fetchStockSnapshot() {
        throw new Error("pdp down");
      }
    }
  );

  assert.equal(enriched.name, "GRID NAME");
  assert.equal(enriched.image, "https://www.chromehearts.com/grid.png");
  assert.equal(enriched.detailError, "pdp down");
  assert.deepEqual(enriched.sizes, []);
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
        },
        async enrichProducts(products) {
          return products;
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

test("runMonitor baselines stock snapshot without initial stock alert", async () => {
  const storage = fakeStore();
  let stockAlertCount = 0;
  const stockSnapshot = {
    masterPid: "MASTER1",
    name: "BLACK HOODIE",
    inStockSizeCount: 1,
    cappedOrderableTotal: 10,
    exactStockKnown: false,
    totalStock: null,
    sizes: [{ code: "XSM", label: "XS", inStock: true }]
  };

  const result = await runMonitor({ ...baseCfg(), stockProductUrl: "https://example.com/product" }, storage, {
    async fetchProducts() {
      return { PID1: { pid: "PID1", name: "One", url: "https://example.com/1" } };
    },
    async fetchStockSnapshot() {
      return stockSnapshot;
    },
    stockDiff,
    async enrichProducts(products) {
      return products;
    },
    async sendDiscord() {
      throw new Error("new product alert should be suppressed on baseline");
    },
    async sendStockDiscord() {
      stockAlertCount += 1;
    }
  });

  assert.equal(result.baseline, true);
  assert.equal(result.stock.alerted, false);
  assert.equal(stockAlertCount, 0);
  assert.deepEqual(storage.state.stockSnapshot, stockSnapshot);
});

test("runMonitor sends stock alert when size availability changes", async () => {
  const storage = fakeStore({
    seen: { PID1: { pid: "PID1", name: "One", url: "https://example.com/1" } },
    stockSnapshot: {
      masterPid: "MASTER1",
      name: "BLACK HOODIE",
      inStockSizeCount: 1,
      cappedOrderableTotal: 10,
      sizes: [
        { code: "XSM", label: "XS", inStock: true },
        { code: "LRG", label: "L", inStock: false }
      ]
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    errorStreak: 0,
    backoffUntil: null
  });
  let stockAlert = null;

  const nextSnapshot = {
    masterPid: "MASTER1",
    name: "BLACK HOODIE",
    inStockSizeCount: 2,
    cappedOrderableTotal: 20,
    exactStockKnown: false,
    totalStock: null,
    sizes: [
      { code: "XSM", label: "XS", inStock: true },
      { code: "LRG", label: "L", inStock: true }
    ]
  };

  const result = await runMonitor({ ...baseCfg(), stockProductUrl: "https://example.com/product" }, storage, {
    async fetchProducts() {
      return { PID1: { pid: "PID1", name: "One", url: "https://example.com/1" } };
    },
    async fetchStockSnapshot() {
      return nextSnapshot;
    },
    stockDiff,
    async enrichProducts(products) {
      return products;
    },
    async sendDiscord() {
      throw new Error("no new product alert expected");
    },
    async sendStockDiscord(_cfg, snapshot, diff) {
      stockAlert = { snapshot, diff };
    }
  });

  assert.equal(result.stock.alerted, true);
  assert.deepEqual(result.stock.changes, [{ code: "LRG", label: "L", from: "out_of_stock", to: "in_stock" }]);
  assert.equal(stockAlert.snapshot, nextSnapshot);
  assert.equal(stockAlert.diff.inStockSizeCountChange, 1);
  assert.deepEqual(storage.state.stockSnapshot, nextSnapshot);
});

test("runMonitor still alerts new products when optional stock URL fails", async () => {
  const storage = fakeStore({
    seen: { PID1: { pid: "PID1", name: "One", url: "https://example.com/1" } },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    errorStreak: 0,
    backoffUntil: null
  });
  let sentProducts = [];

  const result = await runMonitor({ ...baseCfg(), stockProductUrl: "https://example.com/stale" }, storage, {
    async fetchProducts() {
      return {
        PID1: { pid: "PID1", name: "One", url: "https://example.com/1" },
        PID2: { pid: "PID2", name: "Two", url: "https://example.com/2" }
      };
    },
    async enrichProducts(products) {
      return products;
    },
    async fetchStockSnapshot() {
      throw new Error("stale stock url");
    },
    async sendDiscord(_cfg, products) {
      sentProducts = products;
    }
  });

  assert.equal(result.alerted, 1);
  assert.equal(result.stock.error, "stale stock url");
  assert.deepEqual(
    sentProducts.map((product) => product.pid),
    ["PID2"]
  );
  assert.ok(storage.state.seen.PID2);
  assert.equal(storage.state.errorStreak, 0);
});
