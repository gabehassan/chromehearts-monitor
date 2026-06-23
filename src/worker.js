import * as cheerio from "cheerio";

const BASE_URL = "https://www.chromehearts.com";
const PRODUCT_GRID_BASE_URL =
  "https://www.chromehearts.com/on/demandware.store/Sites-ChromeHearts-Site/en_US/Search-UpdateGrid";
const PRODUCT_VARIATION_BASE_URL =
  "https://www.chromehearts.com/on/demandware.store/Sites-ChromeHearts-Site/en_US/Product-Variation";
const DEFAULT_STATE_KEY = "chrome-hearts:cloudflare:state";
const DEFAULT_LOCK_KEY = "chrome-hearts:cloudflare:lock";
const DEFAULT_USER_AGENT = "ChromeHeartsMonitor/1.0";
const RESERVED_CATEGORY_IDS = new Set([
  "account",
  "cart",
  "checkout",
  "customer-service",
  "login",
  "on",
  "search",
  "wishlist"
]);

class MonitorError extends Error {
  constructor(message, statusCode = 500, details = {}) {
    super(message);
    this.name = "MonitorError";
    this.statusCode = statusCode;
    this.details = details;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function intSetting(env, name, fallback, min = 0) {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value < min) {
    throw new MonitorError(`${name} must be an integer >= ${min}`);
  }
  return value;
}

function boolSetting(env, name, fallback = false) {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(raw).toLowerCase());
}

function getConfig(env) {
  if (!env.STATE) throw new MonitorError("Missing STATE KV binding.");
  if (!env.DISCORD_WEBHOOK_URL) throw new MonitorError("Missing DISCORD_WEBHOOK_URL secret.");

  const checkMinIntervalSeconds = intSetting(env, "CHECK_MIN_INTERVAL_SECONDS", 240, 0);
  return {
    stateKey: env.STATE_KEY || DEFAULT_STATE_KEY,
    lockKey: env.LOCK_KEY || DEFAULT_LOCK_KEY,
    discordWebhookUrl: env.DISCORD_WEBHOOK_URL,
    cronSecret: env.CRON_SECRET || "",
    dashboardUsername: env.DASHBOARD_USERNAME || "chrome-hearts",
    dashboardPassword: env.DASHBOARD_PASSWORD || env.CRON_SECRET || "",
    pageSize: intSetting(env, "PAGE_SIZE", 200, 1),
    maxPages: intSetting(env, "MAX_PAGES", 10, 1),
    maxCategoryPages: intSetting(env, "MAX_CATEGORY_PAGES", 2, 1),
    maxCategoryIds: intSetting(env, "MAX_CATEGORY_IDS", 20, 1),
    minProducts: intSetting(env, "MIN_PRODUCTS", 1, 0),
    maxAlertsPerRun: intSetting(env, "MAX_ALERTS_PER_RUN", 5, 1),
    relistAfterAbsentRuns: intSetting(env, "RELIST_AFTER_ABSENT_RUNS", 2, 1),
    notifyInitial: boolSetting(env, "NOTIFY_INITIAL", false),
    discoverSitemapCategories: boolSetting(env, "DISCOVER_SITEMAP_CATEGORIES", true),
    discoverHomepageCategories: boolSetting(env, "DISCOVER_HOMEPAGE_CATEGORIES", true),
    discoverProductUrlCategories: boolSetting(env, "DISCOVER_PRODUCT_URL_CATEGORIES", true),
    sitemapIndexUrl: env.SITEMAP_INDEX_URL || `${BASE_URL}/sitemap_index.xml`,
    extraCategoryIds: String(env.EXTRA_CATEGORY_IDS || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
    probeExactStock: boolSetting(env, "PROBE_EXACT_STOCK", true),
    exactStockProbeQuantity: intSetting(env, "EXACT_STOCK_PROBE_QUANTITY", 999, 1),
    exactStockProbeConcurrency: intSetting(env, "EXACT_STOCK_PROBE_CONCURRENCY", 3, 1),
    requestTimeoutMs: intSetting(env, "REQUEST_TIMEOUT_MS", 12000, 1000),
    webhookTimeoutMs: intSetting(env, "WEBHOOK_TIMEOUT_MS", 8000, 1000),
    checkMinIntervalSeconds,
    lockSeconds: Math.max(60, intSetting(env, "LOCK_SECONDS", 90, 60)),
    maxBackoffSeconds: intSetting(env, "MAX_BACKOFF_SECONDS", 900, 1),
    userAgent: env.MONITOR_USER_AGENT || DEFAULT_USER_AGENT
  };
}

function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...headers
    }
  });
}

function htmlResponse(body, status = 200) {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

function absoluteUrl(url) {
  if (!url) return "";
  return new URL(url, BASE_URL).toString();
}

function firstSrcsetUrl(srcset) {
  return (
    String(srcset || "")
      .split(",")
      .map((item) => item.trim().split(/\s+/)[0])
      .find(Boolean) || ""
  );
}

function uniqueValues(values) {
  return [...new Set(values.filter(Boolean))];
}

function truncate(value, limit) {
  const text = String(value || "").trim();
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 3))}...`;
}

function priceText(price) {
  if (!price) return "";
  const value = Number.parseFloat(String(price).replace(/[$,]/g, ""));
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

function fetchOptions(cfg, accept) {
  return {
    headers: {
      accept,
      referer: `${BASE_URL}/`,
      "user-agent": cfg.userAgent
    },
    cache: "no-store"
  };
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const signal = typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(timeoutMs) : undefined;
  return fetch(url, { ...options, signal });
}

function productGridUrl(cgid, start, pageSize) {
  const url = new URL(PRODUCT_GRID_BASE_URL);
  url.searchParams.set("cgid", cgid);
  url.searchParams.set("start", String(start));
  url.searchParams.set("sz", String(pageSize));
  return url.toString();
}

function categoryFromUrl(url) {
  try {
    const path = new URL(url).pathname.replace(/^\/+|\/+$/g, "");
    return path ? path.split("/")[0].replaceAll("-", " ").toUpperCase() : "";
  } catch {
    return "";
  }
}

async function fetchHtml(url, cfg) {
  const response = await fetchWithTimeout(
    url,
    fetchOptions(cfg, "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"),
    cfg.requestTimeoutMs
  );
  if (!response.ok) throw new MonitorError(`Chrome Hearts returned HTTP ${response.status}`, 502);
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

function extractXmlLocations(xml) {
  return [...String(xml || "").matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)].map((match) => match[1].trim());
}

function categoryIdFromUrl(value) {
  try {
    const url = new URL(value);
    if (url.origin !== BASE_URL) return "";
    const path = url.pathname.replace(/^\/+|\/+$/g, "");
    const firstSegment = path.split("/")[0];
    if (!firstSegment || firstSegment.includes(".") || RESERVED_CATEGORY_IDS.has(firstSegment)) return "";
    if (path.includes("demandware.store")) return "";
    return firstSegment;
  } catch {
    return "";
  }
}

async function fetchSitemapCategoryIds(cfg) {
  if (!cfg.discoverSitemapCategories) return [];
  try {
    const indexResponse = await fetchWithTimeout(
      cfg.sitemapIndexUrl,
      fetchOptions(cfg, "application/xml,text/xml,*/*;q=0.8"),
      cfg.requestTimeoutMs
    );
    if (!indexResponse.ok) return [];

    const sitemapUrls = extractXmlLocations(await indexResponse.text()).filter((url) => url.endsWith(".xml"));
    const categoryIds = [];
    for (const sitemapUrl of sitemapUrls.slice(0, 5)) {
      const response = await fetchWithTimeout(sitemapUrl, fetchOptions(cfg, "application/xml,text/xml,*/*;q=0.8"), cfg.requestTimeoutMs);
      if (!response.ok) continue;
      for (const loc of extractXmlLocations(await response.text())) {
        const categoryId = categoryIdFromUrl(loc);
        if (categoryId) categoryIds.push(categoryId);
      }
    }
    return categoryIds;
  } catch {
    return [];
  }
}

async function fetchHomepageCategoryIds(cfg) {
  if (!cfg.discoverHomepageCategories) return [];
  try {
    const html = await fetchHtml(BASE_URL, cfg);
    const hrefs = [...html.matchAll(/\bhref=["']([^"']+)["']/gi)].map((match) => absoluteUrl(match[1]));
    return hrefs.map(categoryIdFromUrl).filter(Boolean);
  } catch {
    return [];
  }
}

async function productCategoryIds(cfg) {
  const ids = ["root", ...(await fetchSitemapCategoryIds(cfg)), ...(await fetchHomepageCategoryIds(cfg)), ...cfg.extraCategoryIds];
  return [...new Set(ids)].slice(0, cfg.maxCategoryIds);
}

async function fetchProductsForCategory(cgid, cfg, maxPages) {
  const allProducts = {};
  for (let page = 0; page < maxPages; page += 1) {
    const start = page * cfg.pageSize;
    const pageProducts = parseProducts(await fetchHtml(productGridUrl(cgid, start, cfg.pageSize), cfg));
    const pagePids = Object.keys(pageProducts);
    let newOnPage = 0;

    for (const [pid, product] of Object.entries(pageProducts)) {
      if (!allProducts[pid]) newOnPage += 1;
      allProducts[pid] = product;
    }

    if (pagePids.length < cfg.pageSize) break;
    if (newOnPage === 0) {
      throw new MonitorError(`Pagination did not advance for cgid=${cgid} start=${start}; refusing duplicate full page.`);
    }
  }
  return allProducts;
}

async function fetchProducts(cfg) {
  const allProducts = {};
  const categoryIds = await productCategoryIds(cfg);
  const queuedCategoryIds = [...categoryIds];
  const visitedCategoryIds = new Set();

  for (let index = 0; index < queuedCategoryIds.length && visitedCategoryIds.size < cfg.maxCategoryIds; index += 1) {
    const cgid = queuedCategoryIds[index];
    if (!cgid || visitedCategoryIds.has(cgid)) continue;
    visitedCategoryIds.add(cgid);

    const maxPages = cgid === "root" ? cfg.maxPages : cfg.maxCategoryPages;
    const products = await fetchProductsForCategory(cgid, cfg, maxPages);
    for (const [pid, product] of Object.entries(products)) {
      allProducts[pid] = product;
    }

    if (cfg.discoverProductUrlCategories) {
      for (const product of Object.values(products)) {
        const categoryId = categoryIdFromUrl(product.url);
        if (categoryId && !visitedCategoryIds.has(categoryId) && !queuedCategoryIds.includes(categoryId)) {
          queuedCategoryIds.push(categoryId);
        }
      }
    }
  }

  const count = Object.keys(allProducts).length;
  if (count < cfg.minProducts) {
    throw new MonitorError(`Fetched only ${count} products; refusing update below MIN_PRODUCTS=${cfg.minProducts}.`);
  }
  return allProducts;
}

function collectProductImages($) {
  return uniqueValues([
    $("meta[property='og:image']").attr("content"),
    $("img[data-large-img]").first().attr("data-large-img"),
    $("img[data-large-img]").first().attr("src"),
    firstSrcsetUrl($("source[srcset]").first().attr("srcset")),
    $("img.tile-image").first().attr("src"),
    $("picture img").first().attr("src")
  ]).map(absoluteUrl);
}

function cleanDescriptionText(value) {
  const raw = String(value || "");
  const text = /<[a-z][\s\S]*>/i.test(raw) ? cheerio.load(raw).text() : raw;
  return text
    .replace(/\u00a0/g, " ")
    .replace(/[ \t\r\f\v]+/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

function meaningfulDescription(value) {
  const description = cleanDescriptionText(value);
  if (!description) return "";
  if (description.toLowerCase().includes("the official website of chrome hearts")) return "";
  return description;
}

function parseClasses(value) {
  return String(value || "")
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseJsonLd(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function findAvailability(value) {
  if (!value || typeof value !== "object") return "";
  if (Array.isArray(value)) return value.map(findAvailability).find(Boolean) || "";

  const type = Array.isArray(value["@type"]) ? value["@type"].join(" ") : String(value["@type"] || "");
  if (type.toLowerCase().includes("product")) {
    const offers = Array.isArray(value.offers) ? value.offers : [value.offers];
    const availability = offers.map((offer) => offer?.availability).find(Boolean);
    if (availability) return String(availability);
  }

  return Object.values(value).map(findAvailability).find(Boolean) || "";
}

function findProductDescription(value) {
  if (!value || typeof value !== "object") return "";
  if (Array.isArray(value)) return value.map(findProductDescription).find(Boolean) || "";

  const type = Array.isArray(value["@type"]) ? value["@type"].join(" ") : String(value["@type"] || "");
  if (type.toLowerCase().includes("product")) {
    const description = meaningfulDescription(value.description);
    if (description) return description;
  }

  return Object.values(value).map(findProductDescription).find(Boolean) || "";
}

function schemaAvailability($) {
  return (
    $("script[type='application/ld+json']")
      .toArray()
      .map((script) => findAvailability(parseJsonLd($(script).text())))
      .find(Boolean) || ""
  );
}

function schemaDescription($) {
  return (
    $("script[type='application/ld+json']")
      .toArray()
      .map((script) => findProductDescription(parseJsonLd($(script).text())))
      .find(Boolean) || ""
  );
}

function detailsDescription($) {
  const detailBlocks = $("[id^='collapsible-details-']")
    .toArray()
    .filter((element) => !String($(element).attr("id") || "").toLowerCase().includes("returns"));
  const otherBlocks = $("[itemprop='description'], .product-description, .long-description, .short-description").toArray();

  for (const element of [...detailBlocks, ...otherBlocks]) {
    const root = $(element);
    const listItems = root
      .find("li")
      .toArray()
      .map((li) => meaningfulDescription($(li).text()))
      .filter(Boolean);
    const description = listItems.length ? listItems.join("\n") : meaningfulDescription(root.text());
    if (description) return description;
  }
  return "";
}

function productDescription($) {
  return (
    detailsDescription($) ||
    schemaDescription($) ||
    meaningfulDescription($("meta[property='og:description']").attr("content")) ||
    meaningfulDescription($("meta[name='description']").attr("content"))
  );
}

function isSchemaInStock(availability) {
  const text = String(availability || "").toLowerCase();
  if (text.includes("outofstock") || text.includes("discontinued") || text.includes("soldout")) return false;
  return text.includes("instock") || text.includes("limitedavailability");
}

function hasEnabledAddToCart($) {
  const button = $("button.add-to-cart").first();
  if (!button.length) return false;
  const classes = parseClasses(button.attr("class"));
  return !button.attr("disabled") && !classes.includes("disabled");
}

function oneSizeCode(masterPid, selectedVariantPid) {
  return `${masterPid} ${selectedVariantPid}`.includes("OSZ") ? "OSZ" : "ONE_SIZE";
}

function normalizeUrl(rawUrl) {
  return rawUrl ? absoluteUrl(rawUrl) : "";
}

function normalizeVariationUrl(rawUrl, sizeCode) {
  if (!rawUrl) return "";
  const url = new URL(absoluteUrl(rawUrl));
  for (const key of [...url.searchParams.keys()]) {
    if (key.startsWith("dwvar_") && key.endsWith("_size") && !url.searchParams.get(key)) {
      url.searchParams.set(key, sizeCode);
    }
  }
  return url.toString();
}

function quantityUrl(rawUrl, quantity) {
  if (!rawUrl) return "";
  const url = new URL(absoluteUrl(rawUrl));
  url.searchParams.set("quantity", String(quantity));
  return url.toString();
}

function defaultVariationUrl($) {
  return normalizeUrl(
    $(".product-metadata").first().attr("data-defaultvariant-url") ||
      $(".product-metadata-defvar-url").first().attr("data-defaultvariant-url") ||
      $("select.quantity-select option[data-url]").first().attr("data-url") ||
      $("input.quantity-select").first().attr("data-url")
  );
}

function productVariationUrl(pid, quantity = 1) {
  if (!pid) return "";
  const url = new URL(PRODUCT_VARIATION_BASE_URL);
  url.searchParams.set("pid", pid);
  url.searchParams.set("quantity", String(quantity));
  return url.toString();
}

function isVariationInStock(product) {
  const messages = product?.availability?.messages || [];
  const text = messages.join(" ").toLowerCase();
  if (text.includes("out of stock") || text.includes("unavailable")) return false;
  return Boolean(product?.available || product?.readyToOrder || text.includes("in stock"));
}

function maxOrderQuantityFromProduct(product) {
  const direct = Number.parseInt(product?.maxOrderQuantity, 10);
  if (Number.isFinite(direct)) return direct;
  return (
    (product?.quantities || [])
      .map((quantity) => Number.parseInt(quantity.value, 10))
      .filter(Number.isFinite)
      .sort((a, b) => b - a)[0] || null
  );
}

function parseStockNumber(value) {
  const number = Number.parseInt(String(value || "").replace(/,/g, ""), 10);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function exactStockFromMessages(messages = []) {
  const text = messages.join(" ");
  const patterns = [
    /([\d,]+)\s*item\s*\(s\)\s*in\s*stock/i,
    /([\d,]+)\s*items?\s*in\s*stock/i,
    /only\s*([\d,]+)\s*items?\s*(?:left|available)/i,
    /([\d,]+)\s*items?\s*(?:left|available)/i
  ];

  for (const pattern of patterns) {
    const stock = parseStockNumber(text.match(pattern)?.[1]);
    if (stock !== null) return stock;
  }
  return null;
}

function exactStockFromProduct(product) {
  const directFields = [
    product?.ats,
    product?.stockLevel,
    product?.inventory,
    product?.availability?.ats,
    product?.availability?.stockLevel,
    product?.availability?.inventory,
    product?.availability?.quantity
  ];

  for (const value of directFields) {
    const stock = parseStockNumber(value);
    if (stock !== null) return stock;
  }
  return exactStockFromMessages(product?.availability?.messages || []);
}

function parseProductVariationJson(body, pageUrl = "") {
  const product = body?.product || {};
  const sizeAttribute = (product.variationAttributes || []).find(
    (attribute) => attribute?.attributeId === "size" || attribute?.id === "size"
  );
  const masterPid = String(product.masterProductId || product.id || "").trim();
  const selectedVariantPid = String(product.id || "").trim();
  const maxOrderQuantity = maxOrderQuantityFromProduct(product);
  let sizes = [];

  if (sizeAttribute?.values?.length) {
    sizes = sizeAttribute.values
      .filter((value) => value?.id)
      .map((value) => ({
        code: String(value.id),
        label: String(value.displayValue || value.value || value.id).trim(),
        selected: Boolean(value.selected),
        inStock: Boolean(value.selectable),
        selectable: Boolean(value.selectable),
        variationUrl: normalizeVariationUrl(value.url, String(value.id)) || pageUrl
      }));
  } else if (selectedVariantPid) {
    const inStock = isVariationInStock(product);
    sizes = [
      {
        code: oneSizeCode(masterPid, selectedVariantPid),
        label: "OS",
        selected: true,
        inStock,
        selectable: inStock,
        variationUrl: pageUrl
      }
    ];
  }

  const inStockSizeCount = sizes.filter((size) => size.inStock).length;
  return {
    masterPid,
    selectedVariantPid,
    maxOrderQuantity,
    productAvailable: Boolean(product.available),
    readyToOrder: Boolean(product.readyToOrder),
    availabilityMessages: product.availability?.messages || [],
    exactStockKnown: false,
    totalStock: null,
    inStockSizeCount,
    cappedOrderableTotal: maxOrderQuantity === null ? null : inStockSizeCount * maxOrderQuantity,
    sizes,
    stockSource: "Product-Variation JSON"
  };
}

function applyVariationStock(snapshot, variation) {
  if (!variation || !variation.sizes?.length) return snapshot;
  return {
    ...snapshot,
    masterPid: variation.masterPid || snapshot.masterPid,
    selectedVariantPid: variation.selectedVariantPid || snapshot.selectedVariantPid,
    maxOrderQuantity: variation.maxOrderQuantity ?? snapshot.maxOrderQuantity,
    exactStockKnown: variation.exactStockKnown,
    totalStock: variation.totalStock,
    inStockSizeCount: variation.inStockSizeCount,
    cappedOrderableTotal: variation.cappedOrderableTotal,
    productAvailable: variation.productAvailable,
    readyToOrder: variation.readyToOrder,
    availabilityMessages: variation.availabilityMessages,
    sizes: variation.sizes,
    stockSource: variation.stockSource
  };
}

function parseProductStockPage(html, pageUrl = "") {
  const $ = cheerio.load(html);
  const metadata = $(".product-metadata").first();
  const productDetail = $(".product-detail[data-pid]").first();
  const images = collectProductImages($);
  const masterPid = String(metadata.attr("data-pid") || "").trim();
  const selectedVariantPid = String(productDetail.attr("data-pid") || metadata.attr("data-defaultvariant-id") || "").trim();
  const availability = schemaAvailability($);
  const variationUrl = defaultVariationUrl($) || productVariationUrl(masterPid);
  const maxOrderQuantity =
    $("select.quantity-select option")
      .toArray()
      .map((option) => Number.parseInt($(option).attr("value") || $(option).text(), 10))
      .filter(Number.isFinite)
      .sort((a, b) => b - a)[0] ||
    Number.parseInt($("input.quantity-select").first().attr("max"), 10) ||
    null;

  let sizes = $("button.size-attribute")
    .toArray()
    .map((button) => {
      const root = $(button);
      const value = root.find("[data-attr-value]").first();
      const code = String(value.attr("data-attr-value") || root.attr("aria-describedby") || "").trim();
      const label = value.text().replace(/\s+/g, " ").trim() || code;
      const classes = parseClasses(value.attr("class"));
      const selected = classes.includes("selected");
      const selectable = classes.includes("selectable");
      const unselectable = classes.includes("unselectable");
      if (!code) return null;
      return {
        code,
        label,
        selected,
        inStock: selectable && !unselectable,
        selectable,
        variationUrl: normalizeVariationUrl(root.attr("data-url"), code)
      };
    })
    .filter(Boolean);

  if (sizes.length === 0 && (masterPid || selectedVariantPid)) {
    const inStock = isSchemaInStock(availability) || hasEnabledAddToCart($);
    sizes = [
      {
        code: oneSizeCode(masterPid, selectedVariantPid),
        label: "OS",
        selected: true,
        inStock,
        selectable: inStock,
        variationUrl: pageUrl || ""
      }
    ];
  }

  const inStockSizeCount = sizes.filter((size) => size.inStock).length;
  const cappedOrderableTotal = maxOrderQuantity === null ? null : inStockSizeCount * maxOrderQuantity;
  return {
    checkedAt: nowIso(),
    sourceUrl: pageUrl || "",
    masterPid,
    selectedVariantPid,
    name: String(metadata.attr("data-name") || $("h1").first().text() || "").trim(),
    price: String(metadata.attr("data-price") || "").trim(),
    brand: String(metadata.attr("data-brand") || "Chrome Hearts").trim(),
    category: String(metadata.attr("data-category") || "").trim(),
    description: productDescription($),
    image: images[0] || "",
    images,
    maxOrderQuantity,
    exactStockKnown: false,
    totalStock: null,
    inStockSizeCount,
    cappedOrderableTotal,
    sizes,
    stockSource: sizes.length > 0 ? "PDP HTML" : "",
    variationUrl
  };
}

async function mapWithConcurrency(values, concurrency, mapper) {
  const results = new Array(values.length);
  let index = 0;
  async function worker() {
    while (index < values.length) {
      const currentIndex = index;
      index += 1;
      results[currentIndex] = await mapper(values[currentIndex], currentIndex);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, worker));
  return results;
}

function exactStockTotal(sizes) {
  let total = 0;
  for (const size of sizes) {
    if (!size.inStock) continue;
    if (!Number.isFinite(size.exactStock)) return { exactStockKnown: false, totalStock: null };
    total += size.exactStock;
  }
  return { exactStockKnown: true, totalStock: total };
}

async function probeExactStock(snapshot, cfg) {
  const sizes = snapshot.sizes || [];
  if (!sizes.length) return snapshot;

  const nextSizes = await mapWithConcurrency(sizes, cfg.exactStockProbeConcurrency, async (size) => {
    if (!size.inStock) return { ...size, exactStockKnown: true, exactStock: 0 };
    if (!size.variationUrl) return size;

    try {
      const response = await fetchWithTimeout(
        quantityUrl(size.variationUrl, cfg.exactStockProbeQuantity),
        {
          headers: {
            accept: "application/json, text/javascript, */*; q=0.01",
            "user-agent": cfg.userAgent,
            "x-requested-with": "XMLHttpRequest"
          },
          cache: "no-store"
        },
        cfg.requestTimeoutMs
      );
      if (!response.ok) return { ...size, exactStockError: `HTTP ${response.status}` };
      const stock = exactStockFromProduct((await response.json())?.product || {});
      return stock === null ? size : { ...size, exactStockKnown: true, exactStock: stock };
    } catch (error) {
      return { ...size, exactStockError: error.message };
    }
  });

  const { exactStockKnown, totalStock } = exactStockTotal(nextSizes);
  return {
    ...snapshot,
    sizes: nextSizes,
    exactStockKnown,
    totalStock,
    stockSource:
      exactStockKnown && !String(snapshot.stockSource || "").includes("exact quantity probe")
        ? `${snapshot.stockSource || "PDP HTML"} + exact quantity probe`
        : snapshot.stockSource
  };
}

async function fetchStockSnapshot(productUrl, cfg) {
  const response = await fetchWithTimeout(
    productUrl,
    fetchOptions(cfg, "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"),
    cfg.requestTimeoutMs
  );
  if (!response.ok) throw new MonitorError(`Chrome Hearts returned HTTP ${response.status}`, 502);

  let snapshot = parseProductStockPage(await response.text(), productUrl);
  if (!snapshot.masterPid && snapshot.sizes.length === 0 && !snapshot.image) {
    throw new MonitorError("Product detail page did not contain product metadata");
  }

  if (snapshot.variationUrl) {
    try {
      const variationResponse = await fetchWithTimeout(
        snapshot.variationUrl,
        {
          headers: {
            accept: "application/json, text/javascript, */*; q=0.01",
            "user-agent": cfg.userAgent,
            "x-requested-with": "XMLHttpRequest"
          },
          cache: "no-store"
        },
        cfg.requestTimeoutMs
      );
      if (variationResponse.ok) {
        snapshot = applyVariationStock(snapshot, parseProductVariationJson(await variationResponse.json(), snapshot.variationUrl));
      }
    } catch (error) {
      snapshot = { ...snapshot, stockSignalError: error.message };
    }
  }

  return cfg.probeExactStock ? probeExactStock(snapshot, cfg) : snapshot;
}

function defaultState() {
  return { seen: {}, active: {}, missing: {}, createdAt: nowIso(), updatedAt: nowIso(), errorStreak: 0, backoffUntil: null, lastResult: null };
}

function parseState(raw) {
  if (!raw) return defaultState();
  try {
    const state = JSON.parse(raw);
    if (!state.seen || typeof state.seen !== "object" || Array.isArray(state.seen)) {
      throw new Error("invalid seen map");
    }
    return {
      ...state,
      active: state.active && typeof state.active === "object" && !Array.isArray(state.active) ? state.active : null,
      missing: state.missing && typeof state.missing === "object" && !Array.isArray(state.missing) ? state.missing : {},
      updatedAt: state.updatedAt || nowIso(),
      errorStreak: Number.isFinite(state.errorStreak) ? state.errorStreak : 0,
      backoffUntil: state.backoffUntil || null,
      lastResult: state.lastResult || null
    };
  } catch (error) {
    throw new MonitorError(`Stored state is unreadable: ${error.message}`);
  }
}

async function loadState(env, cfg) {
  return parseState(await env.STATE.get(cfg.stateKey));
}

async function saveState(env, cfg, state) {
  await env.STATE.put(cfg.stateKey, JSON.stringify({ ...state, updatedAt: nowIso() }));
}

async function acquireLock(env, cfg) {
  const existingRaw = await env.STATE.get(cfg.lockKey);
  const existing = existingRaw ? JSON.parse(existingRaw) : null;
  if (existing?.expiresAt && Date.parse(existing.expiresAt) > Date.now()) return null;

  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + cfg.lockSeconds * 1000).toISOString();
  await env.STATE.put(cfg.lockKey, JSON.stringify({ token, expiresAt }), { expirationTtl: cfg.lockSeconds });
  return token;
}

function shouldSkipForInterval(state, cfg) {
  if (!cfg.checkMinIntervalSeconds || !state.lastRunAt) return false;
  const elapsedSeconds = (Date.now() - Date.parse(state.lastRunAt)) / 1000;
  return Number.isFinite(elapsedSeconds) && elapsedSeconds < cfg.checkMinIntervalSeconds;
}

function computeBackoffUntil(state, cfg) {
  const streak = Math.max(1, Number(state.errorStreak || 0) + 1);
  const seconds = Math.min(cfg.maxBackoffSeconds, Math.max(cfg.checkMinIntervalSeconds || 60, 2 ** Math.min(streak - 1, 8)));
  return {
    errorStreak: streak,
    backoffUntil: new Date(Date.now() + seconds * 1000).toISOString()
  };
}

function sizeLabels(product, inStock) {
  return (product.sizes || [])
    .filter((size) => size.inStock === inStock)
    .map((size) => {
      const label = size.label || size.code;
      if (inStock && Number.isFinite(size.exactStock)) return `${label} (${size.exactStock})`;
      return label;
    })
    .filter(Boolean);
}

function stockSummary(product) {
  if (!product.sizes || product.sizes.length === 0) return product.detailError ? "Unavailable" : "Awaiting size data";
  if (product.inStockSizeCount > 0) return `${product.inStockSizeCount} of ${product.sizes.length} sizes available`;
  return `0 of ${product.sizes.length} sizes available`;
}

function embedDescription(product, price) {
  const description = truncate(product.description || "", 4096);
  if (description) return description;
  return truncate(
    [product.brand || "Chrome Hearts", product.category || product.productType || "product", price]
      .map((part) => String(part || "").trim())
      .filter(Boolean)
      .join(", "),
    4096
  );
}

function mergeProductDetail(product, detail) {
  const sizes = detail?.sizes || [];
  return {
    ...product,
    name: detail?.name || product.name,
    price: detail?.price || product.price,
    brand: detail?.brand || product.brand,
    category: detail?.category || product.category,
    description: detail?.description || product.description || "",
    image: detail?.image || product.image,
    images: detail?.images || (product.image ? [product.image] : []),
    masterPid: detail?.masterPid || product.pid,
    selectedVariantPid: detail?.selectedVariantPid || "",
    stockSource: detail?.stockSource || "PDP HTML",
    exactStockKnown: Boolean(detail?.exactStockKnown),
    totalStock: detail?.totalStock ?? null,
    inStockSizeCount: detail?.inStockSizeCount ?? sizes.filter((size) => size.inStock).length,
    sizes,
    enrichedAt: detail?.checkedAt || nowIso()
  };
}

async function enrichProduct(product, cfg) {
  try {
    return mergeProductDetail(product, await fetchStockSnapshot(product.url, cfg));
  } catch (error) {
    return {
      ...product,
      masterPid: product.pid,
      selectedVariantPid: "",
      description: product.description || "",
      exactStockKnown: false,
      totalStock: null,
      inStockSizeCount: 0,
      sizes: [],
      detailError: error.message,
      enrichedAt: nowIso()
    };
  }
}

function buildProductEmbed(product) {
  const price = priceText(product.price) || "unknown";
  const inStock = compactList(sizeLabels(product, true)) || "none";
  const outOfStock = compactList(sizeLabels(product, false)) || "none";
  const live = product.inStockSizeCount > 0;
  const fields = [
    { name: "Price", value: truncate(price, 1024), inline: true },
    { name: "Availability", value: truncate(stockSummary(product), 1024), inline: true },
    { name: "Category", value: truncate(product.category || "unknown", 1024), inline: true },
    { name: "Available sizes", value: truncate(inStock, 1024), inline: false },
    { name: "Unavailable sizes", value: truncate(outOfStock, 1024), inline: false },
    { name: "Product ID", value: truncate(product.masterPid || product.pid, 1024), inline: true }
  ];

  if (product.exactStockKnown) {
    fields.splice(2, 0, { name: "Exact stock", value: truncate(`${product.totalStock ?? "unknown"} units`, 1024), inline: true });
  }
  if (product.selectedVariantPid) fields.push({ name: "Variant", value: truncate(product.selectedVariantPid, 1024), inline: true });
  if (product.detailError) {
    fields.push({ name: "Details", value: truncate(`Product page detail unavailable: ${product.detailError}`, 1024), inline: false });
  }

  const embed = {
    author: { name: "Chrome Hearts Drop Monitor", url: BASE_URL },
    title: truncate(product.name || product.pid, 256),
    url: product.url,
    description: embedDescription(product, price),
    color: live ? 0xb8f3d4 : 0xb7b2ff,
    fields,
    footer: { text: "Chrome Hearts monitor - new item alert" },
    timestamp: nowIso()
  };
  if (product.image) embed.image = { url: product.image };
  return embed;
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendDiscord(cfg, products) {
  for (let index = 0; index < products.length; index += 10) {
    const chunk = products.slice(index, index + 10);
    const payload = {
      username: "Chrome Hearts Monitor",
      content: chunk.length === 1 ? "New Chrome Hearts item loaded" : `${chunk.length} new Chrome Hearts items loaded`,
      embeds: chunk.map(buildProductEmbed)
    };

    for (let attempt = 0; attempt < 4; attempt += 1) {
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
        const retryAfter = Number.parseFloat(response.headers.get("retry-after") || "1");
        await sleep(Math.max(1, retryAfter) * 1000);
        continue;
      }
      throw new MonitorError(`Discord webhook returned HTTP ${response.status}`, 502);
    }
  }
}

function productStateRecord(product, previousRecord, now) {
  return {
    ...(previousRecord || {}),
    pid: product.pid,
    name: product.name,
    price: product.price,
    category: product.category,
    url: product.url,
    image: product.image,
    firstSeenAt: previousRecord?.firstSeenAt || now,
    lastSeenAt: now
  };
}

function relistEligible(pid, previousSeen, previousActive, previousMissing, cfg) {
  if (!previousSeen[pid] || previousActive[pid]) return false;
  return Number(previousMissing[pid]?.count || 0) >= cfg.relistAfterAbsentRuns;
}

function buildCatalogState(products, state, deferredPids, cfg) {
  const previousSeen = state.seen || {};
  const previousActive = state.active || previousSeen;
  const previousMissing = state.missing || {};
  const seen = { ...previousSeen };
  const active = { ...previousActive };
  const missing = { ...previousMissing };
  const now = nowIso();
  const currentPids = new Set(Object.keys(products));

  for (const [pid, product] of Object.entries(products)) {
    if (deferredPids.has(pid)) continue;
    seen[pid] = productStateRecord(product, seen[pid], now);
    active[pid] = productStateRecord(product, active[pid] || seen[pid], now);
    delete missing[pid];
  }

  for (const pid of Object.keys(previousActive)) {
    if (currentPids.has(pid)) continue;
    const previous = previousMissing[pid] || {};
    const count = Number(previous.count || 0) + 1;
    missing[pid] = {
      pid,
      firstMissingAt: previous.firstMissingAt || now,
      lastMissingAt: now,
      count
    };
    if (count >= cfg.relistAfterAbsentRuns) delete active[pid];
  }

  return { seen, active, missing };
}

async function runMonitor(env, cfg = getConfig(env)) {
  const lockToken = await acquireLock(env, cfg);
  if (!lockToken) return { ok: true, skipped: true, reason: "locked", storage: "cloudflare-kv" };

  let state = await loadState(env, cfg);
  try {
    if (state.backoffUntil && Date.parse(state.backoffUntil) > Date.now()) {
      return { ok: true, skipped: true, reason: "backoff", backoffUntil: state.backoffUntil, storage: "cloudflare-kv" };
    }
    if (shouldSkipForInterval(state, cfg)) {
      return { ok: true, skipped: true, reason: "interval", lastRunAt: state.lastRunAt, storage: "cloudflare-kv" };
    }

    const products = await fetchProducts(cfg);
    const previousSeen = state.seen || {};
    const previousActive = state.active || previousSeen;
    const previousMissing = state.missing || {};
    const newPids = Object.keys(products).filter(
      (pid) => !previousSeen[pid] || relistEligible(pid, previousSeen, previousActive, previousMissing, cfg)
    );
    const firstRun = Object.keys(previousSeen).length === 0;
    const baseline = firstRun && !cfg.notifyInitial;
    const candidates = baseline ? [] : newPids.map((pid) => products[pid]);
    const productsToAlert = candidates.slice(0, cfg.maxAlertsPerRun);
    const deferredProducts = candidates.slice(cfg.maxAlertsPerRun);
    const deferredPids = new Set(deferredProducts.map((product) => product.pid));
    const enriched = [];

    for (const product of productsToAlert) {
      enriched.push(await enrichProduct(product, cfg));
    }
    if (enriched.length) await sendDiscord(cfg, enriched);

    const result = {
      ok: true,
      baseline,
      productCount: Object.keys(products).length,
      alerted: enriched.length,
      deferred: deferredProducts.length,
      newPids: productsToAlert.map((product) => product.pid),
      storage: "cloudflare-kv",
      checkedAt: nowIso()
    };

    await saveState(env, cfg, {
      ...state,
      ...buildCatalogState(products, state, baseline ? new Set() : deferredPids, cfg),
      lastRunAt: nowIso(),
      lastResult: result,
      errorStreak: 0,
      backoffUntil: null,
      lastError: null,
      lastErrorAt: null
    });

    return result;
  } catch (error) {
    const backoff = computeBackoffUntil(state, cfg);
    await saveState(env, cfg, {
      ...state,
      ...backoff,
      lastError: error.message,
      lastErrorAt: nowIso(),
      lastResult: { ok: false, error: error.message, checkedAt: nowIso() }
    }).catch(() => {});
    throw error;
  }
}

function isAuthorized(request, cfg) {
  if (!cfg.cronSecret) return true;
  return request.headers.get("authorization") === `Bearer ${cfg.cronSecret}`;
}

function decodeBasicCredentials(header) {
  const match = String(header || "").match(/^Basic\s+(.+)$/i);
  if (!match) return null;
  try {
    const decoded = atob(match[1]);
    const separatorIndex = decoded.indexOf(":");
    if (separatorIndex === -1) return null;
    return {
      username: decoded.slice(0, separatorIndex),
      password: decoded.slice(separatorIndex + 1)
    };
  } catch {
    return null;
  }
}

function isPrivatePageAuthorized(request, cfg) {
  if (!cfg.dashboardPassword && !cfg.cronSecret) return true;
  if (isAuthorized(request, cfg)) return true;

  const credentials = decodeBasicCredentials(request.headers.get("authorization"));
  return Boolean(
    credentials &&
      credentials.username === cfg.dashboardUsername &&
      credentials.password === (cfg.dashboardPassword || cfg.cronSecret)
  );
}

function privatePageUnauthorized(request) {
  const wantsHtml = String(request.headers.get("accept") || "").includes("text/html");
  const headers = {
    "www-authenticate": 'Basic realm="Chrome Hearts Monitor", charset="UTF-8"',
    "cache-control": "no-store"
  };
  if (wantsHtml) {
    return new Response("<!doctype html><title>Private</title><h1>Private monitor</h1>", {
      status: 401,
      headers: { ...headers, "content-type": "text/html; charset=utf-8" }
    });
  }
  return jsonResponse({ ok: false, error: "Unauthorized" }, 401, headers);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function dashboard(state, cfg) {
  const last = state.lastResult || {};
  const seenCount = Object.keys(state.seen || {}).length;
  const status = last.ok === false ? "Issue" : state.lastRunAt ? "Online" : "Ready";
  const lastRun = state.lastRunAt || "Never";
  const next = cfg.checkMinIntervalSeconds ? `${cfg.checkMinIntervalSeconds}s minimum` : "No throttle";
  const lastProducts = last.productCount ?? seenCount;
  const updated = state.updatedAt || state.createdAt || nowIso();

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Chrome Hearts Monitor</title>
  <style>
    :root { color-scheme: dark; --bg: #080909; --panel: #121414; --line: #2a2d2d; --text: #f1f1ee; --muted: #a9aaa4; --mint: #b8f3d4; --blue: #b7b2ff; }
    * { box-sizing: border-box; }
    body { margin: 0; font: 14px/1.45 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: var(--bg); color: var(--text); }
    main { width: min(980px, calc(100vw - 32px)); margin: 0 auto; padding: 32px 0; }
    header { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; border-bottom: 1px solid var(--line); padding-bottom: 18px; }
    h1 { margin: 0; font-size: clamp(24px, 5vw, 44px); line-height: 1; letter-spacing: 0; }
    .pill { border: 1px solid var(--line); border-radius: 999px; padding: 8px 12px; color: var(--mint); white-space: nowrap; }
    .grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin: 22px 0; }
    .card { border: 1px solid var(--line); border-radius: 8px; background: var(--panel); padding: 14px; min-height: 96px; }
    .label { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: .08em; }
    .value { margin-top: 10px; font-size: 22px; font-weight: 700; overflow-wrap: anywhere; }
    section { border-top: 1px solid var(--line); padding-top: 18px; margin-top: 18px; }
    pre { white-space: pre-wrap; overflow-wrap: anywhere; background: #0c0d0d; border: 1px solid var(--line); border-radius: 8px; padding: 14px; color: var(--muted); }
    a { color: var(--blue); }
    @media (max-width: 760px) { header { display: block; } .pill { display: inline-block; margin-top: 14px; } .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <h1>Chrome Hearts Monitor</h1>
        <p>Cloudflare Worker cron, KV state, Discord product alerts.</p>
      </div>
      <div class="pill">${escapeHtml(status)}</div>
    </header>
    <div class="grid">
      <div class="card"><div class="label">Seen products</div><div class="value">${seenCount}</div></div>
      <div class="card"><div class="label">Last grid count</div><div class="value">${escapeHtml(lastProducts)}</div></div>
      <div class="card"><div class="label">Last alerted</div><div class="value">${escapeHtml(last.alerted ?? 0)}</div></div>
      <div class="card"><div class="label">Cadence</div><div class="value">${escapeHtml(next)}</div></div>
    </div>
    <section>
      <div class="label">Last run</div>
      <pre>${escapeHtml(lastRun)}</pre>
      <div class="label">State updated</div>
      <pre>${escapeHtml(updated)}</pre>
      <div class="label">Last result</div>
      <pre>${escapeHtml(JSON.stringify(last, null, 2))}</pre>
    </section>
    <section>
      <p><a href="/health">Health JSON</a>. Manual runs use <code>/api/cron</code> with the bearer secret.</p>
    </section>
  </main>
</body>
</html>`;
}

async function handleFetch(request, env) {
  let cfg;
  try {
    cfg = getConfig(env);
  } catch (error) {
    return jsonResponse({ ok: false, error: error.message }, 500);
  }

  const url = new URL(request.url);
  if (url.pathname === "/" || url.pathname === "/dashboard") {
    if (!isPrivatePageAuthorized(request, cfg)) return privatePageUnauthorized(request);
    return htmlResponse(dashboard(await loadState(env, cfg), cfg));
  }
  if (url.pathname === "/health") {
    if (!isPrivatePageAuthorized(request, cfg)) return privatePageUnauthorized(request);
    const state = await loadState(env, cfg);
    return jsonResponse({
      ok: true,
      storage: "cloudflare-kv",
      seen: Object.keys(state.seen || {}).length,
      lastRunAt: state.lastRunAt || null,
      lastResult: state.lastResult || null
    });
  }
  if (url.pathname === "/api/cron" || url.pathname === "/run") {
    if (!["GET", "POST"].includes(request.method)) return jsonResponse({ ok: false, error: "Method not allowed" }, 405);
    if (!isAuthorized(request, cfg)) return jsonResponse({ ok: false, error: "Unauthorized" }, 401);
    try {
      return jsonResponse(await runMonitor(env, cfg));
    } catch (error) {
      const status = error instanceof MonitorError ? error.statusCode : 500;
      return jsonResponse({ ok: false, error: error.message, details: error.details || {} }, status);
    }
  }
  return jsonResponse({ ok: false, error: "Not found" }, 404);
}

export default {
  fetch: handleFetch,
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(
      runMonitor(env).catch((error) => {
        console.error(error);
      })
    );
  }
};

export { parseProducts, parseProductStockPage, parseProductVariationJson, runMonitor };
