import assert from "node:assert/strict";
import test from "node:test";
import worker, {
  extractGridPids,
  runMonitor,
  productUrlFromUrl,
  categoryStatusTransitions,
  interestingCategoryTransition,
  discoveredCategories
} from "../src/worker.js";

const STATE_KEY = "state";
const LOCK_KEY = "lock";
const SETTINGS_KEY = "settings";

function productTile(pid, name, categorySlug, categoryName, price = "395.00") {
  const href = `/${categorySlug}/${name.toLowerCase().replaceAll(" ", "-")}/${pid}.html`;
  return `
    <div class="product productType-master" data-pid="${pid}">
      <span class="product-metadata d-none"
        data-pid="${pid}"
        data-name="${name}"
        data-price="${price}"
        data-brand="Chrome Hearts"
        data-category="${categoryName}"></span>
      <a class="pdp-link-image hover" href="${href}">
        <img class="tile-image" src="/dw/image/v2/BFBV_PRD/${pid}.png?sw=800&amp;sh=1000" />
      </a>
      <a class="link" href="${href}">${name}</a>
    </div>
  `;
}

function productDetail(pid, name, categoryName, price = "395.00") {
  return `
    <script type="application/ld+json">
      {
        "@context": "https://schema.org/",
        "@type": "Product",
        "name": "${name}",
        "description": "${name} loaded and available.",
        "offers": { "@type": "Offer", "availability": "https://schema.org/InStock" }
      }
    </script>
    <div class="container product-detail" data-pid="${pid}">
      <span class="product-metadata d-none"
        data-pid="${pid}"
        data-name="${name}"
        data-price="${price}"
        data-brand="Chrome Hearts"
        data-category="${categoryName}"></span>
      <img data-large-img="/dw/image/v2/BFBV_PRD/${pid}-large.png?sw=1600" src="/dw/image/v2/BFBV_PRD/${pid}.png?sw=540" />
      <input class="quantity-select" min="1" max="10" value="1" name="quantity" type="number" />
      <button class="add-to-cart" data-pid="${pid}">Add to cart</button>
    </div>
  `;
}

function variationJson(pid) {
  return {
    product: {
      id: pid,
      masterProductId: pid,
      maxOrderQuantity: 10,
      available: true,
      readyToOrder: true,
      availability: { messages: ["In Stock"] }
    }
  };
}

function stateWithSeen(products) {
  const now = new Date().toISOString();
  return {
    seen: Object.fromEntries(
      products.map((product) => [
        product.pid,
        {
          pid: product.pid,
          name: product.name,
          price: product.price || "100.00",
          category: product.category || "Shop",
          url: product.url || `https://www.chromehearts.com/shop/${product.pid}.html`,
          image: "",
          firstSeenAt: now
        }
      ])
    ),
    createdAt: now,
    updatedAt: now,
    errorStreak: 0,
    backoffUntil: null,
    lastResult: null
  };
}

function stateWithActive(products) {
  const state = stateWithSeen(products);
  state.active = structuredClone(state.seen);
  state.missing = {};
  return state;
}

function fakeKV(initialState = stateWithSeen([])) {
  const values = new Map([[STATE_KEY, JSON.stringify(initialState)]]);
  return {
    values,
    async get(key) {
      return values.get(key) ?? null;
    },
    async put(key, value) {
      values.set(key, value);
    },
    async delete(key) {
      values.delete(key);
    }
  };
}

function env(overrides = {}, kv = fakeKV()) {
  return {
    STATE: kv,
    STATE_KEY,
    LOCK_KEY,
    SETTINGS_KEY,
    DISCORD_WEBHOOK_URL: "https://discord.test/webhook",
    CRON_SECRET: "secret",
    CATEGORY_FETCH_CONCURRENCY: "8",
    CHECK_MIN_INTERVAL_SECONDS: "0",
    DISCOVER_HOMEPAGE_CATEGORIES: "true",
    DISCOVER_PRODUCT_URL_CATEGORIES: "true",
    DISCOVER_SITEMAP_CATEGORIES: "true",
    EXACT_STOCK_PROBE_CONCURRENCY: "1",
    MAX_ALERTS_PER_RUN: "5",
    MAX_CATEGORY_IDS: "40",
    MAX_CATEGORY_PAGES: "1",
    MAX_DIRECT_PRODUCT_URLS: "5",
    MAX_STOREFRONT_SUBREQUESTS: "38",
    MAX_PAGES: "1",
    MIN_PRODUCTS: "1",
    PAGE_SIZE: "200",
    PROBE_EXACT_STOCK: "false",
    REQUEST_TIMEOUT_MS: "1000",
    PROSPECTIVE_CATEGORY_SHARD_SIZE: "24",
    WEBHOOK_TIMEOUT_MS: "1000",
    ...overrides
  };
}

function authHeaders() {
  return { authorization: "Bearer secret" };
}

function basicAuthHeaders(password = "secret") {
  return { authorization: `Basic ${Buffer.from(`chrome-hearts:${password}`).toString("base64")}` };
}

function createChromeHeartsFetch({
  root = "",
  categories = {},
  searches = {},
  sitemapCategories = [],
  sitemapProductUrls = [],
  homepageCategories = [],
  homepageProductUrls = [],
  robotsProductUrls = [],
  robotsExtraLines = [],
  productDetails = {}
}) {
  const discordPayloads = [];
  const discordUrls = [];
  const gridCategoryCalls = [];
  const searchCalls = [];

  const fetchMock = async (input, init = {}) => {
    const url = new URL(String(input));

    const isDiscordWebhook =
      url.href === "https://discord.test/webhook" ||
      ((url.hostname === "discord.com" || url.hostname.endsWith(".discord.com") || url.hostname === "discordapp.com") &&
        url.pathname.startsWith("/api/webhooks/"));
    if (isDiscordWebhook) {
      discordUrls.push(url.toString());
      discordPayloads.push(JSON.parse(init.body || "{}"));
      return new Response(null, { status: 204 });
    }

    if (url.hostname !== "www.chromehearts.com") {
      return new Response("not found", { status: 404 });
    }

    if (url.pathname === "/") {
      const links = [
        ...homepageCategories.map((category) => `<a href="/${category}/">${category}</a>`),
        ...homepageProductUrls.map((productUrl) => `<a href="${productUrl}">${productUrl}</a>`)
      ].join("");
      return new Response(`<!doctype html><nav>${links}</nav>`, {
        status: 200,
        headers: { "content-type": "text/html" }
      });
    }

    if (url.pathname === "/robots.txt") {
      const lines = [
        "User-agent: *",
        ...robotsProductUrls.map((productUrl) => `Disallow: ${new URL(productUrl, "https://www.chromehearts.com").pathname}`),
        ...robotsExtraLines,
        "Allow: /"
      ];
      return new Response(lines.join("\n"), { status: 200, headers: { "content-type": "text/plain" } });
    }

    if (url.pathname === "/sitemap_index.xml") {
      return new Response(`<sitemapindex><sitemap><loc>https://www.chromehearts.com/sitemap_0.xml</loc></sitemap></sitemapindex>`, {
        status: 200,
        headers: { "content-type": "application/xml" }
      });
    }

    if (url.pathname === "/sitemap_0.xml") {
      const locs = [
        ...sitemapCategories.map((category) => `<url><loc>https://www.chromehearts.com/${category}/</loc></url>`),
        ...sitemapProductUrls.map((productUrl) => `<url><loc>${new URL(productUrl, "https://www.chromehearts.com").toString()}</loc></url>`)
      ].join("");
      return new Response(`<urlset>${locs}</urlset>`, { status: 200, headers: { "content-type": "application/xml" } });
    }

    if (url.pathname.includes("/Search-UpdateGrid")) {
      const q = url.searchParams.get("q");
      if (q) {
        searchCalls.push(q);
        return new Response(searches[q] || "", { status: 200, headers: { "content-type": "text/html" } });
      }
      const cgid = url.searchParams.get("cgid");
      gridCategoryCalls.push(cgid);
      return new Response(cgid === "root" ? root : categories[cgid] || "", {
        status: 200,
        headers: { "content-type": "text/html" }
      });
    }

    if (url.pathname.includes("/Product-Variation")) {
      return new Response(JSON.stringify(variationJson(url.searchParams.get("pid") || "UNKNOWN")), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }

    const pid = url.pathname.match(/\/([^/]+)\.html$/)?.[1] || "UNKNOWN";
    const detail = productDetails[pid] || {
      name: pid.replaceAll("_", " "),
      categoryName: "Hat",
      price: "395.00"
    };
    return new Response(productDetail(pid, detail.name, detail.categoryName, detail.price), {
      status: 200,
      headers: { "content-type": "text/html" }
    });
  };

  return { fetchMock, discordPayloads, discordUrls, gridCategoryCalls, searchCalls };
}

async function withMockedFetch(fetchMock, fn) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchMock;
  try {
    return await fn();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function runWorkerOnce(testEnv) {
  const response = await worker.fetch(new Request("https://monitor.test/api/cron", { headers: authHeaders() }), testEnv);
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  return body;
}

async function runWorkerFastOnce(testEnv) {
  const response = await worker.fetch(new Request("https://monitor.test/api/cron?mode=fast", { headers: authHeaders() }), testEnv);
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  return body;
}

function fastEnv(overrides = {}, kv) {
  return env({ FAST_CATEGORY_SHARD_SIZE: "0", PROSPECTIVE_CATEGORY_IDS: "", ...overrides }, kv);
}

test("Cloudflare Worker alerts a product that only appears in a sitemap-discovered category", async () => {
  const oldProduct = productTile("OLD_SHOP", "OLD SHOP ITEM", "shop", "Shop", "100.00");
  const newHat = productTile("NEW_HAT", "TRUCKER HAT", "hat", "Hat", "395.00");
  const kv = fakeKV(stateWithSeen([{ pid: "OLD_SHOP", name: "OLD SHOP ITEM" }]));
  const mock = createChromeHeartsFetch({
    root: oldProduct,
    categories: { hat: newHat },
    sitemapCategories: ["hat"]
  });

  await withMockedFetch(mock.fetchMock, async () => {
    const result = await runWorkerOnce(env({}, kv));

    assert.equal(result.alerted, 1);
    assert.equal(result.productCount, 2);
    assert.deepEqual(result.newPids, ["NEW_HAT"]);
    assert.ok(mock.gridCategoryCalls.includes("root"));
    assert.ok(mock.gridCategoryCalls.includes("hat"));
    assert.equal(mock.discordPayloads.length, 1);
    const embed = mock.discordPayloads[0].embeds[0];
    assert.equal(embed.title, "NEW HAT");
    assert.equal(embed.color, 0xffffff, "embed accent bar is white");
    assert.equal(
      embed.fields.find((field) => field.name === "Availability"),
      undefined,
      "Availability field removed from alerts"
    );
  });
});

test("Cloudflare Worker checks a brand-new homepage/nav category before it is manually configured", async () => {
  const oldProduct = productTile("OLD_SHOP", "OLD SHOP ITEM", "shop", "Shop", "100.00");
  const newProduct = productTile("NEW_SECRET", "SECRET DROP", "secret-drop", "Secret Drop", "245.00");
  const kv = fakeKV(stateWithSeen([{ pid: "OLD_SHOP", name: "OLD SHOP ITEM" }]));
  const mock = createChromeHeartsFetch({
    root: oldProduct,
    categories: { "secret-drop": newProduct },
    homepageCategories: ["secret-drop"],
    productDetails: {
      NEW_SECRET: { name: "SECRET DROP", categoryName: "Secret Drop", price: "245.00" }
    }
  });

  await withMockedFetch(mock.fetchMock, async () => {
    const result = await runWorkerOnce(env({ DISCOVER_SITEMAP_CATEGORIES: "false" }, kv));

    assert.equal(result.alerted, 1);
    assert.deepEqual(result.newPids, ["NEW_SECRET"]);
    assert.ok(mock.gridCategoryCalls.includes("secret-drop"));
    assert.equal(mock.discordPayloads[0].embeds[0].fields.find((field) => field.name === "Price").value, "$245");
  });
});

test("Cloudflare Worker checks prospective eyewear category before public discovery", async () => {
  const oldProduct = productTile("OLD_SHOP", "OLD SHOP ITEM", "shop", "Shop", "100.00");
  const blueher = productTile("BLUEHER_OS", "BLUEHER", "eyewear", "Eyewear", "1670.00");
  const kv = fakeKV(stateWithSeen([{ pid: "OLD_SHOP", name: "OLD SHOP ITEM" }]));
  const mock = createChromeHeartsFetch({
    root: oldProduct,
    categories: { eyewear: blueher },
    productDetails: {
      BLUEHER_OS: { name: "BLUEHER", categoryName: "Eyewear", price: "1670.00" }
    }
  });

  await withMockedFetch(mock.fetchMock, async () => {
    const result = await runWorkerOnce(
      env(
        {
          DISCOVER_HOMEPAGE_CATEGORIES: "false",
          DISCOVER_PRODUCT_URL_CATEGORIES: "false",
          DISCOVER_SITEMAP_CATEGORIES: "false",
          MAX_CATEGORY_IDS: "12"
        },
        kv
      )
    );

    assert.equal(result.alerted, 1);
    assert.deepEqual(result.newPids, ["BLUEHER_OS"]);
    assert.ok(mock.gridCategoryCalls.includes("eyewear"));
    assert.equal(mock.discordPayloads[0].embeds[0].title, "BLUEHER");
    assert.equal(mock.discordPayloads[0].embeds[0].fields.find((field) => field.name === "Category").value, "Eyewear");
  });
});

test("Cloudflare Worker rotates through prospective category shards", async () => {
  const oldProduct = productTile("OLD_SHOP", "OLD SHOP ITEM", "shop", "Shop", "100.00");
  const hiddenProduct = productTile("LATE_HIDDEN", "LATE HIDDEN", "hidden-three", "Hidden Three", "600.00");
  const kv = fakeKV({
    ...stateWithSeen([{ pid: "OLD_SHOP", name: "OLD SHOP ITEM" }]),
    prospectiveCategoryCursor: 0
  });
  const config = {
    DISCOVER_HOMEPAGE_CATEGORIES: "false",
    DISCOVER_PRODUCT_URL_CATEGORIES: "false",
    DISCOVER_ROBOTS_PRODUCTS: "false",
    DISCOVER_SITEMAP_CATEGORIES: "false",
    SCAN_ALL_CATEGORIES_ON_FULL_SWEEP: "false",
    MAX_CATEGORY_IDS: "5",
    MAX_DIRECT_PRODUCT_URLS: "0",
    MAX_STOREFRONT_SUBREQUESTS: "10",
    PROSPECTIVE_CATEGORY_IDS: "hidden-one,hidden-two,hidden-three,hidden-four",
    PROSPECTIVE_CATEGORY_SHARD_SIZE: "2"
  };

  const firstMock = createChromeHeartsFetch({ root: oldProduct, categories: { "hidden-three": hiddenProduct } });
  await withMockedFetch(firstMock.fetchMock, async () => {
    const result = await runWorkerOnce(env(config, kv));
    const state = JSON.parse(kv.values.get(STATE_KEY));

    assert.equal(result.alerted, 0);
    assert.ok(firstMock.gridCategoryCalls.includes("hidden-one"));
    assert.ok(firstMock.gridCategoryCalls.includes("hidden-two"));
    assert.equal(firstMock.gridCategoryCalls.includes("hidden-three"), false);
    assert.equal(state.prospectiveCategoryCursor, 2);
  });

  kv.values.delete(LOCK_KEY);
  const secondMock = createChromeHeartsFetch({ root: oldProduct, categories: { "hidden-three": hiddenProduct } });
  await withMockedFetch(secondMock.fetchMock, async () => {
    const result = await runWorkerOnce(env(config, kv));

    assert.equal(result.alerted, 1);
    assert.deepEqual(result.newPids, ["LATE_HIDDEN"]);
    assert.ok(secondMock.gridCategoryCalls.includes("hidden-three"));
  });
});

test("Full sweep scans the entire prospective universe in one run (no rotation wait)", async () => {
  const oldProduct = productTile("OLD_SHOP", "OLD SHOP ITEM", "shop", "Shop", "100.00");
  const stealth = productTile("STEALTH_DROP", "STEALTH DROP", "eyewear", "Eyewear", "1200.00");
  const kv = fakeKV(stateWithSeen([{ pid: "OLD_SHOP", name: "OLD SHOP ITEM" }]));
  const mock = createChromeHeartsFetch({
    root: oldProduct,
    categories: { "cat-49": stealth },
    productDetails: { STEALTH_DROP: { name: "STEALTH DROP", categoryName: "Eyewear", price: "1200.00" } }
  });
  const universe = Array.from({ length: 50 }, (_, i) => `cat-${i}`).join(",");

  await withMockedFetch(mock.fetchMock, async () => {
    const result = await runWorkerOnce(
      env(
        {
          DISCOVER_HOMEPAGE_CATEGORIES: "false",
          DISCOVER_SITEMAP_CATEGORIES: "false",
          DISCOVER_ROBOTS_PRODUCTS: "false",
          PROSPECTIVE_CATEGORY_IDS: universe,
          MAX_CATEGORY_IDS: "80",
          MAX_STOREFRONT_SUBREQUESTS: "90"
        },
        kv
      )
    );

    assert.equal(result.alerted, 1);
    assert.deepEqual(result.newPids, ["STEALTH_DROP"]);
    assert.ok(mock.gridCategoryCalls.includes("cat-49"), "scan-all must reach the deepest category in one run");
    assert.ok(result.sweep, "full sweep exposes sweep telemetry");
    assert.ok(result.sweep.activeCategoryIds.includes("cat-49"));
  });
});

test("Cloudflare Worker infers category grids from product URLs in the root grid", async () => {
  const oldHat = productTile("OLD_HAT", "OLD HAT", "hat", "Hat", "100.00");
  const newHat = productTile("NEW_HAT_2", "NEW HAT TWO", "hat", "Hat", "395.00");
  const kv = fakeKV(stateWithSeen([{ pid: "OLD_HAT", name: "OLD HAT" }]));
  const mock = createChromeHeartsFetch({
    root: oldHat,
    categories: { hat: `${oldHat}${newHat}` }
  });

  await withMockedFetch(mock.fetchMock, async () => {
    const result = await runWorkerOnce(
      env(
        {
          DISCOVER_HOMEPAGE_CATEGORIES: "false",
          DISCOVER_SITEMAP_CATEGORIES: "false"
        },
        kv
      )
    );

    assert.equal(result.alerted, 1);
    assert.deepEqual(result.newPids, ["NEW_HAT_2"]);
    assert.ok(mock.gridCategoryCalls.includes("root"));
    assert.ok(mock.gridCategoryCalls.includes("shop"));
    assert.ok(mock.gridCategoryCalls.includes("hat"));
  });
});

test("Cloudflare Worker checks manually listed extra category IDs", async () => {
  const oldProduct = productTile("OLD_SHOP", "OLD SHOP ITEM", "shop", "Shop", "100.00");
  const newProduct = productTile("NEW_EXTRA", "EXTRA CATEGORY ITEM", "unlisted", "Unlisted", "500.00");
  const kv = fakeKV(stateWithSeen([{ pid: "OLD_SHOP", name: "OLD SHOP ITEM" }]));
  const mock = createChromeHeartsFetch({
    root: oldProduct,
    categories: { unlisted: newProduct }
  });

  await withMockedFetch(mock.fetchMock, async () => {
    const result = await runWorkerOnce(
      env(
        {
          DISCOVER_HOMEPAGE_CATEGORIES: "false",
          DISCOVER_SITEMAP_CATEGORIES: "false",
          EXTRA_CATEGORY_IDS: "unlisted"
        },
        kv
      )
    );

    assert.equal(result.alerted, 1);
    assert.deepEqual(result.newPids, ["NEW_EXTRA"]);
    assert.ok(mock.gridCategoryCalls.includes("unlisted"));
  });
});

test("Cloudflare Worker alerts direct product URLs found in sitemap, homepage, and robots", async () => {
  const oldProduct = productTile("OLD_SHOP", "OLD SHOP ITEM", "shop", "Shop", "100.00");
  const directUrls = [
    "https://www.chromehearts.com/hidden/sitemap-drop/SITEMAP_NEW.html",
    "https://www.chromehearts.com/hidden/homepage-drop/HOME_NEW.html",
    "https://www.chromehearts.com/hidden/robots-drop/ROBOTS_NEW.html"
  ];
  const kv = fakeKV(stateWithSeen([{ pid: "OLD_SHOP", name: "OLD SHOP ITEM" }]));
  const mock = createChromeHeartsFetch({
    root: oldProduct,
    sitemapProductUrls: [directUrls[0]],
    homepageProductUrls: [directUrls[1]],
    robotsProductUrls: [directUrls[2]],
    productDetails: {
      SITEMAP_NEW: { name: "SITEMAP DROP", categoryName: "Hidden", price: "100.00" },
      HOME_NEW: { name: "HOME DROP", categoryName: "Hidden", price: "200.00" },
      ROBOTS_NEW: { name: "ROBOTS DROP", categoryName: "Hidden", price: "300.00" }
    }
  });

  await withMockedFetch(mock.fetchMock, async () => {
    const result = await runWorkerOnce(
      env(
        {
          DISCOVER_PRODUCT_URL_CATEGORIES: "false",
          MAX_ALERTS_PER_RUN: "5"
        },
        kv
      )
    );

    assert.equal(result.alerted, 3);
    assert.deepEqual(new Set(result.newPids), new Set(["SITEMAP_NEW", "HOME_NEW", "ROBOTS_NEW"]));
    assert.equal(mock.discordPayloads[0].embeds.length, 3);
  });
});

test("Cloudflare Worker ignores non-product direct URLs from public discovery files", async () => {
  const oldProduct = productTile("OLD_SHOP", "OLD SHOP ITEM", "shop", "Shop", "100.00");
  const kv = fakeKV(stateWithSeen([{ pid: "OLD_SHOP", name: "OLD SHOP ITEM" }]));
  const mock = createChromeHeartsFetch({
    root: oldProduct,
    robotsExtraLines: ["Disallow: /locations.html", "Disallow: /privacy.html"]
  });

  await withMockedFetch(mock.fetchMock, async () => {
    const result = await runWorkerOnce(env({ DISCOVER_PRODUCT_URL_CATEGORIES: "false" }, kv));

    assert.equal(result.alerted, 0);
    assert.deepEqual(result.newPids, []);
    assert.equal(mock.discordPayloads.length, 0);
  });
});

test("Cloudflare Worker defers excess new products without marking them seen", async () => {
  const root = [
    productTile("OLD_SHOP", "OLD SHOP ITEM", "shop", "Shop", "100.00"),
    productTile("NEW_ONE", "NEW ONE", "shop", "Shop", "200.00"),
    productTile("NEW_TWO", "NEW TWO", "shop", "Shop", "300.00"),
    productTile("NEW_THREE", "NEW THREE", "shop", "Shop", "400.00")
  ].join("");
  const kv = fakeKV(stateWithSeen([{ pid: "OLD_SHOP", name: "OLD SHOP ITEM" }]));
  const mock = createChromeHeartsFetch({ root });

  await withMockedFetch(mock.fetchMock, async () => {
    const result = await runWorkerOnce(
      env(
        {
          DISCOVER_HOMEPAGE_CATEGORIES: "false",
          DISCOVER_PRODUCT_URL_CATEGORIES: "false",
          DISCOVER_SITEMAP_CATEGORIES: "false",
          MAX_ALERTS_PER_RUN: "2"
        },
        kv
      )
    );

    const state = JSON.parse(kv.values.get(STATE_KEY));
    assert.equal(result.alerted, 2);
    assert.equal(result.deferred, 1);
    assert.deepEqual(result.newPids, ["NEW_ONE", "NEW_TWO"]);
    assert.ok(state.seen.NEW_ONE);
    assert.ok(state.seen.NEW_TWO);
    assert.equal(state.seen.NEW_THREE, undefined);
    assert.equal(mock.discordPayloads.length, 1);
    assert.equal(mock.discordPayloads[0].embeds.length, 2);
  });
});

test("Cloudflare Worker does not re-alert a same PID after restart or one transient miss", async () => {
  const oldProduct = productTile("OLD_SHOP", "OLD SHOP ITEM", "shop", "Shop", "100.00");
  const relistedProduct = productTile("OLD_RELIST", "OLD RELISTED ITEM", "shop", "Shop", "300.00");
  const kv = fakeKV(
    stateWithSeen([
      { pid: "OLD_SHOP", name: "OLD SHOP ITEM" },
      { pid: "OLD_RELIST", name: "OLD RELISTED ITEM" }
    ])
  );

  const firstMock = createChromeHeartsFetch({ root: oldProduct });
  await withMockedFetch(firstMock.fetchMock, async () => {
    const result = await runWorkerOnce(
      env(
        {
          DISCOVER_HOMEPAGE_CATEGORIES: "false",
          DISCOVER_PRODUCT_URL_CATEGORIES: "false",
          DISCOVER_SITEMAP_CATEGORIES: "false"
        },
        kv
      )
    );

    const state = JSON.parse(kv.values.get(STATE_KEY));
    assert.equal(result.alerted, 0);
    assert.ok(state.seen.OLD_RELIST);
    assert.equal(firstMock.discordPayloads.length, 0);
  });

  kv.values.delete(LOCK_KEY);

  const secondMock = createChromeHeartsFetch({ root: `${oldProduct}${relistedProduct}` });
  await withMockedFetch(secondMock.fetchMock, async () => {
    const result = await runWorkerOnce(
      env(
        {
          DISCOVER_HOMEPAGE_CATEGORIES: "false",
          DISCOVER_PRODUCT_URL_CATEGORIES: "false",
          DISCOVER_SITEMAP_CATEGORIES: "false"
        },
        kv
      )
    );

    assert.equal(result.alerted, 0);
    assert.deepEqual(result.newPids, []);
    assert.equal(secondMock.discordPayloads.length, 0);
  });
});

test("Cloudflare Worker alerts a same PID relist after confirmed absence", async () => {
  const keepProduct = productTile("KEEP_SHOP", "KEEP SHOP ITEM", "shop", "Shop", "100.00");
  const relistedProduct = productTile("OLD_RELIST", "OLD RELISTED ITEM", "shop", "Shop", "300.00");
  const kv = fakeKV(
    stateWithActive([
      { pid: "KEEP_SHOP", name: "KEEP SHOP ITEM" },
      { pid: "OLD_RELIST", name: "OLD RELISTED ITEM" }
    ])
  );
  const stableEnv = {
    DISCOVER_HOMEPAGE_CATEGORIES: "false",
    DISCOVER_PRODUCT_URL_CATEGORIES: "false",
    DISCOVER_SITEMAP_CATEGORIES: "false",
    RELIST_AFTER_ABSENT_RUNS: "2"
  };

  for (let index = 0; index < 2; index += 1) {
    const missingMock = createChromeHeartsFetch({ root: keepProduct });
    await withMockedFetch(missingMock.fetchMock, async () => {
      const result = await runWorkerOnce(env(stableEnv, kv));
      assert.equal(result.alerted, 0);
      assert.equal(missingMock.discordPayloads.length, 0);
    });
    kv.values.delete(LOCK_KEY);
  }

  const stateAfterAbsence = JSON.parse(kv.values.get(STATE_KEY));
  assert.ok(stateAfterAbsence.seen.OLD_RELIST);
  assert.equal(stateAfterAbsence.active.OLD_RELIST, undefined);
  assert.equal(stateAfterAbsence.missing.OLD_RELIST.count, 2);

  const relistMock = createChromeHeartsFetch({
    root: `${keepProduct}${relistedProduct}`,
    productDetails: {
      OLD_RELIST: { name: "OLD RELISTED ITEM", categoryName: "Shop", price: "300.00" }
    }
  });
  await withMockedFetch(relistMock.fetchMock, async () => {
    const result = await runWorkerOnce(env(stableEnv, kv));

    assert.equal(result.alerted, 1);
    assert.deepEqual(result.newPids, ["OLD_RELIST"]);
    assert.equal(relistMock.discordPayloads.length, 1);
    assert.equal(relistMock.discordPayloads[0].embeds[0].title, "OLD RELISTED ITEM");
  });
});

test("Worker dashboard saves multiple webhooks and alerts every server", async () => {
  const oldProduct = productTile("OLD_SHOP", "OLD SHOP ITEM", "shop", "Shop", "100.00");
  const newProduct = productTile("NEW_SHOP", "NEW SHOP ITEM", "shop", "Shop", "200.00");
  const kv = fakeKV(stateWithSeen([{ pid: "OLD_SHOP", name: "OLD SHOP ITEM" }]));
  const testEnv = env({}, kv);
  const webhookUrl = "https://discord.com/api/webhooks/1234567890/runtime-secret-token";
  const webhookUrl2 = "https://discord.com/api/webhooks/9876543210/second-server-token";
  const form = new URLSearchParams({
    discordWebhookUrls: `${webhookUrl}\n${webhookUrl2}`,
    categoryFetchConcurrency: "3",
    checkMinIntervalSeconds: "0",
    maxAlertsPerRun: "1",
    maxCategoryIds: "7",
    maxCategoryPages: "1",
    maxDirectProductUrls: "4",
    maxStorefrontSubrequests: "20",
    maxPages: "1",
    prospectiveCategoryShardSize: "6",
    relistAfterAbsentRuns: "3",
    extraCategoryIds: "hat, jewelry",
    extraProductUrls: "https://www.chromehearts.com/hidden/manual/MANUAL_NEW.html",
    discoverSitemapCategories: "on",
    discoverHomepageCategories: "on",
    discoverProductUrlCategories: "on",
    discoverRobotsProducts: "on"
  });

  const saveResponse = await worker.fetch(
    new Request("https://monitor.test/settings", {
      method: "POST",
      headers: { ...basicAuthHeaders(), "content-type": "application/x-www-form-urlencoded" },
      body: form
    }),
    testEnv
  );

  assert.equal(saveResponse.status, 303);
  assert.equal(saveResponse.headers.get("location"), "/?saved=1");

  const savedSettings = JSON.parse(kv.values.get(SETTINGS_KEY));
  assert.deepEqual(savedSettings.discordWebhookUrls, [webhookUrl, webhookUrl2]);
  assert.equal(savedSettings.discordWebhookUrl, undefined, "legacy single-URL key is migrated away");
  assert.equal(savedSettings.categoryFetchConcurrency, 3);
  assert.equal(savedSettings.maxAlertsPerRun, 1);
  assert.equal(savedSettings.maxDirectProductUrls, 4);
  assert.equal(savedSettings.maxStorefrontSubrequests, 20);
  assert.equal(savedSettings.prospectiveCategoryShardSize, 6);
  assert.deepEqual(savedSettings.extraCategoryIds, ["hat", "jewelry"]);
  assert.deepEqual(savedSettings.extraProductUrls, ["https://www.chromehearts.com/hidden/manual/MANUAL_NEW.html"]);
  assert.equal(savedSettings.discoverRobotsProducts, true);
  assert.equal(savedSettings.probeExactStock, false);

  const dashboardResponse = await worker.fetch(new Request("https://monitor.test/?saved=1", { headers: basicAuthHeaders() }), testEnv);
  const dashboardHtml = await dashboardResponse.text();
  assert.equal(dashboardResponse.status, 200);
  assert.match(dashboardHtml, /2 webhooks active \(dashboard-managed\)/);
  assert.match(dashboardHtml, /Settings saved/);
  assert.equal(dashboardHtml.includes(webhookUrl), false, "webhook URLs are never rendered back");

  const mock = createChromeHeartsFetch({ root: `${oldProduct}${newProduct}` });
  await withMockedFetch(mock.fetchMock, async () => {
    const result = await runWorkerOnce(testEnv);

    assert.equal(result.alerted, 1);
    assert.deepEqual(result.newPids, ["NEW_SHOP"]);
    // The alert fires to BOTH Discord servers.
    assert.deepEqual(new Set(mock.discordUrls), new Set([webhookUrl, webhookUrl2]));
    assert.equal(mock.discordPayloads.length, 2);
  });
});

test("A dead webhook among several does not block delivery to the others", async () => {
  const oldProduct = productTile("OLD_SHOP", "OLD SHOP ITEM", "shop", "Shop", "100.00");
  const newProduct = productTile("NEW_SHOP", "NEW SHOP ITEM", "shop", "Shop", "200.00");
  const goodHook = "https://discord.com/api/webhooks/111/good-token";
  const deadHook = "https://discord.com/api/webhooks/222/dead-token";
  const kv = fakeKV(stateWithSeen([{ pid: "OLD_SHOP", name: "OLD SHOP ITEM" }]));
  const mock = createChromeHeartsFetch({ root: `${oldProduct}${newProduct}` });
  // Override the mock so the dead webhook always 500s.
  const baseFetch = mock.fetchMock;
  const fetchMock = async (input, init = {}) => {
    if (String(input) === deadHook) return new Response("boom", { status: 500 });
    return baseFetch(input, init);
  };

  await withMockedFetch(fetchMock, async () => {
    const result = await runWorkerOnce(
      env(
        {
          DISCORD_WEBHOOK_URL: `${goodHook} ${deadHook}`,
          DISCOVER_HOMEPAGE_CATEGORIES: "false",
          DISCOVER_PRODUCT_URL_CATEGORIES: "false",
          DISCOVER_SITEMAP_CATEGORIES: "false",
          DISCOVER_ROBOTS_PRODUCTS: "false"
        },
        kv
      )
    );

    assert.equal(result.alerted, 1);
    assert.ok(mock.discordUrls.includes(goodHook));
    const state = JSON.parse(kv.values.get(STATE_KEY));
    assert.ok(state.seen.NEW_SHOP, "a successful delivery still commits the item as seen");
  });
});

test("Worker dashboard rejects unsafe runtime settings without overwriting KV", async () => {
  const kv = fakeKV(stateWithSeen([{ pid: "OLD_SHOP", name: "OLD SHOP ITEM" }]));
  kv.values.set(SETTINGS_KEY, JSON.stringify({ maxAlertsPerRun: 2, extraCategoryIds: ["hat"] }));
  const badForm = new URLSearchParams({
    discordWebhookUrl: "https://example.com/not-discord",
    categoryFetchConcurrency: "3",
    checkMinIntervalSeconds: "0",
    maxAlertsPerRun: "500",
    maxCategoryIds: "7",
    maxCategoryPages: "1",
    maxDirectProductUrls: "4",
    maxStorefrontSubrequests: "20",
    maxPages: "1",
    prospectiveCategoryShardSize: "6",
    relistAfterAbsentRuns: "3"
  });

  const response = await worker.fetch(
    new Request("https://monitor.test/settings", {
      method: "POST",
      headers: { ...basicAuthHeaders(), "content-type": "application/x-www-form-urlencoded" },
      body: badForm
    }),
    env({}, kv)
  );
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.match(body.error, /maxAlertsPerRun|Discord webhook/);
  assert.deepEqual(JSON.parse(kv.values.get(SETTINGS_KEY)), { maxAlertsPerRun: 2, extraCategoryIds: ["hat"] });
});

test("extractGridPids pulls unique product IDs from grid HTML with a regex", () => {
  const html = `${productTile("AAA111", "ALPHA", "shop", "Shop")}${productTile("BBB222", "BETA", "shop", "Shop")}`;
  const pids = extractGridPids(html);
  assert.deepEqual([...pids].sort(), ["AAA111", "BBB222"]);
});

test("Fast tick alerts a new root-grid product without marking unscanned items missing", async () => {
  const keep = productTile("KEEP_SHOP", "KEEP SHOP ITEM", "shop", "Shop", "100.00");
  const fresh = productTile("FAST_NEW", "FAST NEW DROP", "shop", "Shop", "250.00");
  const kv = fakeKV(
    stateWithActive([
      { pid: "KEEP_SHOP", name: "KEEP SHOP ITEM" },
      { pid: "GONE_SHOP", name: "GONE SHOP ITEM" }
    ])
  );
  const mock = createChromeHeartsFetch({
    root: `${keep}${fresh}`,
    productDetails: { FAST_NEW: { name: "FAST NEW DROP", categoryName: "Shop", price: "250.00" } }
  });

  await withMockedFetch(mock.fetchMock, async () => {
    const result = await runWorkerFastOnce(fastEnv({}, kv));

    assert.equal(result.mode, "fast");
    assert.equal(result.alerted, 1);
    assert.deepEqual(result.newPids, ["FAST_NEW"]);

    const state = JSON.parse(kv.values.get(STATE_KEY));
    assert.ok(state.seen.FAST_NEW);
    assert.ok(state.active.FAST_NEW);
    assert.equal(state.missing.GONE_SHOP, undefined, "partial sweep must not flag unscanned items missing");
    assert.ok(state.active.GONE_SHOP, "absent-from-shard product stays active on a partial sweep");
    assert.equal(mock.discordPayloads.length, 1);
    assert.equal(mock.discordPayloads[0].embeds[0].title, "FAST NEW DROP");
  });
});

test("Fast tick with no new products sends nothing and skips the KV write", async () => {
  const keep = productTile("KEEP_SHOP", "KEEP SHOP ITEM", "shop", "Shop", "100.00");
  const kv = fakeKV(stateWithActive([{ pid: "KEEP_SHOP", name: "KEEP SHOP ITEM" }]));
  const before = kv.values.get(STATE_KEY);
  const mock = createChromeHeartsFetch({ root: keep });

  await withMockedFetch(mock.fetchMock, async () => {
    const result = await runWorkerFastOnce(fastEnv({}, kv));

    assert.equal(result.mode, "fast");
    assert.equal(result.alerted, 0);
    assert.deepEqual(result.newPids, []);
    assert.equal(mock.discordPayloads.length, 0);
    assert.equal(kv.values.get(STATE_KEY), before, "quiet fast tick must not rewrite catalog state");
  });
});

test("Fast tick before any baseline defers instead of alerting the whole shard", async () => {
  const fresh = productTile("FIRST_NEW", "FIRST NEW", "shop", "Shop", "250.00");
  const kv = fakeKV(stateWithSeen([]));
  const mock = createChromeHeartsFetch({ root: fresh });

  await withMockedFetch(mock.fetchMock, async () => {
    const result = await runWorkerFastOnce(fastEnv({}, kv));

    assert.equal(result.skipped, true);
    assert.equal(result.reason, "awaiting-baseline");
    assert.equal(mock.discordPayloads.length, 0);
  });
});

test("Alert still sends from grid data when the subrequest budget is exhausted", async () => {
  const oldProduct = productTile("OLD_SHOP", "OLD SHOP ITEM", "shop", "Shop", "100.00");
  const newProduct = productTile("BUDGET_NEW", "BUDGET DROP", "shop", "Shop", "450.00");
  const kv = fakeKV(stateWithSeen([{ pid: "OLD_SHOP", name: "OLD SHOP ITEM" }]));
  const mock = createChromeHeartsFetch({ root: `${oldProduct}${newProduct}` });

  await withMockedFetch(mock.fetchMock, async () => {
    const result = await runWorkerOnce(
      env(
        {
          DISCOVER_HOMEPAGE_CATEGORIES: "false",
          DISCOVER_PRODUCT_URL_CATEGORIES: "false",
          DISCOVER_SITEMAP_CATEGORIES: "false",
          DISCOVER_ROBOTS_PRODUCTS: "false",
          MAX_DIRECT_PRODUCT_URLS: "0",
          SUBREQUEST_HARD_CAP: "0"
        },
        kv
      )
    );

    assert.equal(result.alerted, 1);
    assert.deepEqual(result.newPids, ["BUDGET_NEW"]);
    assert.equal(mock.discordPayloads.length, 1, "Discord send must never be sacrificed to the budget");
    const embed = mock.discordPayloads[0].embeds[0];
    assert.equal(embed.title, "BUDGET DROP");
    const details = embed.fields.find((field) => field.name === "Details");
    assert.match(details.value, /subrequest budget/);
  });
});

test("DO-managed quiet full sweep skips the KV write entirely", async () => {
  const keep = productTile("KEEP_SHOP", "KEEP SHOP ITEM", "shop", "Shop", "100.00");
  const kv = fakeKV(stateWithActive([{ pid: "KEEP_SHOP", name: "KEEP SHOP ITEM" }]));
  const testEnv = env(
    {
      DISCOVER_HOMEPAGE_CATEGORIES: "false",
      DISCOVER_PRODUCT_URL_CATEGORIES: "false",
      DISCOVER_SITEMAP_CATEGORIES: "false",
      DISCOVER_ROBOTS_PRODUCTS: "false",
      MAX_DIRECT_PRODUCT_URLS: "0"
    },
    kv
  );
  const mock = createChromeHeartsFetch({ root: keep });

  await withMockedFetch(mock.fetchMock, async () => {
    const first = await runMonitor(testEnv, null, { mode: "full", skipLock: true, prospectiveCursor: 0 });
    assert.equal(first.kvWrite, true, "first sweep records lastRunAt/activeCategoryIds");
    assert.ok(Number.isInteger(first.nextProspectiveCursor), "full sweep reports the DO-owned rotation cursor");

    const before = kv.values.get(STATE_KEY);
    const second = await runMonitor(testEnv, null, {
      mode: "full",
      skipLock: true,
      prospectiveCursor: first.nextProspectiveCursor
    });
    assert.equal(second.kvWrite, false, "unchanged catalog must not burn a KV write");
    assert.equal(kv.values.get(STATE_KEY), before);
    assert.equal(mock.discordPayloads.length, 0);
  });
});

test("Full sweep alerts a product visible only via the cross-category search lane", async () => {
  const oldProduct = productTile("OLD_SHOP", "OLD SHOP ITEM", "shop", "Shop", "100.00");
  const hiddenDrop = productTile("SEARCH_ONLY", "SEARCH ONLY DROP", "mystery-category", "Mystery", "990.00");
  const kv = fakeKV(stateWithSeen([{ pid: "OLD_SHOP", name: "OLD SHOP ITEM" }]));
  const mock = createChromeHeartsFetch({
    root: oldProduct,
    searches: { chrome: `${oldProduct}${hiddenDrop}` },
    productDetails: {
      SEARCH_ONLY: { name: "SEARCH ONLY DROP", categoryName: "Mystery", price: "990.00" }
    }
  });

  await withMockedFetch(mock.fetchMock, async () => {
    const result = await runWorkerOnce(
      env(
        {
          DISCOVER_HOMEPAGE_CATEGORIES: "false",
          DISCOVER_PRODUCT_URL_CATEGORIES: "false",
          DISCOVER_SITEMAP_CATEGORIES: "false",
          DISCOVER_ROBOTS_PRODUCTS: "false"
        },
        kv
      )
    );

    assert.equal(result.alerted, 1);
    assert.deepEqual(result.newPids, ["SEARCH_ONLY"]);
    assert.ok(mock.searchCalls.includes("chrome"));
    assert.equal(result.sweep.newFromSearch, 1);
    assert.equal(mock.discordPayloads[0].embeds[0].title, "SEARCH ONLY DROP");

    const state = JSON.parse(kv.values.get(STATE_KEY));
    assert.ok(state.knownCategoryIds.includes("mystery-category"));
  });
});

test("Fast tick alerts a product visible only via the search lane", async () => {
  const keep = productTile("KEEP_SHOP", "KEEP SHOP ITEM", "shop", "Shop", "100.00");
  const hiddenDrop = productTile("FAST_SEARCH_ONLY", "FAST SEARCH DROP", "mystery-category", "Mystery", "450.00");
  const kv = fakeKV(stateWithActive([{ pid: "KEEP_SHOP", name: "KEEP SHOP ITEM" }]));
  const mock = createChromeHeartsFetch({
    root: keep,
    searches: { hearts: hiddenDrop },
    productDetails: {
      FAST_SEARCH_ONLY: { name: "FAST SEARCH DROP", categoryName: "Mystery", price: "450.00" }
    }
  });

  await withMockedFetch(mock.fetchMock, async () => {
    const result = await runWorkerFastOnce(fastEnv({}, kv));

    assert.equal(result.mode, "fast");
    assert.equal(result.alerted, 1);
    assert.deepEqual(result.newPids, ["FAST_SEARCH_ONLY"]);
    assert.ok(mock.searchCalls.includes("hearts"));
    assert.equal(mock.discordPayloads[0].embeds[0].title, "FAST SEARCH DROP");
  });
});

test("Fast tick fans the whole category universe out through the SELF binding", async () => {
  const keep = productTile("KEEP_SHOP", "KEEP SHOP ITEM", "shop", "Shop", "100.00");
  const deepDrop = productTile("DEEP_NEW", "DEEP UNIVERSE DROP", "deep-category", "Deep", "800.00");
  const kv = fakeKV(stateWithActive([{ pid: "KEEP_SHOP", name: "KEEP SHOP ITEM" }]));
  const requestedCgids = [];
  const self = {
    async fetch(_url, init) {
      const { cgids } = JSON.parse(init.body);
      requestedCgids.push(...cgids);
      const products = {};
      if (cgids.includes("deep-category")) {
        products.DEEP_NEW = {
          pid: "DEEP_NEW",
          name: "DEEP UNIVERSE DROP",
          price: "800.00",
          brand: "Chrome Hearts",
          category: "Deep",
          productType: "master",
          url: "https://www.chromehearts.com/deep-category/deep-universe-drop/DEEP_NEW.html",
          image: ""
        };
      }
      return new Response(JSON.stringify({ ok: true, products, activeCgids: [], failed: [], scanned: cgids.length }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
  };
  const universe = [...Array.from({ length: 30 }, (_, index) => `filler-${index}`), "deep-category"].join(",");
  const mock = createChromeHeartsFetch({
    root: keep,
    productDetails: { DEEP_NEW: { name: "DEEP UNIVERSE DROP", categoryName: "Deep", price: "800.00" } }
  });

  await withMockedFetch(mock.fetchMock, async () => {
    const testEnv = { ...env({ PROSPECTIVE_CATEGORY_IDS: universe, FAST_CATEGORY_SHARD_SIZE: "5" }, kv), SELF: self };
    const response = await worker.fetch(new Request("https://monitor.test/api/cron?mode=fast", { headers: authHeaders() }), testEnv);
    const result = await response.json();

    assert.equal(result.alerted, 1);
    assert.deepEqual(result.newPids, ["DEEP_NEW"]);
    assert.ok(requestedCgids.includes("deep-category"), "fan-out must cover the whole universe in one tick");
    assert.equal(result.fast.fanoutSlices > 0, true);
    assert.equal(mock.discordPayloads[0].embeds[0].title, "DEEP UNIVERSE DROP");
  });
});

test("Fan-out query terms catch a product whose category grid is empty (CH SCARF case)", async () => {
  const keep = productTile("KEEP_SHOP", "KEEP SHOP ITEM", "shop", "Shop", "100.00");
  const kv = fakeKV(stateWithActive([{ pid: "KEEP_SHOP", name: "KEEP SHOP ITEM" }]));
  const requestedQueries = [];
  const self = {
    async fetch(_url, init) {
      const { cgids = [], queries = [] } = JSON.parse(init.body);
      requestedQueries.push(...queries);
      const products = {};
      if (queries.includes("scarf")) {
        products.SCARF_NEW = {
          pid: "SCARF_NEW",
          name: "CH SCARF",
          price: "1200.00",
          brand: "Chrome Hearts",
          category: "scarf",
          productType: "master",
          url: "https://www.chromehearts.com/scarf/ch-scarf/SCARF_NEW.html",
          image: ""
        };
      }
      return new Response(JSON.stringify({ ok: true, products, activeCgids: [], failed: [], scanned: cgids.length + queries.length }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
  };
  const mock = createChromeHeartsFetch({
    root: keep,
    productDetails: { SCARF_NEW: { name: "CH SCARF", categoryName: "scarf", price: "1200.00" } }
  });

  await withMockedFetch(mock.fetchMock, async () => {
    const testEnv = { ...env({ PROSPECTIVE_CATEGORY_IDS: "scarf,hat" }, kv), SELF: self };
    const response = await worker.fetch(new Request("https://monitor.test/api/cron?mode=fast", { headers: authHeaders() }), testEnv);
    const result = await response.json();

    assert.equal(result.alerted, 1);
    assert.deepEqual(result.newPids, ["SCARF_NEW"]);
    assert.ok(requestedQueries.includes("scarf"), "the whole-word query universe must be fanned out");
    assert.equal(mock.discordPayloads[0].embeds[0].title, "CH SCARF");
  });
});

test("Fast tick falls back to shard rotation when the SELF binding is absent", async () => {
  const keep = productTile("KEEP_SHOP", "KEEP SHOP ITEM", "shop", "Shop", "100.00");
  const kv = fakeKV(stateWithActive([{ pid: "KEEP_SHOP", name: "KEEP SHOP ITEM" }]));
  const mock = createChromeHeartsFetch({ root: keep });

  await withMockedFetch(mock.fetchMock, async () => {
    const result = await runWorkerFastOnce(
      env({ PROSPECTIVE_CATEGORY_IDS: "cat-a,cat-b,cat-c,cat-d", FAST_CATEGORY_SHARD_SIZE: "2" }, kv)
    );

    assert.equal(result.fast.fanoutSlices, null);
    assert.equal(result.fast.shardSize, 2);
    assert.equal(result.nextFastCursor, 2, "cursor advances only in fallback rotation mode");
  });
});

test("productUrlFromUrl accepts every real product URL shape other monitors caught", () => {
  const accepted = [
    "https://www.chromehearts.com/silichrome/silichrome-cross-pendant-and-earring/175364_214824.html",
    "https://www.chromehearts.com/dipped-in-blue/ch-dib-orange-tiger/207213_207214-1.html",
    "https://www.chromehearts.com/scarf/ch-scarf/075372A7TXXX007.html",
    "https://www.chromehearts.com/eyewear/blueher/21762020UE53D14.html",
    "https://www.chromehearts.com/sweatbands/053669BLKOSZD62.html",
    "https://www.chromehearts.com/after-school-flannel-shorts/213616AZJXSM00D.html",
    // 1-segment root product from the Internet Archive
    "https://www.chromehearts.com/035699_035701.html"
  ];
  for (const url of accepted) {
    assert.equal(productUrlFromUrl(url), url, `must accept ${url}`);
  }
  // Non-product 2-segment pages must stay rejected
  assert.equal(productUrlFromUrl("https://www.chromehearts.com/customer-service/faq.html"), "");
  assert.equal(productUrlFromUrl("https://www.chromehearts.com/legal/privacy.html"), "");
});

test("Category status transitions flag creation and activation, not noise", () => {
  const previous = {
    scarf: 302,
    goggles: 404,
    silichrome: 301,
    hat: 301,
    socks: 200,
    flaky: 301,
    newone: undefined
  };
  const current = {
    scarf: 302, // unchanged -> no transition
    goggles: 301, // 404 -> 301: category CREATED -> alert
    silichrome: 302, // 301 -> 302: dormant ACTIVATED -> alert
    hat: 200, // 301 -> 200: went public -> alert
    socks: 404, // 200 -> 404: removed -> transition but not interesting
    flaky: 0, // probe failed -> never a transition
    brandnew: 301 // first sighting -> baseline, no transition
  };

  const transitions = categoryStatusTransitions(previous, current);
  const interesting = transitions.filter(interestingCategoryTransition).map((t) => t.cgid).sort();
  assert.deepEqual(interesting, ["goggles", "hat", "silichrome"]);
  assert.equal(transitions.some((t) => t.cgid === "flaky"), false, "failed probes are not transitions");
  assert.equal(transitions.some((t) => t.cgid === "brandnew"), false, "first sighting is baseline");

  const discovered = discoveredCategories(previous, current);
  assert.deepEqual(discovered, [{ cgid: "brandnew", status: 301 }]);
  assert.equal(discoveredCategories(previous, { deadnew: 404 }).length, 0, "dead first-sightings stay silent");
});

test("Worker dashboard and health pages are private", async () => {
  const kv = fakeKV(stateWithSeen([{ pid: "OLD_SHOP", name: "OLD SHOP ITEM" }]));
  const testEnv = env({}, kv);

  const unauthorized = await worker.fetch(new Request("https://monitor.test/health"), testEnv);
  assert.equal(unauthorized.status, 401);
  assert.match(unauthorized.headers.get("www-authenticate") || "", /Basic realm/);

  const authorized = await worker.fetch(new Request("https://monitor.test/health", { headers: basicAuthHeaders() }), testEnv);
  const body = await authorized.json();
  assert.equal(authorized.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.seen, 1);
});
