import * as cheerio from "cheerio";
import {
  BlobNotFoundError,
  BlobPreconditionFailedError,
  del as blobDel,
  get as blobGet,
  head as blobHead,
  put as blobPut
} from "@vercel/blob";
import crypto from "node:crypto";
import { fetchStockSnapshot, stockDiff as calculateStockDiff } from "../scripts/stock-watch.js";

export const config = {
  maxDuration: 30
};

const BASE_URL = "https://www.chromehearts.com";
const PRODUCT_GRID_BASE_URL =
  "https://www.chromehearts.com/on/demandware.store/Sites-ChromeHearts-Site/en_US/Search-UpdateGrid";
const DEFAULT_STATE_KEY = "chrome-hearts:new-items:state";
const DEFAULT_LOCK_KEY = "chrome-hearts:new-items:lock";
const DEFAULT_BLOB_STATE_PATH = "chrome-hearts-monitor/state.json";
const DEFAULT_BLOB_LOCK_PATH = "chrome-hearts-monitor/lock.json";

class MonitorError extends Error {
  constructor(message, statusCode = 500, details = {}) {
    super(message);
    this.name = "MonitorError";
    this.statusCode = statusCode;
    this.details = details;
  }
}

class HttpStatusError extends MonitorError {
  constructor(message, status, retryAfterSeconds = null) {
    super(message, status >= 500 ? 502 : 500, { status, retryAfterSeconds });
    this.name = "HttpStatusError";
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function intEnv(name, fallback, min = 0) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value < min) {
    throw new MonitorError(`${name} must be an integer >= ${min}`, 500);
  }
  return value;
}

function boolEnv(name, fallback = false) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  return ["1", "true", "yes", "on"].includes(raw.toLowerCase());
}

function getConfig() {
  const redisUrl = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || "";
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || "";
  const hasRedis = Boolean(redisUrl && redisToken);
  const hasBlob = Boolean(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID || process.env.VERCEL_OIDC_TOKEN);
  const checkMinIntervalSeconds = intEnv("CHECK_MIN_INTERVAL_SECONDS", 50, 0);

  if (!hasRedis && !hasBlob) {
    throw new MonitorError(
      "Missing durable storage env vars. Set Redis REST env vars or attach Vercel Blob.",
      500
    );
  }
  if (!process.env.DISCORD_WEBHOOK_URL) {
    throw new MonitorError("Missing DISCORD_WEBHOOK_URL.", 500);
  }

  return {
    redisUrl,
    redisToken,
    storageBackend: hasRedis ? "redis" : "blob",
    discordWebhookUrl: process.env.DISCORD_WEBHOOK_URL,
    cronSecret: process.env.CRON_SECRET || "",
    stateKey: process.env.STATE_KEY || DEFAULT_STATE_KEY,
    lockKey: process.env.LOCK_KEY || DEFAULT_LOCK_KEY,
    blobStatePath: process.env.BLOB_STATE_PATH || DEFAULT_BLOB_STATE_PATH,
    blobLockPath: process.env.BLOB_LOCK_PATH || DEFAULT_BLOB_LOCK_PATH,
    pageSize: intEnv("PAGE_SIZE", 200, 1),
    maxPages: intEnv("MAX_PAGES", 10, 1),
    minProducts: intEnv("MIN_PRODUCTS", 1, 0),
    stockProductUrl: process.env.STOCK_PRODUCT_URL || "",
    requestTimeoutMs: intEnv("REQUEST_TIMEOUT_MS", 12000, 1000),
    webhookTimeoutMs: intEnv("WEBHOOK_TIMEOUT_MS", 8000, 1000),
    checkMinIntervalSeconds,
    lockSeconds: Math.max(15, Math.min(55, checkMinIntervalSeconds || 45)),
    maxBackoffSeconds: intEnv("MAX_BACKOFF_SECONDS", 900, 1),
    notifyInitial: boolEnv("NOTIFY_INITIAL", false),
    notifyInitialStock: boolEnv("NOTIFY_INITIAL_STOCK", false),
    userAgent: process.env.MONITOR_USER_AGENT || "ChromeHeartsMonitor/1.0"
  };
}

function getCronSecret() {
  return process.env.CRON_SECRET || "";
}

function nowIso() {
  return new Date().toISOString();
}

function absoluteUrl(url) {
  if (!url) return "";
  return new URL(url, BASE_URL).toString();
}

function categoryFromUrl(url) {
  try {
    const path = new URL(url).pathname.replace(/^\/+|\/+$/g, "");
    return path ? path.split("/")[0].replaceAll("-", " ").toUpperCase() : "";
  } catch {
    return "";
  }
}

function truncate(value, limit) {
  const text = String(value || "").trim();
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 3))}...`;
}

function priceText(price) {
  if (!price) return "";
  const value = Number.parseFloat(price);
  return Number.isFinite(value) ? `$${value.toLocaleString("en-US", { maximumFractionDigits: 0 })}` : String(price);
}

function compactList(values, limit = 1024) {
  const cleanValues = values.map((value) => String(value || "").trim()).filter(Boolean);
  const text = cleanValues.join(", ");
  if (text && text.length <= limit) return text;

  const visible = [];
  for (const value of cleanValues) {
    const candidate = [...visible, value].join(", ");
    if (candidate.length > Math.max(0, limit - 20)) break;
    visible.push(value);
  }

  const remaining = cleanValues.length - visible.length;
  if (visible.length === 0) return remaining > 0 ? `${remaining} more` : "";
  return remaining > 0 ? `${visible.join(", ")} +${remaining} more` : visible.join(", ");
}

function productGridUrl(start, pageSize) {
  const url = new URL(PRODUCT_GRID_BASE_URL);
  url.searchParams.set("cgid", "root");
  url.searchParams.set("start", String(start));
  url.searchParams.set("sz", String(pageSize));
  return url.toString();
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function parseRetryAfter(headers) {
  const value = headers.get("retry-after");
  if (!value) return null;
  const seconds = Number.parseFloat(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds);
  const dateMs = Date.parse(value);
  if (Number.isFinite(dateMs)) return Math.max(0, (dateMs - Date.now()) / 1000);
  return null;
}

async function fetchHtml(url, cfg) {
  const response = await fetchWithTimeout(
    url,
    {
      headers: {
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        referer: `${BASE_URL}/`,
        "user-agent": cfg.userAgent
      },
      cache: "no-store"
    },
    cfg.requestTimeoutMs
  );

  if (!response.ok) {
    throw new HttpStatusError(
      `Chrome Hearts returned HTTP ${response.status}`,
      response.status,
      parseRetryAfter(response.headers)
    );
  }

  return response.text();
}

function parseProducts(html) {
  const $ = cheerio.load(html);
  const products = {};

  $("div.product[data-pid]").each((_, el) => {
    const root = $(el);
    const classes = String(root.attr("class") || "").split(/\s+/);
    const metadata = root.find("span.product-metadata").first();
    const pid = String(metadata.attr("data-pid") || root.attr("data-pid") || "").trim();
    const href =
      root.find('a.link[href*=".html"]').first().attr("href") ||
      root.find('a.pdp-link-image[href*=".html"]').first().attr("href") ||
      "";
    const url = absoluteUrl(href);

    if (!pid || !url) return;

    const productType = classes.find((value) => value.startsWith("productType-"))?.replace("productType-", "") || "";
    const image = root.find("img.tile-image").first().attr("src") || "";

    products[pid] = {
      pid,
      name: String(metadata.attr("data-name") || pid).trim(),
      price: String(metadata.attr("data-price") || "").trim(),
      brand: String(metadata.attr("data-brand") || "Chrome Hearts").trim(),
      category: String(metadata.attr("data-category") || categoryFromUrl(url)).trim(),
      productType,
      url,
      image: image ? absoluteUrl(image) : ""
    };
  });

  return products;
}

async function fetchProducts(cfg) {
  const allProducts = {};

  for (let page = 0; page < cfg.maxPages; page += 1) {
    const start = page * cfg.pageSize;
    const pageProducts = parseProducts(await fetchHtml(productGridUrl(start, cfg.pageSize), cfg));
    const pagePids = Object.keys(pageProducts);
    let newOnPage = 0;

    for (const [pid, product] of Object.entries(pageProducts)) {
      if (!allProducts[pid]) newOnPage += 1;
      allProducts[pid] = product;
    }

    if (pagePids.length < cfg.pageSize) break;
    if (newOnPage === 0) {
      throw new MonitorError(`Pagination did not advance at start=${start}; refusing duplicate full page.`);
    }
  }

  const count = Object.keys(allProducts).length;
  if (count < cfg.minProducts) {
    throw new MonitorError(`Fetched only ${count} products; refusing to update state below MIN_PRODUCTS=${cfg.minProducts}.`);
  }

  return allProducts;
}

function createRedis(cfg) {
  async function command(args) {
    const response = await fetchWithTimeout(
      cfg.redisUrl,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${cfg.redisToken}`,
          "content-type": "application/json"
        },
        body: JSON.stringify(args),
        cache: "no-store"
      },
      cfg.requestTimeoutMs
    );

    const bodyText = await response.text();
    let body = {};
    try {
      body = bodyText ? JSON.parse(bodyText) : {};
    } catch {
      throw new MonitorError(`Redis returned non-JSON response (${response.status}).`);
    }

    if (!response.ok || body.error) {
      throw new MonitorError(`Redis command failed: ${body.error || response.status}`);
    }
    return body.result;
  }

  return { command };
}

function defaultState() {
  return { seen: {}, createdAt: nowIso(), updatedAt: nowIso(), errorStreak: 0, backoffUntil: null };
}

function parseState(raw) {
  if (!raw) {
    return defaultState();
  }
  try {
    const state = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!state.seen || typeof state.seen !== "object" || Array.isArray(state.seen)) {
      throw new Error("invalid seen map");
    }
    return {
      ...state,
      updatedAt: state.updatedAt || nowIso(),
      errorStreak: Number.isFinite(state.errorStreak) ? state.errorStreak : 0,
      backoffUntil: state.backoffUntil || null
    };
  } catch (error) {
    throw new MonitorError(`Stored state is unreadable: ${error.message}`);
  }
}

function createRedisStore(cfg) {
  const redis = createRedis(cfg);

  return {
    backend: "redis",
    async loadState() {
      return parseState(await redis.command(["GET", cfg.stateKey]));
    },
    async saveState(state) {
      await redis.command(["SET", cfg.stateKey, JSON.stringify({ ...state, updatedAt: nowIso() })]);
    },
    async acquireLock() {
      const token = crypto.randomUUID();
      const result = await redis.command(["SET", cfg.lockKey, token, "NX", "EX", String(cfg.lockSeconds)]);
      return result === "OK" ? token : null;
    },
    async releaseLock(token) {
      try {
        const value = await redis.command(["GET", cfg.lockKey]);
        if (value === token) await redis.command(["DEL", cfg.lockKey]);
      } catch {
      }
    }
  };
}

async function readBlobJson(pathname) {
  try {
    const result = await blobGet(pathname, { access: "private", useCache: false });
    if (!result) return null;
    const text =
      result.blob && typeof result.blob.text === "function"
        ? await result.blob.text()
        : await new Response(result.stream).text();
    return JSON.parse(text);
  } catch (error) {
    if (error instanceof BlobNotFoundError) return null;
    throw error;
  }
}

async function deleteBlobIfMatches(pathname, etag = undefined) {
  try {
    await blobDel(pathname, { access: "private", ...(etag ? { ifMatch: etag } : {}) });
  } catch (error) {
    if (error instanceof BlobNotFoundError || error instanceof BlobPreconditionFailedError) return;
    throw error;
  }
}

function createBlobStore(cfg) {
  return {
    backend: "blob",
    async loadState() {
      return parseState(await readBlobJson(cfg.blobStatePath));
    },
    async saveState(state) {
      await blobPut(cfg.blobStatePath, JSON.stringify({ ...state, updatedAt: nowIso() }), {
        access: "private",
        allowOverwrite: true,
        contentType: "application/json",
        cacheControlMaxAge: 60
      });
    },
    async acquireLock() {
      const token = crypto.randomUUID();
      const expiresAt = new Date(Date.now() + cfg.lockSeconds * 1000).toISOString();
      const existing = await readBlobJson(cfg.blobLockPath);

      if (existing?.expiresAt && Date.parse(existing.expiresAt) > Date.now()) {
        return null;
      }

      if (existing) {
        try {
          const details = await blobHead(cfg.blobLockPath, { access: "private" });
          await deleteBlobIfMatches(cfg.blobLockPath, details?.etag);
        } catch (error) {
          if (!(error instanceof BlobNotFoundError)) throw error;
        }
      }

      try {
        await blobPut(cfg.blobLockPath, JSON.stringify({ token, expiresAt }), {
          access: "private",
          allowOverwrite: false,
          contentType: "application/json",
          cacheControlMaxAge: 60
        });
        return token;
      } catch {
        return null;
      }
    },
    async releaseLock(token) {
      try {
        const existing = await readBlobJson(cfg.blobLockPath);
        if (existing?.token === token) {
          const details = await blobHead(cfg.blobLockPath, { access: "private" });
          await deleteBlobIfMatches(cfg.blobLockPath, details?.etag);
        }
      } catch {
      }
    }
  };
}

function createStorage(cfg) {
  return cfg.storageBackend === "redis" ? createRedisStore(cfg) : createBlobStore(cfg);
}

async function loadState(redis, cfg) {
  const raw = await redis.command(["GET", cfg.stateKey]);
  if (!raw) {
    return { seen: {}, createdAt: nowIso(), updatedAt: nowIso(), errorStreak: 0, backoffUntil: null };
  }
  try {
    const state = JSON.parse(raw);
    if (!state.seen || typeof state.seen !== "object" || Array.isArray(state.seen)) {
      throw new Error("invalid seen map");
    }
    return {
      ...state,
      updatedAt: state.updatedAt || nowIso(),
      errorStreak: Number.isFinite(state.errorStreak) ? state.errorStreak : 0,
      backoffUntil: state.backoffUntil || null
    };
  } catch (error) {
    throw new MonitorError(`Stored state is unreadable: ${error.message}`);
  }
}

async function saveState(redis, cfg, state) {
  await redis.command(["SET", cfg.stateKey, JSON.stringify({ ...state, updatedAt: nowIso() })]);
}

async function acquireLock(redis, cfg) {
  const token = crypto.randomUUID();
  const result = await redis.command(["SET", cfg.lockKey, token, "NX", "EX", String(cfg.lockSeconds)]);
  return result === "OK" ? token : null;
}

async function releaseLock(redis, cfg, token) {
  try {
    const value = await redis.command(["GET", cfg.lockKey]);
    if (value === token) await redis.command(["DEL", cfg.lockKey]);
  } catch {
  }
}

function isAuthorized(req, cronSecret) {
  if (!cronSecret) return true;
  const header = req.headers.authorization || "";
  return header === `Bearer ${cronSecret}`;
}

function sizeLabels(product, inStock) {
  return (product.sizes || [])
    .filter((size) => size.inStock === inStock)
    .map((size) => size.label || size.code)
    .filter(Boolean);
}

function stockSummary(product) {
  if (!product.sizes || product.sizes.length === 0) {
    return product.detailError ? "✠ PDP STOCK UNAVAILABLE" : "✠ STOCK SIGNAL HIDDEN";
  }

  if (product.inStockSizeCount > 0) {
    return `✠ LIVE // ${product.inStockSizeCount}/${product.sizes.length} sizes`;
  }

  return `✠ DARK // 0/${product.sizes.length} sizes`;
}

function stockTotalSummary(product) {
  if (product.exactStockKnown) return `† EXACT // ${product.totalStock ?? "unknown"}`;
  if (Number.isFinite(product.cappedOrderableTotal)) return `† EXACT HIDDEN // CART CAP ${product.cappedOrderableTotal}`;
  return "† EXACT HIDDEN BY SITE";
}

function mergeProductDetail(product, detail) {
  const sizes = detail?.sizes || [];
  return {
    ...product,
    name: detail?.name || product.name,
    price: detail?.price || product.price,
    brand: detail?.brand || product.brand,
    category: detail?.category || product.category,
    image: detail?.image || product.image,
    images: detail?.images || (product.image ? [product.image] : []),
    masterPid: detail?.masterPid || product.pid,
    selectedVariantPid: detail?.selectedVariantPid || "",
    maxOrderQuantity: detail?.maxOrderQuantity ?? null,
    productAvailable: detail?.productAvailable ?? null,
    readyToOrder: detail?.readyToOrder ?? null,
    availabilityMessages: detail?.availabilityMessages || [],
    stockSource: detail?.stockSource || "PDP HTML",
    exactStockKnown: Boolean(detail?.exactStockKnown),
    totalStock: detail?.totalStock ?? null,
    inStockSizeCount: detail?.inStockSizeCount ?? sizes.filter((size) => size.inStock).length,
    cappedOrderableTotal: detail?.cappedOrderableTotal ?? null,
    sizes,
    enrichedAt: detail?.checkedAt || nowIso()
  };
}

async function enrichProduct(product, cfg, deps = { fetchStockSnapshot }) {
  try {
    const detail = await deps.fetchStockSnapshot(product.url, {
      timeoutMs: cfg.requestTimeoutMs,
      userAgent: cfg.userAgent
    });
    return mergeProductDetail(product, detail);
  } catch (error) {
    return {
      ...product,
      masterPid: product.pid,
      selectedVariantPid: "",
      maxOrderQuantity: null,
      productAvailable: null,
      readyToOrder: null,
      availabilityMessages: [],
      stockSource: "",
      exactStockKnown: false,
      totalStock: null,
      inStockSizeCount: 0,
      cappedOrderableTotal: null,
      sizes: [],
      detailError: error.message,
      enrichedAt: nowIso()
    };
  }
}

async function enrichProducts(products, cfg, deps = { fetchStockSnapshot }) {
  const enriched = [];
  for (const product of products) {
    enriched.push(await enrichProduct(product, cfg, deps));
  }
  return enriched;
}

function buildProductEmbed(product) {
  const price = priceText(product.price) || "unknown";
  const inStock = compactList(sizeLabels(product, true)) || "none";
  const outOfStock = compactList(sizeLabels(product, false)) || "none";
  const live = product.inStockSizeCount > 0;
  const fields = [
    { name: "✠ Price", value: truncate(price, 1024), inline: true },
    { name: "✠ Stock", value: truncate(stockSummary(product), 1024), inline: true },
    { name: "† Inventory", value: truncate(stockTotalSummary(product), 1024), inline: true },
    { name: "⛓ Sizes live", value: truncate(`「 ${inStock} 」`, 1024), inline: false },
    { name: "⌁ Sizes gone", value: truncate(`「 ${outOfStock} 」`, 1024), inline: false },
    { name: "◇ Category", value: truncate(product.category || "unknown", 1024), inline: true },
    { name: "⟡ PID", value: truncate(product.masterPid || product.pid, 1024), inline: true }
  ];

  if (product.selectedVariantPid) {
    fields.push({ name: "◇ Variant", value: truncate(product.selectedVariantPid, 1024), inline: true });
  }
  if (product.stockSource) {
    const available = product.productAvailable === null ? "unknown" : String(Boolean(product.productAvailable));
    const ready = product.readyToOrder === null ? "unknown" : String(Boolean(product.readyToOrder));
    fields.push({
      name: "⌁ SFCC signal",
      value: truncate(`${product.stockSource} // available=${available} // ready=${ready}`, 1024),
      inline: false
    });
  }
  if (product.detailError) {
    fields.push({ name: "⌁ PDP", value: truncate(`detail fetch failed: ${product.detailError}`, 1024), inline: false });
  }

  const embed = {
    author: {
      name: "✠ CHROME HEARTS // DROP SIGNAL ✠",
      url: BASE_URL
    },
    title: truncate(`† ${product.name || product.pid}`, 256),
    url: product.url,
    description: truncate(
      `> ${live ? "LIVE FROM THE GRID" : "GRID HIT // STOCK MUTED"}\n` +
        `> ${price} // ${product.brand || "Chrome Hearts"} // ${product.productType || "product"}`,
      4096
    ),
    color: live ? 0xd7d7d7 : 0x3a3a3a,
    fields,
    footer: { text: "† chrome hearts monitor // low-noise demandware signal †" },
    timestamp: nowIso()
  };

  if (product.image) embed.image = { url: product.image };
  return embed;
}

function buildEmbeds(products) {
  return products.map((product) => {
    return buildProductEmbed(product);
  });
}

async function sendDiscord(cfg, products) {
  for (let index = 0; index < products.length; index += 10) {
    const chunk = products.slice(index, index + 10);
    const payload = {
      username: "✠ CHROME HEARTS // MONITOR ✠",
      content:
        chunk.length === 1
          ? "✠ **CHROME HEARTS // NEW ITEM LOADED** ✠"
          : `✠ **CHROME HEARTS // ${chunk.length} NEW ITEMS LOADED** ✠`,
      embeds: buildEmbeds(chunk)
    };

    let attempt = 0;
    while (true) {
      const response = await fetchWithTimeout(
        cfg.discordWebhookUrl,
        {
          method: "POST",
          headers: { "content-type": "application/json", "user-agent": cfg.userAgent },
          body: JSON.stringify(payload),
          cache: "no-store"
        },
        cfg.webhookTimeoutMs
      );

      if (response.ok) break;

      if (response.status === 429 && attempt < 3) {
        let retryAfterSeconds = parseRetryAfter(response.headers) || 1;
        try {
          const body = await response.json();
          if (Number.isFinite(body.retry_after)) retryAfterSeconds = body.retry_after;
        } catch {
          // Header/default retry-after is enough.
        }
        await new Promise((resolve) => setTimeout(resolve, retryAfterSeconds * 1000));
        attempt += 1;
        continue;
      }

      throw new HttpStatusError(`Discord webhook returned HTTP ${response.status}`, response.status, parseRetryAfter(response.headers));
    }
  }
}

function buildStockEmbed(snapshot, diff) {
  const inStockLabels = snapshot.sizes.filter((size) => size.inStock).map((size) => size.label || size.code);
  const outOfStockLabels = snapshot.sizes.filter((size) => !size.inStock).map((size) => size.label || size.code);
  const changes = diff.sizeChanges.length
    ? diff.sizeChanges.map((change) => `${change.label || change.code}: ${change.from} -> ${change.to}`).join("\n")
    : diff.firstRun
      ? "Initial stock baseline"
      : "No size-level changes";

  return {
    title: truncate(`† ${snapshot.name || snapshot.masterPid || "Product"} stock update`, 256),
    url: snapshot.sourceUrl,
    color: snapshot.inStockSizeCount > 0 ? 0xd7d7d7 : 0x3a3a3a,
    fields: [
      { name: "⟡ Master PID", value: truncate(snapshot.masterPid || "unknown", 1024), inline: true },
      { name: "✠ Live sizes", value: truncate(`${snapshot.inStockSizeCount}/${snapshot.sizes.length}`, 1024), inline: true },
      {
        name: "† Inventory",
        value: truncate(
          snapshot.cappedOrderableTotal === null ? "exact hidden by site" : `exact hidden // cart cap ${snapshot.cappedOrderableTotal}`,
          1024
        ),
        inline: true
      },
      {
        name: "⛓ In",
        value: truncate(`「 ${inStockLabels.join(", ") || "none"} 」`, 1024),
        inline: false
      },
      { name: "⌁ Out", value: truncate(`「 ${outOfStockLabels.join(", ") || "none"} 」`, 1024), inline: false },
      { name: "◇ Changes", value: truncate(changes, 1024), inline: false }
    ],
    footer: { text: "† chrome hearts stock monitor †" },
    timestamp: snapshot.checkedAt
  };
}

function shouldSendStockAlert(diff, cfg) {
  if (!diff) return false;
  if (diff.firstRun) return cfg.notifyInitialStock;
  return diff.sizeChanges.length > 0 || diff.inStockSizeCountChange !== 0 || diff.cappedOrderableTotalChange !== 0;
}

async function sendStockDiscord(cfg, snapshot, diff) {
  const response = await fetchWithTimeout(
    cfg.discordWebhookUrl,
    {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": cfg.userAgent },
      body: JSON.stringify({
        username: "✠ CHROME HEARTS // MONITOR ✠",
        content: `† **${snapshot.name || snapshot.masterPid || "Chrome Hearts product"} // STOCK SIGNAL** †`,
        embeds: [buildStockEmbed(snapshot, diff)]
      }),
      cache: "no-store"
    },
    cfg.webhookTimeoutMs
  );

  if (!response.ok) {
    throw new HttpStatusError(`Discord webhook returned HTTP ${response.status}`, response.status, parseRetryAfter(response.headers));
  }
}

function computeBackoffUntil(state, cfg, error) {
  const retryAfterSeconds = Number(error?.details?.retryAfterSeconds || error?.retryAfterSeconds || 0);
  const streak = Math.max(1, Number(state.errorStreak || 0) + 1);
  const exponential = Math.min(cfg.maxBackoffSeconds, Math.max(cfg.checkMinIntervalSeconds, 2 ** Math.min(streak - 1, 8)));
  const baseSeconds = retryAfterSeconds || exponential;
  const jitterSeconds = Math.random() * Math.min(10, baseSeconds * 0.1);
  return {
    errorStreak: streak,
    backoffUntil: new Date(Date.now() + (baseSeconds + jitterSeconds) * 1000).toISOString()
  };
}

function shouldSkipForInterval(state, cfg) {
  if (!state.lastRunAt || cfg.checkMinIntervalSeconds === 0) return false;
  const elapsed = Date.now() - Date.parse(state.lastRunAt);
  return Number.isFinite(elapsed) && elapsed < cfg.checkMinIntervalSeconds * 1000;
}

function jsonResponse(res, statusCode, body) {
  res.status(statusCode).json(body);
}

async function runMonitor(
  cfg,
  storage,
  deps = {}
) {
  const services = {
    fetchProducts,
    fetchStockSnapshot,
    stockDiff: calculateStockDiff,
    enrichProducts,
    sendDiscord,
    sendStockDiscord,
    ...deps
  };
  let state = await storage.loadState();
  const now = Date.now();

  if (state.backoffUntil && Date.parse(state.backoffUntil) > now) {
    return { ok: true, skipped: "backoff", backoffUntil: state.backoffUntil };
  }
  if (shouldSkipForInterval(state, cfg)) {
    return { ok: true, skipped: "min_interval", lastRunAt: state.lastRunAt };
  }

  const lockToken = await storage.acquireLock();
  if (!lockToken) {
    return { ok: true, skipped: "locked", storage: storage.backend };
  }

  try {
    const products = await services.fetchProducts(cfg);
    state = await storage.loadState();
    const firstRun = Object.keys(state.seen || {}).length === 0;
    const newProducts = Object.values(products).filter((product) => !state.seen[product.pid]);
    const productsToAlert = firstRun && !cfg.notifyInitial ? [] : newProducts;
    const enrichedProductsToAlert =
      productsToAlert.length > 0
        ? await services.enrichProducts(productsToAlert, cfg, { fetchStockSnapshot: services.fetchStockSnapshot })
        : [];

    let stockSnapshot = null;
    let stockDelta = null;
    let stockAlerted = false;
    let stockError = null;

    if (cfg.stockProductUrl) {
      try {
        stockSnapshot = await services.fetchStockSnapshot(cfg.stockProductUrl, {
          timeoutMs: cfg.requestTimeoutMs,
          userAgent: cfg.userAgent
        });
        stockDelta = services.stockDiff(state.stockSnapshot || null, stockSnapshot);
      } catch (error) {
        stockError = error.message;
      }
    }

    if (enrichedProductsToAlert.length > 0) {
      await services.sendDiscord(cfg, enrichedProductsToAlert);
    }

    if (shouldSendStockAlert(stockDelta, cfg)) {
      await services.sendStockDiscord(cfg, stockSnapshot, stockDelta);
      stockAlerted = true;
    }

    await storage.saveState({
      ...state,
      seen: { ...state.seen, ...products },
      ...(stockSnapshot ? { stockSnapshot } : {}),
      lastRunAt: nowIso(),
      errorStreak: 0,
      backoffUntil: null
    });

    return {
      ok: true,
      baseline: firstRun && !cfg.notifyInitial,
      productCount: Object.keys(products).length,
      alerted: enrichedProductsToAlert.length,
      newPids: productsToAlert.map((product) => product.pid),
      enriched: enrichedProductsToAlert.map((product) => ({
        pid: product.pid,
        inStockSizeCount: product.inStockSizeCount ?? null,
        sizeCount: (product.sizes || []).length,
        hasImage: Boolean(product.image),
        detailError: product.detailError || null
      })),
      stock: stockSnapshot
        ? {
            product: stockSnapshot.masterPid,
            inStockSizeCount: stockSnapshot.inStockSizeCount,
            cappedOrderableTotal: stockSnapshot.cappedOrderableTotal,
            exactStockKnown: stockSnapshot.exactStockKnown,
            alerted: stockAlerted,
            changes: stockDelta?.sizeChanges || []
          }
        : cfg.stockProductUrl
          ? { product: cfg.stockProductUrl, alerted: false, error: stockError || "stock unavailable" }
          : null,
      storage: storage.backend
    };
  } catch (error) {
    const currentState = await storage.loadState().catch(() => state);
    const backoff = computeBackoffUntil(currentState, cfg, error);
    await storage.saveState({ ...currentState, ...backoff, lastError: error.message, lastErrorAt: nowIso() }).catch(() => {});
    throw error;
  } finally {
    await storage.releaseLock(lockToken);
  }
}

export default async function handler(req, res) {
  if (!["GET", "POST"].includes(req.method || "GET")) {
    res.setHeader("allow", "GET, POST");
    return jsonResponse(res, 405, { ok: false, error: "Method not allowed" });
  }

  if (!isAuthorized(req, getCronSecret())) {
    return jsonResponse(res, 401, { ok: false, error: "Unauthorized" });
  }

  let cfg;
  try {
    cfg = getConfig();
  } catch (error) {
    return jsonResponse(res, 500, { ok: false, error: error.message });
  }

  try {
    const result = await runMonitor(cfg, createStorage(cfg));
    return jsonResponse(res, 200, result);
  } catch (error) {
    const statusCode = error instanceof MonitorError ? error.statusCode : 500;
    return jsonResponse(res, statusCode, { ok: false, error: error.message, details: error.details || {} });
  }
}

export {
  MonitorError,
  absoluteUrl,
  buildEmbeds,
  buildProductEmbed,
  compactList,
  categoryFromUrl,
  computeBackoffUntil,
  createBlobStore,
  createRedis,
  createRedisStore,
  createStorage,
  enrichProduct,
  enrichProducts,
  fetchProducts,
  getConfig,
  getCronSecret,
  isAuthorized,
  parseProducts,
  priceText,
  productGridUrl,
  runMonitor,
  sendDiscord,
  sendStockDiscord,
  shouldSkipForInterval,
  shouldSendStockAlert,
  truncate
};
