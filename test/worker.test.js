import assert from "node:assert/strict";
import test from "node:test";
import worker, {
  extractGridPids,
  runMonitor,
  productUrlFromUrl,
  categoryStatusTransitions,
  interestingCategoryTransition,
  discoveredCategories,
  pidFromProductUrl,
  stagedNameFromUrl,
  parseHotWatchProbe,
  applyPlanPreset,
  buildCatalogState,
  parsePidParts,
  minePidCandidates,
  enumerationCandidates,
  updateStyleRegistry
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
  const now = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
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
    PING_FIRST_ALERTS: "false",
    REQUEST_TIMEOUT_MS: "1000",
    PROSPECTIVE_CATEGORY_SHARD_SIZE: "24",
    WEBHOOK_TIMEOUT_MS: "1000",
    ...overrides
  };
}

function withStagingBaseline(state) {
  return {
    ...state,
    stagingBaselinedAt: state.createdAt,
    hotWatch: {},
    sitemapIndexLastmod: "",
    sitemapCategoryIds: []
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
  rootPages = null,
  categories = {},
  searches = {},
  sitemapCategories = [],
  sitemapProductUrls = [],
  homepageCategories = [],
  homepageProductUrls = [],
  robotsProductUrls = [],
  robotsExtraLines = [],
  productDetails = {},
  productVariations = {},
  unknownPidsReturn500 = false
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
      if (cgid === "root" && Array.isArray(rootPages)) {
        const sz = Number(url.searchParams.get("sz")) || 200;
        const start = Number(url.searchParams.get("start")) || 0;
        const index = Math.floor(start / Math.max(1, sz));
        const page = rootPages[index] || "";
        const hasNext = index + 1 < rootPages.length;
        const showMore = hasNext
          ? `<div class="show-more"><button data-url="https://www.chromehearts.com/on/demandware.store/Sites-ChromeHearts-Site/en_US/Search-UpdateGrid?cgid=root&amp;start=${(index + 1) * sz}&amp;sz=${sz}">More</button></div>`
          : "";
        return new Response(page + showMore, { status: 200, headers: { "content-type": "text/html" } });
      }
      return new Response(cgid === "root" ? root : categories[cgid] || "", {
        status: 200,
        headers: { "content-type": "text/html" }
      });
    }

    if (url.pathname.includes("/Product-Variation")) {
      const variationPid = url.searchParams.get("pid") || "UNKNOWN";
      if (productVariations[variationPid]) {
        return new Response(JSON.stringify(productVariations[variationPid]), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (unknownPidsReturn500) {
        return new Response("<html>error</html>", { status: 500, headers: { "content-type": "text/html" } });
      }
      return new Response(JSON.stringify(variationJson(variationPid)), { status: 200, headers: { "content-type": "application/json" } });
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

test("/webhooks chips: add with a name, remove one by X, remove several, set MAIN, opt in to intel", async () => {
  const kv = fakeKV(stateWithSeen([{ pid: "OLD_SHOP", name: "OLD SHOP ITEM" }]));
  const secretHook = "https://discord.com/api/webhooks/999/secret";
  const testEnv = env({ DISCORD_WEBHOOK_URL: secretHook }, kv);
  const hookA = "https://discord.com/api/webhooks/111/aaa";
  const hookB = "https://discord.com/api/webhooks/222/bbb";
  const hookC = "https://discord.com/api/webhooks/333/ccc";
  const saved = () => JSON.parse(kv.values.get(SETTINGS_KEY));
  const postWebhooks = (params) => {
    const body = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      for (const item of Array.isArray(value) ? value : [value]) body.append(key, item);
    }
    return worker.fetch(
      new Request("https://monitor.test/webhooks", {
        method: "POST",
        headers: { ...basicAuthHeaders(), "content-type": "application/x-www-form-urlencoded" },
        body
      }),
      testEnv
    );
  };

  let response = await postWebhooks({ discordWebhookUrls: hookA, webhookName: "Main server" });
  assert.equal(response.status, 303);
  assert.deepEqual(saved().discordWebhookUrls, [secretHook, hookA], "the secret webhook is kept, not replaced");
  assert.equal(saved().discordWebhookNames["111"], "Main server");

  await postWebhooks({ discordWebhookUrls: hookB, webhookName: "Friends" });
  await postWebhooks({ discordWebhookUrls: hookC });
  assert.deepEqual(saved().discordWebhookUrls, [secretHook, hookA, hookB, hookC]);

  await postWebhooks({ remove: "222" });
  assert.deepEqual(saved().discordWebhookUrls, [secretHook, hookA, hookC]);
  assert.equal(saved().discordWebhookNames["222"], undefined, "its label is dropped too");

  await postWebhooks({ webhookPrefs: "1", mainWebhook: "333", verbose: "111" });
  assert.equal(saved().discordMainWebhookUrl, hookC, "MAIN is settable from the dashboard");
  assert.deepEqual(saved().discordWebhookVerbose, ["111"]);

  // Ticking several chips removes them together.
  await postWebhooks({ selected: ["111", "333"] });
  assert.deepEqual(saved().discordWebhookUrls, [secretHook], "only the untouched secret webhook remains");
  await postWebhooks({ remove: "999" });
  assert.equal(saved().discordWebhookUrls, undefined, "a secret-configured webhook is removable by its chip too");
  assert.equal(saved().discordMainWebhookUrl, undefined, "a MAIN that no longer exists is not kept");

  // A bad URL is rejected without corrupting the saved list.
  await postWebhooks({ discordWebhookUrls: hookA });
  const bad = await postWebhooks({ discordWebhookUrls: "https://example.com/not-discord" });
  assert.equal(bad.status, 400);
  assert.deepEqual(saved().discordWebhookUrls, [secretHook, hookA]);

  // Explicit clear still works.
  await postWebhooks({ clearDiscordWebhook: "on" });
  assert.equal(saved().discordWebhookUrls, undefined);
});
test("Dashboard renders webhook chips with names, MAIN, and masked tokens", async () => {
  const kv = fakeKV(stateWithSeen([{ pid: "OLD_SHOP", name: "OLD SHOP ITEM" }]));
  kv.values.set(
    SETTINGS_KEY,
    JSON.stringify({
      discordWebhookUrls: [
        "https://discord.com/api/webhooks/424242/supersecrettoken",
        "https://discord.com/api/webhooks/515151/othersecrettoken"
      ],
      discordWebhookNames: { "424242": "Main server" },
      discordMainWebhookUrl: "https://discord.com/api/webhooks/424242/supersecrettoken",
      discordWebhookVerbose: ["515151"]
    })
  );
  const testEnv = env({ FAST_POLL_INTERVAL_SECONDS: "12" }, kv);

  const response = await worker.fetch(new Request("https://monitor.test/?webhooks=2", { headers: basicAuthHeaders() }), testEnv);
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(html, /Discord webhooks/);
  assert.match(html, /2 webhooks active \(dashboard-managed\)/);
  assert.match(html, /Main server/, "custom name is shown on the chip");
  assert.match(html, /discord\.com\/…\/424242\/\*\*\*\*/, "webhook id shown, token masked");
  assert.equal(html.includes("supersecrettoken"), false, "token never rendered");
  assert.equal(html.includes("othersecrettoken"), false, "no token is ever rendered");
  assert.match(html, /name="mainWebhook" value="424242" checked/);
  assert.match(html, /Webhook 5151/);
  assert.match(html, /name="verbose" value="515151" checked/, "per-webhook intel opt-in reflects saved state");
  assert.match(html, /name="remove" value="424242"/, "each chip has its own remove control");
  assert.match(html, /Live within ~12s/);
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
  const kv = fakeKV(withStagingBaseline(stateWithActive([{ pid: "KEEP_SHOP", name: "KEEP SHOP ITEM" }])));
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

// ---- Staging watch / hot-watch lane ----

function stagedVariation(pid, { live = false, name = "CORD SLIPPERS" } = {}) {
  return {
    product: {
      id: pid,
      masterProductId: pid,
      productName: name,
      productType: "master",
      available: live,
      readyToOrder: live,
      price: { sales: { value: live ? 1155 : null, currency: live ? "USD" : null } },
      availability: { messages: live ? ["In Stock"] : [] },
      variationAttributes: [{ id: "size", values: [{ id: "OSZ", displayValue: "OS", selectable: live }] }],
      images: live ? { large: [{ url: "/dw/image/v2/slippers.png" }] } : {},
      selectedProductUrl: `/slippers/cord-slippers/${pid}.html?quantity=1`,
      online: live
    }
  };
}

test("pidFromProductUrl and stagedNameFromUrl parse robots-staged hidden product URLs", () => {
  const stagedUrl = "https://www.chromehearts.com/t-shirt/short-sleeve-pocket-crew/129111BLKXXX756.html?fadeIn=true&dwvar_129111BLKXXX756_size=XSM";
  assert.equal(pidFromProductUrl(stagedUrl), "129111BLKXXX756");
  assert.equal(stagedNameFromUrl(stagedUrl), "SHORT SLEEVE POCKET CREW");
  assert.equal(pidFromProductUrl("https://www.chromehearts.com/slippers/cord-slippers/180539C4CXXX593.html"), "180539C4CXXX593");
  assert.equal(pidFromProductUrl("https://www.chromehearts.com/shop"), "", "non-PDP paths are not PIDs");
  assert.equal(pidFromProductUrl("https://www.chromehearts.com/scents/spirit.html"), "", "non-PID-like segments rejected");
});

test("parseHotWatchProbe treats staged and sold-out products as not purchasable", () => {
  const pid = "180539C4CXXX593";
  const staged = parseHotWatchProbe(stagedVariation(pid, { live: false }), pid);
  assert.equal(staged.purchasable, false, "no price + not orderable = staged, not buyable");

  const live = parseHotWatchProbe(stagedVariation(pid, { live: true }), pid);
  assert.equal(live.purchasable, true);
  assert.equal(live.name, "CORD SLIPPERS");
  assert.equal(live.price, "1155");
  assert.match(live.image, /slippers\.png/);
  assert.equal(live.inStockSizeCount, 1);

  const soldOut = stagedVariation(pid, { live: true });
  soldOut.product.available = false;
  soldOut.product.readyToOrder = false;
  soldOut.product.variationAttributes[0].values[0].selectable = false;
  assert.equal(parseHotWatchProbe(soldOut, pid).purchasable, false);
});

test("applyPlanPreset retunes cadence and budgets for Workers Paid, never for free", () => {
  const freeCfg = {
    workersPlan: "free",
    fastPollIntervalSeconds: 12,
    fastMaxCategories: 36,
    maxStorefrontSubrequests: 40,
    subrequestHardCap: 46,
    maxCategoryIds: 250,
    categoryFetchConcurrency: 20,
    discoveryEveryFullSweeps: 10,
    hotWatchLimit: 12,
    probeBudgetPerTick: 26
  };
  assert.equal(applyPlanPreset(freeCfg), freeCfg, "free plan passes through untouched");

  const paid = applyPlanPreset({ ...freeCfg, workersPlan: "paid" });
  assert.equal(paid.fastPollIntervalSeconds, 6);
  assert.equal(paid.fastMaxCategories, 220);
  assert.equal(paid.maxStorefrontSubrequests, 260);
  assert.equal(paid.subrequestHardCap, 950);
  assert.equal(paid.hotWatchLimit, 48);
  assert.equal(paid.probeBudgetPerTick, 60);
});

test("buildCatalogState gives freshly-seen products an index-lag grace before missing", () => {
  const cfg = { relistAfterAbsentRuns: 2, freshMissingGraceMinutes: 30 };
  const fresh = new Date().toISOString();
  const old = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
  const state = {
    seen: {
      FRESH_PID: { pid: "FRESH_PID", firstSeenAt: fresh },
      OLD_PID: { pid: "OLD_PID", firstSeenAt: old }
    },
    active: {
      FRESH_PID: { pid: "FRESH_PID", firstSeenAt: fresh },
      OLD_PID: { pid: "OLD_PID", firstSeenAt: old }
    },
    missing: {}
  };

  const next = buildCatalogState({}, state, new Set(), cfg, { partial: false });
  assert.equal(next.missing.FRESH_PID, undefined, "a just-alerted product must not count absence during index lag");
  assert.ok(next.missing.OLD_PID, "established products still track absence normally");
});

test("Staging lane hot-watches a robots-staged product and alerts the instant it turns purchasable", async () => {
  const keep = productTile("KEEP_SHOP", "KEEP SHOP ITEM", "shop", "Shop", "100.00");
  const pid = "180539C4CXXX593";
  const stagedUrl = `https://www.chromehearts.com/slippers/cord-slippers/${pid}.html`;
  const kv = fakeKV(stateWithActive([{ pid: "KEEP_SHOP", name: "KEEP SHOP ITEM" }]));
  const stagingEnv = {
    DISCOVER_HOMEPAGE_CATEGORIES: "false",
    DISCOVER_PRODUCT_URL_CATEGORIES: "false",
    DISCOVER_SITEMAP_CATEGORIES: "false",
    MAX_DIRECT_PRODUCT_URLS: "0",
    ENUMERATION_ENABLED: "false"
  };

  const baselineMock = createChromeHeartsFetch({
    root: keep,
    robotsProductUrls: [stagedUrl],
    productVariations: { [pid]: stagedVariation(pid, { live: false }) }
  });
  await withMockedFetch(baselineMock.fetchMock, async () => {
    const result = await runWorkerOnce(env(stagingEnv, kv));
    assert.equal(result.alerted, 0);
    assert.equal(result.staging.discoveries, 1);
    assert.equal(baselineMock.discordPayloads.length, 0, "baseline discoveries must not ping");
    const state = JSON.parse(kv.values.get(STATE_KEY));
    assert.ok(state.hotWatch[pid], "staged PID enters the hot-watch map");
    assert.ok(state.stagingBaselinedAt);
    assert.equal(state.seen[pid], undefined, "staged-but-unbuyable products stay out of seen");
  });
  kv.values.delete(LOCK_KEY);

  const waitingMock = createChromeHeartsFetch({
    root: keep,
    robotsProductUrls: [stagedUrl],
    productVariations: { [pid]: stagedVariation(pid, { live: false }) }
  });
  await withMockedFetch(waitingMock.fetchMock, async () => {
    const result = await runWorkerOnce(env(stagingEnv, kv));
    assert.equal(result.alerted, 0);
    assert.equal(result.staging.probed, 1, "hot-watch PID is probed via Product-Variation");
    assert.equal(result.staging.live, 0);
    assert.equal(waitingMock.discordPayloads.length, 0);
  });
  kv.values.delete(LOCK_KEY);

  const liveMock = createChromeHeartsFetch({
    root: keep,
    robotsProductUrls: [stagedUrl],
    productVariations: { [pid]: stagedVariation(pid, { live: true }) },
    productDetails: { [pid]: { name: "CORD SLIPPERS", categoryName: "Slippers", price: "1155.00" } }
  });
  await withMockedFetch(liveMock.fetchMock, async () => {
    const result = await runWorkerOnce(env(stagingEnv, kv));
    assert.equal(result.alerted, 1);
    assert.deepEqual(result.newPids, [pid]);
    assert.equal(result.staging.live, 1);
    assert.equal(liveMock.discordPayloads.length, 1);
    assert.equal(liveMock.discordPayloads[0].embeds[0].title, "CORD SLIPPERS");

    const state = JSON.parse(kv.values.get(STATE_KEY));
    assert.ok(state.seen[pid], "alerted hot-watch product is now seen");
    assert.equal(state.hotWatch[pid], undefined, "alerted product graduates out of the hot-watch map");
  });
});

test("Staging lane pings new staged discoveries after baseline, once", async () => {
  const keep = productTile("KEEP_SHOP", "KEEP SHOP ITEM", "shop", "Shop", "100.00");
  const pid = "175364BLKXXX001";
  const stagedUrl = `https://www.chromehearts.com/hoodie/deadly-doll-hoodie/${pid}.html`;
  const kv = fakeKV(withStagingBaseline(stateWithActive([{ pid: "KEEP_SHOP", name: "KEEP SHOP ITEM" }])));
  const stagingEnv = {
    DISCOVER_HOMEPAGE_CATEGORIES: "false",
    DISCOVER_PRODUCT_URL_CATEGORIES: "false",
    DISCOVER_SITEMAP_CATEGORIES: "false",
    MAX_DIRECT_PRODUCT_URLS: "0",
    ENUMERATION_ENABLED: "false",
    STAGED_INTEL_PINGS: "true"
  };

  const mock = createChromeHeartsFetch({
    root: keep,
    robotsProductUrls: [stagedUrl],
    productVariations: { [pid]: stagedVariation(pid, { live: false, name: "DEADLY DOLL HOODIE" }) }
  });
  await withMockedFetch(mock.fetchMock, async () => {
    const result = await runWorkerOnce(env(stagingEnv, kv));
    assert.equal(result.alerted, 0);
    assert.equal(result.staging.discoveries, 1);
    assert.equal(mock.discordPayloads.length, 1, "post-baseline staged discovery pings once");
    assert.match(mock.discordPayloads[0].content, /STAGED ITEM/);
    assert.match(mock.discordPayloads[0].content, /DEADLY DOLL HOODIE/);
    assert.equal(mock.discordPayloads[0].embeds, undefined, "staged ping is content-only");
  });
  kv.values.delete(LOCK_KEY);

  const repeatMock = createChromeHeartsFetch({
    root: keep,
    robotsProductUrls: [stagedUrl],
    productVariations: { [pid]: stagedVariation(pid, { live: false, name: "DEADLY DOLL HOODIE" }) }
  });
  await withMockedFetch(repeatMock.fetchMock, async () => {
    await runWorkerOnce(env(stagingEnv, kv));
    assert.equal(repeatMock.discordPayloads.length, 0, "no duplicate staged pings");
  });
});

test("Staging lane pings a sitemap category addition and feeds it to the scan pool", async () => {
  const keep = productTile("KEEP_SHOP", "KEEP SHOP ITEM", "shop", "Shop", "100.00");
  const kv = fakeKV(stateWithActive([{ pid: "KEEP_SHOP", name: "KEEP SHOP ITEM" }]));
  const stagingEnv = {
    DISCOVER_HOMEPAGE_CATEGORIES: "false",
    DISCOVER_PRODUCT_URL_CATEGORIES: "false",
    MAX_DIRECT_PRODUCT_URLS: "0",
    ENUMERATION_ENABLED: "false",
    STAGED_INTEL_PINGS: "true"
  };

  // Run 1 baselines the current sitemap category set.
  const baselineMock = createChromeHeartsFetch({ root: keep, sitemapCategories: ["shop"] });
  await withMockedFetch(baselineMock.fetchMock, async () => {
    await runWorkerOnce(env(stagingEnv, kv));
    assert.equal(baselineMock.discordPayloads.length, 0);
    const state = JSON.parse(kv.values.get(STATE_KEY));
    assert.deepEqual(state.sitemapCategoryIds, ["shop"]);
  });
  kv.values.delete(LOCK_KEY);

  const hatMock = createChromeHeartsFetch({ root: keep, sitemapCategories: ["shop", "hat"] });
  await withMockedFetch(hatMock.fetchMock, async () => {
    await runWorkerOnce(env(stagingEnv, kv));
    const pings = hatMock.discordPayloads.filter((payload) => /SITEMAP/.test(payload.content || ""));
    assert.equal(pings.length, 1, "sitemap category addition pings once");
    assert.match(pings[0].content, /\/hat/);
    const state = JSON.parse(kv.values.get(STATE_KEY));
    assert.ok(state.sitemapCategoryIds.includes("hat"), "new sitemap category persists into the scan pool");
  });
});

test("Ping-first alert fires a compact link ping alongside the rich embed", async () => {
  const oldProduct = productTile("OLD_SHOP", "OLD SHOP ITEM", "shop", "Shop", "100.00");
  const newProduct = productTile("PING_NEW", "PING DROP", "shop", "Shop", "450.00");
  const kv = fakeKV(withStagingBaseline(stateWithSeen([{ pid: "OLD_SHOP", name: "OLD SHOP ITEM" }])));
  const mock = createChromeHeartsFetch({
    root: `${oldProduct}${newProduct}`,
    productDetails: { PING_NEW: { name: "PING DROP", categoryName: "Shop", price: "450.00" } }
  });

  await withMockedFetch(mock.fetchMock, async () => {
    const result = await runWorkerOnce(
      env(
        {
          PING_FIRST_ALERTS: "true",
          DISCOVER_HOMEPAGE_CATEGORIES: "false",
          DISCOVER_PRODUCT_URL_CATEGORIES: "false",
          DISCOVER_SITEMAP_CATEGORIES: "false",
          DISCOVER_ROBOTS_PRODUCTS: "false",
          MAX_DIRECT_PRODUCT_URLS: "0"
        },
        kv
      )
    );

    assert.equal(result.alerted, 1);
    assert.equal(result.pinged, 1);
    assert.equal(mock.discordPayloads.length, 2, "one instant ping + one rich embed");
    const ping = mock.discordPayloads.find((payload) => !payload.embeds);
    const rich = mock.discordPayloads.find((payload) => payload.embeds);
    assert.match(ping.content, /PING DROP/);
    assert.match(ping.content, /\$450/);
    assert.match(ping.content, /PING_NEW\.html/);
    assert.equal(rich.embeds[0].title, "PING DROP");
  });
});

test("A staged size-variant of an already-seen master goes dormant instead of flapping", async () => {
  const keep = productTile("KEEP_SHOP", "KEEP SHOP ITEM", "shop", "Shop", "100.00");
  const masterPid = "129111BLKXXX756";
  const variantPid = "129111BLKXSM756";
  const variantUrl = `https://www.chromehearts.com/t-shirt/short-sleeve-pocket-crew/${variantPid}.html`;
  const base = withStagingBaseline(stateWithActive([{ pid: "KEEP_SHOP", name: "KEEP SHOP ITEM" }]));
  base.seen[masterPid] = {
    pid: masterPid,
    name: "SHORT SLEEVE POCKET CREW",
    price: "395.00",
    category: "T Shirt",
    url: `https://www.chromehearts.com/t-shirt/short-sleeve-pocket-crew/${masterPid}.html`,
    image: "",
    firstSeenAt: base.createdAt
  };
  const kv = fakeKV(base);
  const stagingEnv = {
    DISCOVER_HOMEPAGE_CATEGORIES: "false",
    DISCOVER_PRODUCT_URL_CATEGORIES: "false",
    DISCOVER_SITEMAP_CATEGORIES: "false",
    MAX_DIRECT_PRODUCT_URLS: "0",
    ENUMERATION_ENABLED: "false"
  };
  const variantPv = stagedVariation(variantPid, { live: false, name: "SHORT SLEEVE POCKET CREW" });
  variantPv.product.masterProductId = masterPid;

  const makeMock = () =>
    createChromeHeartsFetch({
      root: keep,
      robotsProductUrls: [variantUrl],
      productVariations: { [variantPid]: variantPv }
    });

  const first = makeMock();
  await withMockedFetch(first.fetchMock, async () => {
    await runWorkerOnce(env(stagingEnv, kv));
  });
  kv.values.delete(LOCK_KEY);

  const second = makeMock();
  await withMockedFetch(second.fetchMock, async () => {
    await runWorkerOnce(env(stagingEnv, kv));
    const state = JSON.parse(kv.values.get(STATE_KEY));
    assert.equal(state.hotWatch[variantPid].dormant, true, "variant tombstones instead of deleting");
  });
  kv.values.delete(LOCK_KEY);

  for (let run = 0; run < 2; run += 1) {
    const repeat = makeMock();
    await withMockedFetch(repeat.fetchMock, async () => {
      const result = await runWorkerOnce(env(stagingEnv, kv));
      assert.equal(result.staging.discoveries, 0, "dormant tombstone blocks re-discovery");
      assert.equal(result.staging.probed, 0, "dormant entries are not probed");
      assert.equal(repeat.discordPayloads.length, 0, "no ping loop");
    });
    kv.values.delete(LOCK_KEY);
  }
});

// ---- Enumeration / mining / restock ----

test("parsePidParts and minePidCandidates extract sibling PIDs from asset URLs", () => {
  assert.deepEqual(parsePidParts("180539C4CXXX593"), { style: "180539", color: "C4C", size: "XXX", suffix: "593" });
  assert.equal(parsePidParts("175364_214824"), null, "composite PIDs do not parse");
  assert.equal(parsePidParts("KEEP_SHOP"), null);

  const mined = minePidCandidates(
    "https://www.chromehearts.com/dw/image/v2/BFBV_PRD/on/demandware.static/-/Sites-ch-master-catalog/default/dw5c238470/img_products/hi-res/308180539ABDXXX593_2708.png?sw=800"
  );
  assert.deepEqual(mined, ["180539ABDXXX593"]);
  assert.deepEqual(minePidCandidates("no pids here 1234567890123456789"), [], "pure digits are not PIDs");
});

test("enumerationCandidates mines seen-product assets and permutes recent styles", () => {
  const cfg = { enumerationEnabled: true, enumerationRecentDays: 14 };
  const state = {
    seen: {
      "180539C4CXXX593": {
        pid: "180539C4CXXX593",
        firstSeenAt: new Date().toISOString(),
        image: "https://www.chromehearts.com/img_products/hi-res/308180539ABDXXX593_2708.png",
        url: "https://www.chromehearts.com/slippers/cord-slippers/180539C4CXXX593.html"
      },
      OLD_UNPARSEABLE: { pid: "OLD_UNPARSEABLE", firstSeenAt: new Date().toISOString(), image: "" }
    },
    hotWatch: {}
  };
  const { mined, siblings } = enumerationCandidates(cfg, state);
  assert.deepEqual(mined, ["180539ABDXXX593"], "asset-mined sibling colorway");
  assert.ok(siblings.includes("180539BLKXXX593"), "style+color permutation generated");
  assert.ok(!siblings.includes("180539C4CXXX593"), "own colorway excluded");
  assert.equal(enumerationCandidates({ enumerationEnabled: false }, state).mined.length, 0, "disable switch works");
});

test("parseHotWatchProbe requires actual stock, not just an available flag", () => {
  const pid = "180539C4CXXX593";
  const pricedButStockless = stagedVariation(pid, { live: true });
  pricedButStockless.product.variationAttributes[0].values[0].selectable = false;
  const probe = parseHotWatchProbe(pricedButStockless, pid);
  assert.equal(probe.purchasable, false, "price + available flag but zero orderable sizes must NOT alert");
  assert.match(probe.url, /cord-slippers\/180539C4CXXX593\.html$/, "canonical PDP URL extracted from the probe");
});

test("An asset-mined sibling colorway is hot-watched and alerts when it gains stock", async () => {
  const keep = productTile("KEEP_SHOP", "KEEP SHOP ITEM", "shop", "Shop", "100.00");
  const seedPid = "180539C4CXXX593";
  const minedPid = "180539ABDXXX593";
  const base = stateWithActive([
    { pid: "KEEP_SHOP", name: "KEEP SHOP ITEM" },
    { pid: seedPid, name: "CORD SLIPPERS", url: `https://www.chromehearts.com/slippers/cord-slippers/${seedPid}.html` }
  ]);
  base.seen[seedPid].firstSeenAt = new Date(Date.now() - 3600 * 1000).toISOString();
  base.seen[seedPid].image = `https://www.chromehearts.com/img_products/hi-res/308${minedPid}_2708.png`;
  base.active[seedPid] = structuredClone(base.seen[seedPid]);
  const kv = fakeKV(withStagingBaseline(base));
  const stagingEnv = {
    DISCOVER_HOMEPAGE_CATEGORIES: "false",
    DISCOVER_PRODUCT_URL_CATEGORIES: "false",
    DISCOVER_SITEMAP_CATEGORIES: "false",
    DISCOVER_ROBOTS_PRODUCTS: "false",
    MAX_DIRECT_PRODUCT_URLS: "0",
    PROBE_BUDGET_PER_TICK: "40"
  };

  const stagedMock = createChromeHeartsFetch({
    root: keep,
    productVariations: { [minedPid]: stagedVariation(minedPid, { live: false }) }
  });
  await withMockedFetch(stagedMock.fetchMock, async () => {
    const result = await runWorkerOnce(env(stagingEnv, kv));
    assert.equal(result.alerted, 0);
    assert.equal(stagedMock.discordPayloads.length, 0);
    const state = JSON.parse(kv.values.get(STATE_KEY));
    assert.ok(state.hotWatch[minedPid], "mined sibling colorway enters the hot-watch map");
    assert.equal(state.hotWatch[minedPid].source, "mined");
    assert.equal(state.enumTried, undefined, "no miss-memory is persisted (kept out of state to avoid write amplification)");
  });
  kv.values.delete(LOCK_KEY);

  const liveMock = createChromeHeartsFetch({
    root: keep,
    productVariations: { [minedPid]: stagedVariation(minedPid, { live: true }) },
    productDetails: { [minedPid]: { name: "CORD SLIPPERS", categoryName: "Slippers", price: "1155.00" } }
  });
  await withMockedFetch(liveMock.fetchMock, async () => {
    const result = await runWorkerOnce(env(stagingEnv, kv));
    assert.equal(result.alerted, 1);
    assert.deepEqual(result.newPids, [minedPid]);
    assert.equal(result.alertLanes[minedPid], "hotwatch");
    assert.equal(liveMock.discordPayloads[0].embeds[0].title, "CORD SLIPPERS");
    const state = JSON.parse(kv.values.get(STATE_KEY));
    assert.ok(state.seen[minedPid]);
    assert.ok(state.seen[minedPid].lastAlertedAt, "alert timestamp stamped for the relist guard");
    assert.equal(state.hotWatch[minedPid], undefined, "graduates out of hot-watch");
  });
});

test("Restock watch relist-alerts a confirmed-missing product the moment its probe shows stock", async () => {
  const keep = productTile("KEEP_SHOP", "KEEP SHOP ITEM", "shop", "Shop", "100.00");
  const gonePid = "129111BLKXXX756";
  const base = stateWithActive([
    { pid: "KEEP_SHOP", name: "KEEP SHOP ITEM" },
    { pid: gonePid, name: "SHORT SLEEVE POCKET CREW", url: `https://www.chromehearts.com/t-shirt/short-sleeve-pocket-crew/${gonePid}.html` }
  ]);
  delete base.active[gonePid];
  base.missing = { [gonePid]: { pid: gonePid, firstMissingAt: base.createdAt, lastMissingAt: base.createdAt, count: 2 } };
  const kv = fakeKV(withStagingBaseline(base));
  const stagingEnv = {
    DISCOVER_HOMEPAGE_CATEGORIES: "false",
    DISCOVER_PRODUCT_URL_CATEGORIES: "false",
    DISCOVER_SITEMAP_CATEGORIES: "false",
    DISCOVER_ROBOTS_PRODUCTS: "false",
    MAX_DIRECT_PRODUCT_URLS: "0",
    ENUMERATION_ENABLED: "false",
    RELIST_AFTER_ABSENT_RUNS: "2"
  };

  const restockMock = createChromeHeartsFetch({
    root: keep,
    productVariations: { [gonePid]: stagedVariation(gonePid, { live: true, name: "SHORT SLEEVE POCKET CREW" }) },
    productDetails: { [gonePid]: { name: "SHORT SLEEVE POCKET CREW", categoryName: "T Shirt", price: "395.00" } }
  });
  await withMockedFetch(restockMock.fetchMock, async () => {
    const result = await runWorkerOnce(env(stagingEnv, kv));
    assert.equal(result.alerted, 1);
    assert.deepEqual(result.newPids, [gonePid]);
    assert.equal(result.alertLanes[gonePid], "restock");
    assert.equal(restockMock.discordPayloads[0].embeds[0].title, "SHORT SLEEVE POCKET CREW");
    const state = JSON.parse(kv.values.get(STATE_KEY));
    assert.equal(state.missing[gonePid], undefined, "restocked product leaves the missing map");
    assert.ok(state.active[gonePid], "restocked product is active again");
  });
});

test("parseHotWatchProbe rejects delisted standard products (the TRUCKER HAT false-positive shape)", () => {
  const pid = "196451DAYOSZ262";
  const delisted = {
    product: {
      id: pid,
      masterProductId: pid,
      productName: "TRUCKER HAT",
      productType: "standard",
      online: false,
      available: false,
      readyToOrder: true,
      price: { sales: { value: 395, currency: "USD" } },
      availability: { messages: ["This item is currently not available"] },
      variationAttributes: null
    }
  };
  const probe = parseHotWatchProbe(delisted, pid);
  assert.equal(probe.purchasable, false, "price + readyToOrder on a delisted product must not read as stock");
  assert.equal(probe.inStockSizeCount, 0, '"not available" message defeats the readyToOrder fallback');

  const relisted = structuredClone(delisted);
  relisted.product.online = true;
  relisted.product.available = true;
  relisted.product.availability.messages = ["In Stock"];
  assert.equal(parseHotWatchProbe(relisted, pid).purchasable, true);
});

test("Restock cooldown blocks a just-alerted product from re-probing into a loop", async () => {
  const keep = productTile("KEEP_SHOP", "KEEP SHOP ITEM", "shop", "Shop", "100.00");
  const gonePid = "129111BLKXXX756";
  const base = stateWithActive([
    { pid: "KEEP_SHOP", name: "KEEP SHOP ITEM" },
    { pid: gonePid, name: "SHORT SLEEVE POCKET CREW" }
  ]);
  delete base.active[gonePid];
  base.seen[gonePid].lastAlertedAt = new Date().toISOString();
  base.missing = { [gonePid]: { pid: gonePid, firstMissingAt: base.createdAt, lastMissingAt: base.createdAt, count: 2 } };
  const kv = fakeKV(withStagingBaseline(base));

  const mock = createChromeHeartsFetch({
    root: keep,
    productVariations: { [gonePid]: stagedVariation(gonePid, { live: true, name: "SHORT SLEEVE POCKET CREW" }) }
  });
  await withMockedFetch(mock.fetchMock, async () => {
    const result = await runWorkerOnce(
      env(
        {
          DISCOVER_HOMEPAGE_CATEGORIES: "false",
          DISCOVER_PRODUCT_URL_CATEGORIES: "false",
          DISCOVER_SITEMAP_CATEGORIES: "false",
          DISCOVER_ROBOTS_PRODUCTS: "false",
          MAX_DIRECT_PRODUCT_URLS: "0",
          ENUMERATION_ENABLED: "false"
        },
        kv
      )
    );
    assert.equal(result.alerted, 0, "cooldown suppresses the restock re-alert");
    assert.equal(result.staging.probed, 0, "cooldown removes the PID from the probe plan entirely");
    assert.equal(mock.discordPayloads.length, 0);
  });
});

test("updateStyleRegistry accumulates colorways per style across sweeps", () => {
  const r1 = updateStyleRegistry(
    { "180539C4CXXX593": { name: "CORD SLIPPERS" } },
    {},
    "2026-07-01T00:00:00.000Z"
  );
  const key = "180539|XXX|593";
  assert.deepEqual(r1[key].colors, ["C4C"]);
  assert.equal(r1[key].name, "CORD SLIPPERS");

  const r2 = updateStyleRegistry({ "180539ABDXXX593": { name: "CORD SLIPPERS" } }, r1, "2026-07-15T00:00:00.000Z");
  assert.deepEqual(r2[key].colors.sort(), ["ABD", "C4C"]);
  assert.equal(r2[key].lastSeenAt, "2026-07-15T00:00:00.000Z");
});

test("enumerationCandidates covers the WHOLE permanent registry, not just recent styles", () => {
  const cfg = { enumerationEnabled: true, enumerationRecentDays: 14 };
  const state = {
    seen: {},
    hotWatch: {},
    styleRegistry: {
      "180539|XXX|593": { style: "180539", size: "XXX", suffix: "593", colors: ["C4C"], lastSeenAt: "2026-01-01T00:00:00.000Z" }
    }
  };
  const { registrySiblings } = enumerationCandidates(cfg, state);
  assert.ok(registrySiblings.includes("180539ABDXXX593"), "historical style's other colorways stay enumerable forever");
  assert.ok(!registrySiblings.includes("180539C4CXXX593"), "the already-known colorway is excluded");
});

test("A new colorway of a registry-known style alerts index-free, no fresh seed", async () => {
  const keep = productTile("KEEP_SHOP", "KEEP SHOP ITEM", "shop", "Shop", "100.00");
  const knownPid = "180539C4CXXX593"; // seen weeks ago
  const newColorway = "180539BLKXXX593"; // never seen, no staging signal anywhere
  const base = stateWithActive([{ pid: "KEEP_SHOP", name: "KEEP SHOP ITEM" }]);
  base.seen[knownPid] = {
    pid: knownPid,
    name: "CORD SLIPPERS",
    price: "1155.00",
    category: "Slippers",
    url: `https://www.chromehearts.com/slippers/cord-slippers/${knownPid}.html`,
    image: "",
    firstSeenAt: "2026-01-01T00:00:00.000Z"
  };
  base.active[knownPid] = structuredClone(base.seen[knownPid]);
  base.styleRegistry = {
    "180539|XXX|593": { style: "180539", size: "XXX", suffix: "593", colors: ["C4C"], name: "CORD SLIPPERS", lastSeenAt: "2026-01-01T00:00:00.000Z" }
  };
  const kv = fakeKV(withStagingBaseline(base));
  const stagingEnv = {
    DISCOVER_HOMEPAGE_CATEGORIES: "false",
    DISCOVER_PRODUCT_URL_CATEGORIES: "false",
    DISCOVER_SITEMAP_CATEGORIES: "false",
    DISCOVER_ROBOTS_PRODUCTS: "false",
    MAX_DIRECT_PRODUCT_URLS: "0",
    PROBE_BUDGET_PER_TICK: "60"
  };

  const liveMock = createChromeHeartsFetch({
    root: keep,
    productVariations: { [newColorway]: stagedVariation(newColorway, { live: true, name: "CORD SLIPPERS" }) },
    productDetails: { [newColorway]: { name: "CORD SLIPPERS", categoryName: "Slippers", price: "1155.00" } },
    unknownPidsReturn500: true
  });
  await withMockedFetch(liveMock.fetchMock, async () => {
    const result = await runWorkerOnce(env(stagingEnv, kv));
    assert.equal(result.alerted, 1, "registry-enumerated colorway alerts with no fresh seed");
    assert.deepEqual(result.newPids, [newColorway]);
    assert.equal(result.alertLanes[newColorway], "hotwatch");
    assert.equal(liveMock.discordPayloads[0].embeds[0].title, "CORD SLIPPERS");
  });
});

test("A drop signal opens a burst window that the DO alarm uses to shorten cadence", async () => {
  const keep = productTile("KEEP_SHOP", "KEEP SHOP ITEM", "shop", "Shop", "100.00");
  const fresh = productTile("BURST_NEW", "BURST DROP", "shop", "Shop", "250.00");
  const kv = fakeKV(withStagingBaseline(stateWithActive([{ pid: "KEEP_SHOP", name: "KEEP SHOP ITEM" }])));
  const mock = createChromeHeartsFetch({
    root: `${keep}${fresh}`,
    productDetails: { BURST_NEW: { name: "BURST DROP", categoryName: "Shop", price: "250.00" } }
  });

  await withMockedFetch(mock.fetchMock, async () => {
    const result = await runWorkerOnce(
      env(
        {
          DISCOVER_HOMEPAGE_CATEGORIES: "false",
          DISCOVER_PRODUCT_URL_CATEGORIES: "false",
          DISCOVER_SITEMAP_CATEGORIES: "false",
          DISCOVER_ROBOTS_PRODUCTS: "false",
          MAX_DIRECT_PRODUCT_URLS: "0",
          ENUMERATION_ENABLED: "false",
          BURST_WINDOW_SECONDS: "180"
        },
        kv
      )
    );
    assert.equal(result.alerted, 1);
    const state = JSON.parse(kv.values.get(STATE_KEY));
    assert.ok(state.burstUntil, "a new-PID drop opens a burst window");
    assert.ok(Date.parse(state.burstUntil) > Date.now(), "burst window is in the future");
    assert.ok(state.styleRegistry, "style registry persisted");
  });
});

test("Burst window does not open on an ordinary quiet tick", async () => {
  const keep = productTile("KEEP_SHOP", "KEEP SHOP ITEM", "shop", "Shop", "100.00");
  const kv = fakeKV(withStagingBaseline(stateWithActive([{ pid: "KEEP_SHOP", name: "KEEP SHOP ITEM" }])));
  const mock = createChromeHeartsFetch({ root: keep });
  await withMockedFetch(mock.fetchMock, async () => {
    await runWorkerOnce(
      env(
        {
          DISCOVER_HOMEPAGE_CATEGORIES: "false",
          DISCOVER_PRODUCT_URL_CATEGORIES: "false",
          DISCOVER_SITEMAP_CATEGORIES: "false",
          DISCOVER_ROBOTS_PRODUCTS: "false",
          MAX_DIRECT_PRODUCT_URLS: "0",
          ENUMERATION_ENABLED: "false"
        },
        kv
      )
    );
    const state = JSON.parse(kv.values.get(STATE_KEY));
    assert.equal(state.burstUntil, undefined, "no drop signal, no burst");
  });
});

test("extractGridPids is a faithful superset of parseProducts (coverage gate safety)", async () => {
  const { parseProducts, extractGridPids } = await import("../src/worker.js");
  const variants = [
    productTile("053669BLKOSZD62", "SWEATBAND", "sweatbands", "Accessories"),
    // single-quoted attributes
    `<div class='product productType-master' data-pid='129111BLKXXX756'>
       <span class='product-metadata' data-pid='129111BLKXXX756' data-name='TEE' data-price='395'></span>
       <a class='link' href='/t-shirt/x/129111BLKXXX756.html'>x</a></div>`,
    // extra whitespace around the attribute
    `<div class="product productType-master"  data-pid = "180539C4CXXX593" >
       <span class="product-metadata" data-pid="180539C4CXXX593" data-name="SLIPPERS" data-price="1155"></span>
       <a class="link" href="/slippers/x/180539C4CXXX593.html">x</a></div>`
  ];
  for (const html of variants) {
    const cheerioPids = new Set(Object.keys(parseProducts(html)));
    const regexPids = extractGridPids(html);
    for (const pid of cheerioPids) {
      assert.ok(regexPids.has(pid), `regex gate must catch every parseable product PID (missed ${pid})`);
    }
  }
  assert.equal(extractGridPids('<div class="search-result-content"></div>').size, 0);
});

function fakeDoStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  let alarm = null;
  return {
    values,
    alarmCalls: 0,
    deleteAlarmCalls: 0,
    async get(key) {
      if (Array.isArray(key)) {
        return new Map(key.filter((k) => values.has(k)).map((k) => [k, values.get(k)]));
      }
      return values.has(key) ? values.get(key) : undefined;
    },
    async put(keyOrEntries, value) {
      if (keyOrEntries && typeof keyOrEntries === "object") {
        for (const [k, v] of Object.entries(keyOrEntries)) values.set(k, v);
        return;
      }
      values.set(keyOrEntries, value);
    },
    async delete(key) {
      for (const k of Array.isArray(key) ? key : [key]) values.delete(k);
    },
    async list({ prefix = "", reverse = false, limit = 1000 } = {}) {
      const keys = [...values.keys()].filter((k) => k.startsWith(prefix)).sort();
      if (reverse) keys.reverse();
      return new Map(keys.slice(0, limit).map((k) => [k, values.get(k)]));
    },
    async getAlarm() {
      return alarm;
    },
    async setAlarm(time) {
      alarm = time;
      this.alarmCalls += 1;
    },
    async deleteAlarm() {
      alarm = null;
      this.deleteAlarmCalls += 1;
    }
  };
}

test("Watchdog resurrects a wedged loop left holding a past-due alarm", async () => {
  const { MonitorController } = await import("../src/worker.js");
  const sixHoursAgo = Date.now() - 6 * 60 * 60 * 1000;
  const storage = fakeDoStorage({ lastTickAt: new Date(sixHoursAgo).toISOString() });
  await storage.setAlarm(sixHoursAgo);
  const controller = new MonitorController({ storage }, env({ FAST_POLL_ENABLED: "true" }));

  const result = await controller.ensure();

  assert.equal(result.armed, true);
  assert.equal(result.rearmed, true, "a past-due alarm must be treated as dead, not as healthy");
  const next = await storage.getAlarm();
  assert.ok(next > Date.now(), "watchdog scheduled a fresh alarm in the future");
});

test("Watchdog re-arms on a stale heartbeat even when an alarm looks pending", async () => {
  const { MonitorController } = await import("../src/worker.js");
  const storage = fakeDoStorage({ lastTickAt: new Date(Date.now() - 30 * 60 * 1000).toISOString() });
  await storage.setAlarm(Date.now() + 60 * 60 * 1000);
  const controller = new MonitorController({ storage }, env({ FAST_POLL_ENABLED: "true" }));

  const result = await controller.ensure();

  assert.equal(result.rearmed, true, "heartbeat is the liveness signal, not the alarm timestamp");
  assert.equal(result.reason, "stale-heartbeat");
  assert.ok((await storage.getAlarm()) < Date.now() + 10000, "loop restarts immediately, not in an hour");
});

test("Watchdog leaves a healthy running loop alone", async () => {
  const { MonitorController } = await import("../src/worker.js");
  const storage = fakeDoStorage({ lastTickAt: new Date(Date.now() - 3000).toISOString() });
  const scheduled = Date.now() + 9000;
  await storage.setAlarm(scheduled);
  const controller = new MonitorController({ storage }, env({ FAST_POLL_ENABLED: "true" }));
  const before = storage.alarmCalls;

  const result = await controller.ensure();

  assert.equal(result.rearmed, undefined, "a live loop is not disturbed");
  assert.equal(storage.alarmCalls, before, "no redundant setAlarm on a healthy loop");
  assert.equal(await storage.getAlarm(), scheduled);
});

test("A failing config read cannot orphan the alarm loop", async () => {
  const { MonitorController } = await import("../src/worker.js");
  const storage = fakeDoStorage();
  const kv = fakeKV();
  kv.get = async () => {
    throw new Error("KV unavailable");
  };
  const controller = new MonitorController({ storage }, env({ FAST_POLL_ENABLED: "true" }, kv));

  await controller.alarm();

  const alarm = await storage.getAlarm();
  assert.ok(alarm && alarm > Date.now(), "alarm is armed before any fallible work, so a KV blip costs one tick");
  assert.equal(storage.deleteAlarmCalls, 0, "a transient config failure must not stop the loop");
});

test("An explicit disable stops the loop, and only that", async () => {
  const { MonitorController } = await import("../src/worker.js");
  const storage = fakeDoStorage();
  const controller = new MonitorController({ storage }, env({ FAST_POLL_ENABLED: "false" }));

  await controller.alarm();

  assert.equal(await storage.getAlarm(), null, "fast poll off means the loop parks");
  assert.ok(storage.deleteAlarmCalls > 0);
});

test("A lost state key re-baselines LOUDLY instead of silently swallowing the catalog", async () => {
  const live = productTile("LOST_STATE_PID", "SILENT MISS TEE", "shop", "Shop", "395.00");
  const kv = fakeKV(withStagingBaseline({ seen: {}, active: {}, missing: {} }));
  kv.values.set(`${STATE_KEY}:baselined`, JSON.stringify({ at: new Date().toISOString() }));
  const mock = createChromeHeartsFetch({ root: live });

  await withMockedFetch(mock.fetchMock, async () => {
    const result = await runWorkerOnce(
      env(
        {
          DISCOVER_HOMEPAGE_CATEGORIES: "false",
          DISCOVER_PRODUCT_URL_CATEGORIES: "false",
          DISCOVER_SITEMAP_CATEGORIES: "false",
          DISCOVER_ROBOTS_PRODUCTS: "false",
          MAX_DIRECT_PRODUCT_URLS: "0",
          ENUMERATION_ENABLED: "false"
        },
        kv
      )
    );
    assert.equal(result.baseline, true, "still re-baselines rather than storming stale products");
    const titles = mock.discordPayloads.map((payload) => payload.embeds?.[0]?.title).filter(Boolean);
    assert.ok(
      titles.some((title) => /state lost/i.test(title)),
      `state loss must be announced; got titles ${JSON.stringify(titles)}`
    );
  });
});

test("A genuine first run baselines silently (no false state-loss alarm)", async () => {
  const live = productTile("FIRST_RUN_PID", "FIRST RUN TEE", "shop", "Shop", "395.00");
  const freshKey = "state-first-run";
  const kv = fakeKV(withStagingBaseline({ seen: {}, active: {}, missing: {} }));
  kv.values.set(freshKey, kv.values.get(STATE_KEY));
  const mock = createChromeHeartsFetch({ root: live });

  await withMockedFetch(mock.fetchMock, async () => {
    const result = await runWorkerOnce(
      env(
        {
          STATE_KEY: freshKey,
          DISCOVER_HOMEPAGE_CATEGORIES: "false",
          DISCOVER_PRODUCT_URL_CATEGORIES: "false",
          DISCOVER_SITEMAP_CATEGORIES: "false",
          DISCOVER_ROBOTS_PRODUCTS: "false",
          MAX_DIRECT_PRODUCT_URLS: "0",
          ENUMERATION_ENABLED: "false"
        },
        kv
      )
    );
    assert.equal(result.baseline, true);
    const titles = mock.discordPayloads.map((payload) => payload.embeds?.[0]?.title).filter(Boolean);
    assert.ok(!titles.some((title) => /state lost/i.test(title)), "first run must not cry state-loss");
    assert.ok(kv.values.get(`${freshKey}:baselined`), "baseline marker persisted for future loss detection");
  });
});

const MAIN_HOOK = "https://discord.com/api/webhooks/1111111111/main-token";
const SECOND_HOOK = "https://discord.com/api/webhooks/2222222222/second-token";

test("Item alerts fan out to EVERY webhook", async () => {
  const keep = productTile("KEEP_ROUTE", "KEEP ROUTE ITEM", "shop", "Shop", "100.00");
  const fresh = productTile("ROUTE_NEW", "ROUTED DROP", "shop", "Shop", "250.00");
  const kv = fakeKV(withStagingBaseline(stateWithActive([{ pid: "KEEP_ROUTE", name: "KEEP ROUTE ITEM" }])));
  const mock = createChromeHeartsFetch({
    root: `${keep}${fresh}`,
    productDetails: { ROUTE_NEW: { name: "ROUTED DROP", categoryName: "Shop", price: "250.00" } }
  });

  await withMockedFetch(mock.fetchMock, async () => {
    const result = await runWorkerOnce(
      env(
        {
          DISCORD_WEBHOOK_URL: `${MAIN_HOOK} ${SECOND_HOOK}`,
          DISCOVER_HOMEPAGE_CATEGORIES: "false",
          DISCOVER_PRODUCT_URL_CATEGORIES: "false",
          DISCOVER_SITEMAP_CATEGORIES: "false",
          DISCOVER_ROBOTS_PRODUCTS: "false",
          MAX_DIRECT_PRODUCT_URLS: "0",
          ENUMERATION_ENABLED: "false"
        },
        kv
      )
    );
    assert.equal(result.alerted, 1);
    assert.ok(mock.discordUrls.some((url) => url.includes("main-token")), "main server got the drop");
    assert.ok(mock.discordUrls.some((url) => url.includes("second-token")), "second server got the drop too");
  });
});

test("Non-item pings go to the MAIN webhook only", async () => {
  const live = productTile("ROUTE_LOST", "STATE LOSS ITEM", "shop", "Shop", "395.00");
  const kv = fakeKV(withStagingBaseline({ seen: {}, active: {}, missing: {} }));
  kv.values.set(`${STATE_KEY}:baselined`, JSON.stringify({ at: new Date().toISOString() }));
  const mock = createChromeHeartsFetch({ root: live });

  await withMockedFetch(mock.fetchMock, async () => {
    await runWorkerOnce(
      env(
        {
          DISCORD_WEBHOOK_URL: `${MAIN_HOOK} ${SECOND_HOOK}`,
          DISCOVER_HOMEPAGE_CATEGORIES: "false",
          DISCOVER_PRODUCT_URL_CATEGORIES: "false",
          DISCOVER_SITEMAP_CATEGORIES: "false",
          DISCOVER_ROBOTS_PRODUCTS: "false",
          MAX_DIRECT_PRODUCT_URLS: "0",
          ENUMERATION_ENABLED: "false"
        },
        kv
      )
    );
    assert.ok(mock.discordUrls.length > 0, "state loss was announced");
    assert.ok(mock.discordUrls.every((url) => url.includes("main-token")), `only main may be pinged, got ${JSON.stringify(mock.discordUrls)}`);
    assert.ok(!mock.discordUrls.some((url) => url.includes("second-token")), "second server must not get plumbing pings");
  });
});

test("Error backoff throttles external runs but never stops the Durable Object loop", async () => {
  const keep = productTile("KEEP_BACKOFF", "KEEP BACKOFF ITEM", "shop", "Shop", "100.00");
  const fresh = productTile("BACKOFF_NEW", "BACKOFF DROP", "shop", "Shop", "250.00");
  const backedOffState = {
    ...withStagingBaseline(stateWithActive([{ pid: "KEEP_BACKOFF", name: "KEEP BACKOFF ITEM" }])),
    errorStreak: 4,
    backoffUntil: new Date(Date.now() + 90_000).toISOString()
  };
  const overrides = {
    DISCOVER_HOMEPAGE_CATEGORIES: "false",
    DISCOVER_PRODUCT_URL_CATEGORIES: "false",
    DISCOVER_SITEMAP_CATEGORIES: "false",
    DISCOVER_ROBOTS_PRODUCTS: "false",
    MAX_DIRECT_PRODUCT_URLS: "0",
    ENUMERATION_ENABLED: "false"
  };

  const kvLoop = fakeKV(backedOffState);
  const mockLoop = createChromeHeartsFetch({
    root: `${keep}${fresh}`,
    productDetails: { BACKOFF_NEW: { name: "BACKOFF DROP", categoryName: "Shop", price: "250.00" } }
  });
  await withMockedFetch(mockLoop.fetchMock, async () => {
    const result = await runMonitor(env(overrides, kvLoop), null, { mode: "full", skipLock: true });
    assert.notEqual(result.reason, "backoff", "the fast loop must not skip a scan because of backoff");
    assert.equal(result.skipped, undefined, "it actually scanned");
    assert.equal(result.alerted, 1, "and the drop still alerted while backoff was armed");
  });

  const kvExternal = fakeKV(backedOffState);
  const mockExternal = createChromeHeartsFetch({ root: `${keep}${fresh}` });
  await withMockedFetch(mockExternal.fetchMock, async () => {
    const result = await runMonitor(env(overrides, kvExternal), null, { mode: "full" });
    assert.equal(result.skipped, true);
    assert.equal(result.reason, "backoff", "manual/cron runs still back off");
  });
});

test("An env-configured MAIN webhook can be removed from the dashboard", async () => {
  const envMain = "https://discord.com/api/webhooks/777/env-main";
  const added = "https://discord.com/api/webhooks/888/dashboard-added";
  const kv = fakeKV(stateWithSeen([{ pid: "OLD_SHOP", name: "OLD SHOP ITEM" }]));
  const testEnv = env({ DISCORD_MAIN_WEBHOOK_URL: envMain, DISCORD_WEBHOOK_URL: "" }, kv);
  const post = (params) => {
    const body = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) for (const i of Array.isArray(v) ? v : [v]) body.append(k, i);
    return worker.fetch(
      new Request("https://monitor.test/webhooks", {
        method: "POST",
        headers: { ...basicAuthHeaders(), "content-type": "application/x-www-form-urlencoded" },
        body
      }),
      testEnv
    );
  };
  const health = async () => {
    const r = await worker.fetch(new Request("https://monitor.test/health", { headers: basicAuthHeaders() }), testEnv);
    return (await r.json()).settings;
  };

  // The env MAIN starts in the fan-out and is MAIN.
  assert.equal((await health()).webhookCount, 1);

  await post({ discordWebhookUrls: added, webhookName: "Backup" });
  assert.equal((await health()).webhookCount, 2);
  await post({ remove: "777" });

  const after = await health();
  assert.equal(after.webhookCount, 1, "the env MAIN is not resurrected from the secret");
  assert.match(after.mainWebhook, /888/, "MAIN falls back to the remaining webhook");
  const saved = JSON.parse(kv.values.get(SETTINGS_KEY));
  assert.deepEqual(saved.discordWebhookUrls, [added]);
});

test("The root lane follows the show-more chain across pages", async () => {
  const p1 = productTile("ROOTPAGE_1", "ROOT PAGE ONE", "shop", "Shop", "100.00");
  const p2 = productTile("ROOTPAGE_2", "ROOT PAGE TWO", "shop", "Shop", "200.00");
  const kv = fakeKV(withStagingBaseline(stateWithActive([{ pid: "ROOTPAGE_1", name: "ROOT PAGE ONE" }])));
  const mock = createChromeHeartsFetch({
    rootPages: [p1, p2],
    productDetails: { ROOTPAGE_2: { name: "ROOT PAGE TWO", categoryName: "Shop", price: "200.00" } }
  });

  await withMockedFetch(mock.fetchMock, async () => {
    const result = await runMonitor(
      env({ DISCOVER_HOMEPAGE_CATEGORIES: "false", DISCOVER_SITEMAP_CATEGORIES: "false", DISCOVER_ROBOTS_PRODUCTS: "false", DISCOVER_PRODUCT_URL_CATEGORIES: "false", MAX_DIRECT_PRODUCT_URLS: "0", ENUMERATION_ENABLED: "false" }, kv),
      null,
      { mode: "fast", skipLock: true, tickNumber: 1 }
    );
    assert.equal(result.alerted, 1, "page-2 product was found");
    assert.deepEqual(result.newPids, ["ROOTPAGE_2"]);
    assert.equal(result.fast.root.pages, 2, "walked both pages");
    assert.equal(result.fast.root.complete, true, "chain terminated cleanly");
  });
});

test("The root lane finds a product in a category nobody guessed", async () => {
  const hidden = productTile("STEALTH_PID", "STEALTH DROP", "totally-unguessed-cgid", "Secret", "1200.00");
  const kv = fakeKV(withStagingBaseline(stateWithActive([{ pid: "BASELINE_PID", name: "BASELINE" }])));
  const mock = createChromeHeartsFetch({
    rootPages: [hidden],
    productDetails: { STEALTH_PID: { name: "STEALTH DROP", categoryName: "Secret", price: "1200.00" } }
  });

  await withMockedFetch(mock.fetchMock, async () => {
    const result = await runMonitor(
      env({ DISCOVER_HOMEPAGE_CATEGORIES: "false", DISCOVER_SITEMAP_CATEGORIES: "false", DISCOVER_ROBOTS_PRODUCTS: "false", DISCOVER_PRODUCT_URL_CATEGORIES: "false", MAX_DIRECT_PRODUCT_URLS: "0", ENUMERATION_ENABLED: "false" }, kv),
      null,
      { mode: "fast", skipLock: true, tickNumber: 1 }
    );
    assert.equal(result.alerted, 1, "a product in an unguessed category still alerts");
    assert.deepEqual(result.newPids, ["STEALTH_PID"]);
    assert.ok(
      !mock.gridCategoryCalls.includes("totally-unguessed-cgid"),
      "the category was never polled directly"
    );
  });
});

test("A failed page marks the root sweep incomplete rather than reporting a short catalog", async () => {
  const kv = fakeKV(withStagingBaseline(stateWithActive([{ pid: "BASELINE_PID", name: "BASELINE" }])));
  const good = productTile("PARTIAL_1", "PARTIAL ONE", "shop", "Shop", "100.00");
  // Page 1 promises a page 2; the fetch for page 2 fails.
  let calls = 0;
  const base = createChromeHeartsFetch({ rootPages: [good, good] });
  const flaky = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname.includes("/Search-UpdateGrid") && url.searchParams.get("cgid") === "root") {
      calls += 1;
      if (calls > 1) throw new Error("network reset");
    }
    return base.fetchMock(input, init);
  };

  await withMockedFetch(flaky, async () => {
    const result = await runMonitor(
      env({ DISCOVER_HOMEPAGE_CATEGORIES: "false", DISCOVER_SITEMAP_CATEGORIES: "false", DISCOVER_ROBOTS_PRODUCTS: "false", DISCOVER_PRODUCT_URL_CATEGORIES: "false", MAX_DIRECT_PRODUCT_URLS: "0", ENUMERATION_ENABLED: "false" }, kv),
      null,
      { mode: "fast", skipLock: true, tickNumber: 1 }
    );
    assert.equal(result.fast.root.complete, false, "an interrupted chain is never reported as complete");
  });
});
