import assert from "node:assert/strict";
import test from "node:test";
import worker from "../src/worker.js";

const STATE_KEY = "state";
const LOCK_KEY = "lock";

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

function fakeKV(initialState = stateWithSeen([])) {
  const values = new Map([[STATE_KEY, JSON.stringify(initialState)]]);
  return {
    values,
    async get(key) {
      return values.get(key) ?? null;
    },
    async put(key, value) {
      values.set(key, value);
    }
  };
}

function env(overrides = {}, kv = fakeKV()) {
  return {
    STATE: kv,
    STATE_KEY,
    LOCK_KEY,
    DISCORD_WEBHOOK_URL: "https://discord.test/webhook",
    CRON_SECRET: "secret",
    CHECK_MIN_INTERVAL_SECONDS: "0",
    DISCOVER_HOMEPAGE_CATEGORIES: "true",
    DISCOVER_PRODUCT_URL_CATEGORIES: "true",
    DISCOVER_SITEMAP_CATEGORIES: "true",
    EXACT_STOCK_PROBE_CONCURRENCY: "1",
    MAX_ALERTS_PER_RUN: "5",
    MAX_CATEGORY_IDS: "20",
    MAX_CATEGORY_PAGES: "1",
    MAX_PAGES: "1",
    MIN_PRODUCTS: "1",
    PAGE_SIZE: "200",
    PROBE_EXACT_STOCK: "false",
    REQUEST_TIMEOUT_MS: "1000",
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

function createChromeHeartsFetch({ root = "", categories = {}, sitemapCategories = [], homepageCategories = [], productDetails = {} }) {
  const discordPayloads = [];
  const gridCategoryCalls = [];

  const fetchMock = async (input, init = {}) => {
    const url = new URL(String(input));

    if (url.href === "https://discord.test/webhook") {
      discordPayloads.push(JSON.parse(init.body || "{}"));
      return new Response(null, { status: 204 });
    }

    if (url.hostname !== "www.chromehearts.com") {
      return new Response("not found", { status: 404 });
    }

    if (url.pathname === "/") {
      const links = homepageCategories.map((category) => `<a href="/${category}/">${category}</a>`).join("");
      return new Response(`<!doctype html><nav>${links}</nav>`, {
        status: 200,
        headers: { "content-type": "text/html" }
      });
    }

    if (url.pathname === "/sitemap_index.xml") {
      return new Response(`<sitemapindex><sitemap><loc>https://www.chromehearts.com/sitemap_0.xml</loc></sitemap></sitemapindex>`, {
        status: 200,
        headers: { "content-type": "application/xml" }
      });
    }

    if (url.pathname === "/sitemap_0.xml") {
      const locs = sitemapCategories.map((category) => `<url><loc>https://www.chromehearts.com/${category}/</loc></url>`).join("");
      return new Response(`<urlset>${locs}</urlset>`, { status: 200, headers: { "content-type": "application/xml" } });
    }

    if (url.pathname.includes("/Search-UpdateGrid")) {
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

  return { fetchMock, discordPayloads, gridCategoryCalls };
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
    assert.equal(mock.discordPayloads[0].embeds[0].title, "NEW HAT");
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
    assert.deepEqual(mock.gridCategoryCalls, ["root", "hat"]);
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
