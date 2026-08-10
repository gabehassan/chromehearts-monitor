import * as cheerio from "cheerio";

const BASE_URL = "https://www.chromehearts.com";
const PRODUCT_GRID_BASE_URL =
  "https://www.chromehearts.com/on/demandware.store/Sites-ChromeHearts-Site/en_US/Search-UpdateGrid";
const PRODUCT_VARIATION_BASE_URL =
  "https://www.chromehearts.com/on/demandware.store/Sites-ChromeHearts-Site/en_US/Product-Variation";
const ROBOTS_URL = `${BASE_URL}/robots.txt`;
const DEFAULT_STATE_KEY = "chrome-hearts:cloudflare:state";
const DEFAULT_LOCK_KEY = "chrome-hearts:cloudflare:lock";
const DEFAULT_SETTINGS_KEY = "chrome-hearts:cloudflare:settings";
const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const DO_SINGLETON_NAME = "chrome-hearts-monitor";
const DO_FLUSH_EVERY_TICKS = 4;
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
const DEFAULT_PROSPECTIVE_CATEGORY_IDS = [
  "scents",
  "baccarat",
  "intimates",
  "socks",
  "boxers-leggings",
  "underwear",
  // Eyewear
  "eyewear",
  "sunglasses",
  "glasses",
  "eyeglasses",
  "silichrome",
  "rib-tank",
  "goggles",
  "sweatbands",
  "dipped-in-blue",
  "bandana",
  "bandanas",
  "bbq",
  "sexrecords",
  "stencil-denim",
  "match-point",
  "oddities",
  "oddities-lighter",
  "winter",
  "hoodie-sweats",
  "sports-mesh",
  "slo-ride",
  "safety-pin-set",
  "safety-pin",
  "1988",
  "hotel-slippers",
  "rollingstones",
  "plus7",
  "nude-rib-sports",
  "denims",
  "jewelry-roll",
  "ch-flannel",
  "chopsticks",
  "general",
  "99-eyes",
  "angel-medal",
  "hand-spray",
  "optical",
  "frames",
  "readers",
  "eyewear-accessories",
  // Jewelry
  "jewelry",
  "ring",
  "rings",
  "necklace",
  "necklaces",
  "bracelet",
  "bracelets",
  "earring",
  "earrings",
  "pendant",
  "pendants",
  "chain",
  "chains",
  "charm",
  "charms",
  "cuff",
  "cuffs",
  "dagger",
  "cross",
  "band",
  "bands",
  "wedding-bands",
  "silver",
  "gold",
  "22k-gold",
  "cemetery",
  "keeper",
  // Headwear
  "hat",
  "hats",
  "cap",
  "caps",
  "trucker",
  "trucker-hat",
  "trucker-hats",
  "beanie",
  "beanies",
  "bucket",
  "bucket-hat",
  "snapback",
  "baseball-cap",
  "fitted",
  "visor",
  // Tops
  "hoodie",
  "hoodies",
  "sweatshirt",
  "sweatshirts",
  "hoodies-sweatshirts",
  "sweatpants",
  "t-shirt",
  "t-shirts",
  "tee",
  "tees",
  "shirt",
  "shirts",
  "long-sleeve",
  "long-sleeves",
  "short-sleeve",
  "short-sleeves",
  "tank",
  "tanks",
  "polo",
  "polos",
  "crewneck",
  "thermal",
  "jersey",
  "sweater",
  "sweaters",
  "knit",
  "knitwear",
  "cardigan",
  "flannel",
  // Bottoms
  "denim",
  "jeans",
  "pants",
  "trousers",
  "shorts",
  "sweatshorts",
  "leggings",
  // Outerwear
  "jacket",
  "jackets",
  "outerwear",
  "coat",
  "coats",
  "vest",
  "vests",
  "fur",
  "leather-jacket",
  // Full looks
  "dress",
  "dresses",
  "skirt",
  "skirts",
  "jumpsuit",
  "overalls",
  "matty-boy",
  "made-in-hollywood",
  // Accessories
  "accessories",
  "wallet",
  "wallets",
  "belt",
  "belts",
  "bag",
  "bags",
  "backpack",
  "backpacks",
  "tote",
  "totes",
  "pouch",
  "pouches",
  "keychain",
  "keychains",
  "scarf",
  "scarves",
  "gloves",
  "tie",
  "ties",
  "leather",
  "leather-goods",
  "phone-case",
  "phone-cases",
  "cases",
  "patches",
  "pins",
  "stickers",
  "playing-cards",
  "cards",
  "lighter",
  "lighters",
  "zippo",
  "ashtray",
  "ashtrays",
  "flask",
  "flasks",
  "money-clip",
  "cigarette-case",
  // Footwear
  "footwear",
  "shoes",
  "sneakers",
  "boots",
  "sandals",
  "slides",
  "slippers",
  // Underwear / intimates
  "boxers",
  "bra",
  "bras",
  "briefs",
  "lingerie",
  // Home
  "home",
  "furniture",
  "homeware",
  "candles",
  "candle",
  "blanket",
  "blankets",
  "pillow",
  "pillows",
  "towel",
  "towels",
  "rug",
  "rugs",
  "mug",
  "mugs",
  "glassware",
  "plates",
  "decor",
  // Fragrance
  "fragrance",
  "fragrances",
  "scent",
  "perfume",
  "cologne",
  "parfum",
  // Merch / collabs / drop landings
  "collections",
  "collabs",
  "limited",
  "exclusive",
  "online-exclusive",
  "new",
  "new-arrivals",
  "just-dropped",
  "drops",
  "featured",
  "gifts",
  "mens",
  "womens",
  "kids",
  "clothing",
  "apparel"
];
const DEFAULT_SEARCH_QUERY_TERMS = [
  // Brand words
  "chrome",
  "hearts",
  "ch",
  // Motifs / lines
  "cross",
  "dagger",
  "cemetery",
  "keeper",
  "fleur",
  "star",
  "heart",
  "horseshoe",
  "matty",
  "boy",
  "hollywood",
  "foti",
  "trucker",
  "baccarat",
  // Apparel nouns
  "scarf",
  "hat",
  "cap",
  "beanie",
  "hoodie",
  "sweatshirt",
  "sweatpants",
  "sweatshorts",
  "tee",
  "shirt",
  "crew",
  "sleeve",
  "pocket",
  "thermal",
  "jersey",
  "sweater",
  "cardigan",
  "flannel",
  "denim",
  "jeans",
  "pants",
  "shorts",
  "leggings",
  "jacket",
  "coat",
  "vest",
  "parka",
  "dress",
  "skirt",
  "robe",
  "socks",
  "boxer",
  "boxers",
  "briefs",
  "bra",
  "tank",
  "polo",
  // Jewelry nouns
  "ring",
  "band",
  "bracelet",
  "necklace",
  "pendant",
  "chain",
  "charm",
  "earring",
  "cuff",
  "stud",
  "hoop",
  // Eyewear nouns
  "eyewear",
  "sunglasses",
  "glasses",
  "frame",
  "optical",
  // Accessories nouns
  "wallet",
  "belt",
  "bag",
  "tote",
  "backpack",
  "pouch",
  "keychain",
  "gloves",
  "tie",
  "case",
  "lighter",
  "ashtray",
  "flask",
  "deck",
  "cards",
  "dice",
  // Home / fragrance nouns
  "candle",
  "parfum",
  "perfume",
  "cologne",
  "eau",
  "blanket",
  "pillow",
  "towel",
  "rug",
  "mug",
  "glassware",
  // Materials
  "leather",
  "silver",
  "gold",
  "plated",
  "cashmere",
  "suede",
  "fur",
  "silichrome",
  "crossball",
  "bandana",
  "goggles",
  "sweatband",
  "sweatbands",
  "checkmate",
  "deadly",
  "doll",
  "dipped",
  "dib",
  "tiger",
  "flannel",
  "rib",
  "silk",
  "watch",
  "math",
  "ceiling",
  "hairy",
  "work",
  "school",
  "tart",
  "lowrider",
  "blueher",
  "edenbox",
  "oddities",
  "bbq",
  "stencil",
  "mesh",
  "safety",
  "pin",
  "lacquer",
  "hotel",
  "slipper",
  "jean",
  "denims",
  "chopsticks",
  "roll",
  "spray",
  "medal",
  "eyes"
];

const INT_SETTING_LIMITS = {
  categoryFetchConcurrency: [1, 24],
  checkMinIntervalSeconds: [0, 3600],
  maxAlertsPerRun: [1, 10],
  maxCategoryIds: [1, 400],
  maxCategoryPages: [1, 5],
  maxDirectProductUrls: [0, 50],
  maxStorefrontSubrequests: [10, 400],
  maxPages: [1, 20],
  prospectiveCategoryShardSize: [1, 400],
  relistAfterAbsentRuns: [1, 12]
};
const BOOL_SETTING_KEYS = [
  "discoverSitemapCategories",
  "discoverHomepageCategories",
  "discoverProductUrlCategories",
  "discoverRobotsProducts",
  "probeExactStock"
];

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
  if (!env.DISCORD_WEBHOOK_URL && !env.DISCORD_WEBHOOK_URLS && !env.DISCORD_MAIN_WEBHOOK_URL) {
    throw new MonitorError("Missing DISCORD_WEBHOOK_URL secret.");
  }

  const checkMinIntervalSeconds = intSetting(env, "CHECK_MIN_INTERVAL_SECONDS", 50, 0);
  return {
    stateKey: env.STATE_KEY || DEFAULT_STATE_KEY,
    lockKey: env.LOCK_KEY || DEFAULT_LOCK_KEY,
    settingsKey: env.SETTINGS_KEY || DEFAULT_SETTINGS_KEY,
    discordWebhookUrls: parseWebhookUrls(
      `${env.DISCORD_MAIN_WEBHOOK_URL || ""} ${env.DISCORD_WEBHOOK_URL || ""} ${env.DISCORD_WEBHOOK_URLS || ""}`
    ),
    discordMainWebhookUrl: parseWebhookUrls(env.DISCORD_MAIN_WEBHOOK_URL || "")[0] || null,
    cronSecret: env.CRON_SECRET || "",
    dashboardUsername: env.DASHBOARD_USERNAME || "chrome-hearts",
    dashboardPassword: env.DASHBOARD_PASSWORD || env.CRON_SECRET || "",
    pageSize: intSetting(env, "PAGE_SIZE", 200, 1),
    maxPages: intSetting(env, "MAX_PAGES", 10, 1),
    maxCategoryPages: intSetting(env, "MAX_CATEGORY_PAGES", 2, 1),
    maxCategoryIds: intSetting(env, "MAX_CATEGORY_IDS", 250, 1),
    categoryFetchConcurrency: intSetting(env, "CATEGORY_FETCH_CONCURRENCY", 14, 1),
    maxDirectProductUrls: intSetting(env, "MAX_DIRECT_PRODUCT_URLS", 5, 0),
    maxStorefrontSubrequests: intSetting(env, "MAX_STOREFRONT_SUBREQUESTS", 260, 10),
    scanAllCategoriesOnFullSweep: boolSetting(env, "SCAN_ALL_CATEGORIES_ON_FULL_SWEEP", true),
    prospectiveCategoryShardSize: intSetting(env, "PROSPECTIVE_CATEGORY_SHARD_SIZE", 60, 1),
    minProducts: intSetting(env, "MIN_PRODUCTS", 1, 0),
    maxAlertsPerRun: intSetting(env, "MAX_ALERTS_PER_RUN", 5, 1),
    relistAfterAbsentRuns: intSetting(env, "RELIST_AFTER_ABSENT_RUNS", 2, 1),
    notifyInitial: boolSetting(env, "NOTIFY_INITIAL", false),
    discoverSitemapCategories: boolSetting(env, "DISCOVER_SITEMAP_CATEGORIES", true),
    discoverHomepageCategories: boolSetting(env, "DISCOVER_HOMEPAGE_CATEGORIES", true),
    discoverProductUrlCategories: boolSetting(env, "DISCOVER_PRODUCT_URL_CATEGORIES", true),
    discoverRobotsProducts: boolSetting(env, "DISCOVER_ROBOTS_PRODUCTS", true),
    sitemapIndexUrl: env.SITEMAP_INDEX_URL || `${BASE_URL}/sitemap_index.xml`,
    extraCategoryIds: String(env.EXTRA_CATEGORY_IDS || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
    prospectiveCategoryIds: parseCategoryIds(
      env.PROSPECTIVE_CATEGORY_IDS === undefined ? DEFAULT_PROSPECTIVE_CATEGORY_IDS.join(",") : env.PROSPECTIVE_CATEGORY_IDS
    ),
    extraProductUrls: String(env.EXTRA_PRODUCT_URLS || "")
      .split(/[\s,]+/)
      .map((value) => productUrlFromUrl(value))
      .filter(Boolean),
    probeExactStock: boolSetting(env, "PROBE_EXACT_STOCK", true),
    exactStockProbeQuantity: intSetting(env, "EXACT_STOCK_PROBE_QUANTITY", 999, 1),
    exactStockProbeConcurrency: intSetting(env, "EXACT_STOCK_PROBE_CONCURRENCY", 3, 1),
    requestTimeoutMs: intSetting(env, "REQUEST_TIMEOUT_MS", 12000, 1000),
    webhookTimeoutMs: intSetting(env, "WEBHOOK_TIMEOUT_MS", 8000, 1000),
    checkMinIntervalSeconds,
    lockSeconds: Math.max(10, intSetting(env, "LOCK_SECONDS", 30, 5)),
    maxBackoffSeconds: intSetting(env, "MAX_BACKOFF_SECONDS", 900, 1),
    fastPollEnabled: boolSetting(env, "FAST_POLL_ENABLED", true),
    fastPollIntervalSeconds: intSetting(env, "FAST_POLL_INTERVAL_SECONDS", 15, 5),
    fullSweepEveryTicks: intSetting(env, "FULL_SWEEP_EVERY_TICKS", 4, 1),
    fastCategoryShardSize: intSetting(env, "FAST_CATEGORY_SHARD_SIZE", 40, 0),
    fastMaxCategories: intSetting(env, "FAST_MAX_CATEGORIES", 45, 2),
    subrequestHardCap: intSetting(env, "SUBREQUEST_HARD_CAP", 46, 0),
    discoveryEveryFullSweeps: intSetting(env, "DISCOVERY_EVERY_FULL_SWEEPS", 10, 1),
    fanoutEnabled: boolSetting(env, "FANOUT_ENABLED", true),
    fanoutSliceSize: intSetting(env, "FANOUT_SLICE_SIZE", 30, 5),
    rootLaneEnabled: boolSetting(env, "ROOT_LANE_ENABLED", true),
    rootCatalogCgid: env.ROOT_CATALOG_CGID || "root",
    rootCatalogPageSize: intSetting(env, "ROOT_CATALOG_PAGE_SIZE", 200, 1),
    rootCatalogMaxPages: intSetting(env, "ROOT_CATALOG_MAX_PAGES", 12, 1),
    rootAuditEveryTicks: intSetting(env, "ROOT_AUDIT_EVERY_TICKS", 20, 0),
    categoryStatusEveryTicks: intSetting(env, "CATEGORY_STATUS_EVERY_TICKS", 20, 0),
    searchQueries: uniqueValues(
      String(env.SEARCH_QUERIES === undefined ? "chrome,hearts" : env.SEARCH_QUERIES)
        .split(/[\s,]+/)
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean)
    ).slice(0, 5),
    searchQueryTerms: uniqueValues(
      String(env.SEARCH_QUERY_TERMS === undefined ? DEFAULT_SEARCH_QUERY_TERMS.join(",") : env.SEARCH_QUERY_TERMS)
        .split(/[\s,]+/)
        .map((value) => value.trim().toLowerCase())
        .filter((value) => /^[a-z0-9-]+$/.test(value))
    ).slice(0, 200),
    // Structured run logging for debugging + data collection.
    logBufferSize: intSetting(env, "LOG_BUFFER_SIZE", 600, 0),
    logVerbose: boolSetting(env, "LOG_VERBOSE", true),
    workersPlan: String(env.WORKERS_PLAN || "free").toLowerCase() === "paid" ? "paid" : "free",
    stagingLaneEnabled: boolSetting(env, "STAGING_LANE_ENABLED", true),
    hotWatchLimit: intSetting(env, "HOT_WATCH_LIMIT", 24, 0),
    stagedIntelPings: boolSetting(env, "STAGED_INTEL_PINGS", false),
    enumerationEnabled: boolSetting(env, "ENUMERATION_ENABLED", true),
    enumerationRecentDays: intSetting(env, "ENUMERATION_RECENT_DAYS", 14, 0),
    restockCooldownHours: intSetting(env, "RESTOCK_COOLDOWN_HOURS", 12, 0),
    burstWindowSeconds: intSetting(env, "BURST_WINDOW_SECONDS", 180, 0),
    burstIntervalSeconds: intSetting(env, "BURST_INTERVAL_SECONDS", 5, 3),
    burstProbeBudget: intSetting(env, "BURST_PROBE_BUDGET", 80, 0),
    probeBudgetPerTick: intSetting(env, "PROBE_BUDGET_PER_TICK", 26, 0),
    pingFirstAlerts: boolSetting(env, "PING_FIRST_ALERTS", true),
    freshMissingGraceMinutes: intSetting(env, "FRESH_MISSING_GRACE_MINUTES", 30, 0),
    userAgent: env.MONITOR_USER_AGENT || DEFAULT_USER_AGENT
  };
}

function applyPlanPreset(cfg) {
  if (cfg.workersPlan !== "paid") return cfg;
  return {
    ...cfg,
    fastPollIntervalSeconds: Math.min(cfg.fastPollIntervalSeconds, 6),
    fastMaxCategories: Math.max(cfg.fastMaxCategories, 220),
    maxStorefrontSubrequests: Math.max(cfg.maxStorefrontSubrequests, 260),
    subrequestHardCap: Math.max(cfg.subrequestHardCap, 950),
    maxCategoryIds: Math.max(cfg.maxCategoryIds, 260),
    categoryFetchConcurrency: Math.max(cfg.categoryFetchConcurrency, 20),
    discoveryEveryFullSweeps: Math.min(cfg.discoveryEveryFullSweeps, 5),
    hotWatchLimit: Math.max(cfg.hotWatchLimit, 48),
    probeBudgetPerTick: Math.max(cfg.probeBudgetPerTick, 60)
  };
}

function parseSettings(raw) {
  if (!raw) return {};
  try {
    const settings = JSON.parse(raw);
    return settings && typeof settings === "object" && !Array.isArray(settings) ? settings : {};
  } catch {
    return {};
  }
}

async function loadSettings(env, cfg) {
  return parseSettings(await env.STATE.get(cfg.settingsKey));
}

function applyRuntimeSettings(cfg, settings) {
  const next = { ...cfg };
  for (const [key, [min, max]] of Object.entries(INT_SETTING_LIMITS)) {
    if (Number.isInteger(settings[key]) && settings[key] >= min && settings[key] <= max) next[key] = settings[key];
  }
  for (const key of BOOL_SETTING_KEYS) {
    if (typeof settings[key] === "boolean") next[key] = settings[key];
  }
  if (Array.isArray(settings.extraCategoryIds)) {
    next.extraCategoryIds = settings.extraCategoryIds.map((value) => String(value || "").trim()).filter(Boolean);
  }
  if (Array.isArray(settings.extraProductUrls)) {
    next.extraProductUrls = settings.extraProductUrls.map((value) => productUrlFromUrl(value)).filter(Boolean);
  }
  if (Array.isArray(settings.discordWebhookUrls)) {
    const list = settings.discordWebhookUrls.filter((url) => typeof url === "string" && isValidDiscordWebhookUrl(url));
    if (list.length) next.discordWebhookUrls = uniqueValues(list);
  } else if (typeof settings.discordWebhookUrl === "string" && isValidDiscordWebhookUrl(settings.discordWebhookUrl)) {
    // Back-compat with the old single-webhook setting.
    next.discordWebhookUrls = [settings.discordWebhookUrl];
  }
  if (typeof settings.discordMainWebhookUrl === "string" && isValidDiscordWebhookUrl(settings.discordMainWebhookUrl)) {
    if ((next.discordWebhookUrls || []).includes(settings.discordMainWebhookUrl)) {
      next.discordMainWebhookUrl = settings.discordMainWebhookUrl;
    }
  }
  if (settings.discordWebhookNames && typeof settings.discordWebhookNames === "object") {
    next.discordWebhookNames = settings.discordWebhookNames;
  }
  if (Array.isArray(settings.discordWebhookVerbose)) {
    next.discordWebhookVerbose = settings.discordWebhookVerbose.map((id) => String(id));
  }
  if (next.discordMainWebhookUrl && !(next.discordWebhookUrls || []).includes(next.discordMainWebhookUrl)) {
    if (Array.isArray(settings.discordWebhookUrls)) {
      delete next.discordMainWebhookUrl;
    } else {
      next.discordWebhookUrls = uniqueValues([next.discordMainWebhookUrl, ...(next.discordWebhookUrls || [])]);
    }
  }
  return next;
}

async function getRuntimeConfig(env) {
  const cfg = getConfig(env);
  return applyPlanPreset(applyRuntimeSettings(cfg, await loadSettings(env, cfg)));
}

function parseFormInt(formData, key) {
  const [min, max] = INT_SETTING_LIMITS[key];
  const value = Number.parseInt(String(formData.get(key) || ""), 10);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new MonitorError(`${key} must be between ${min} and ${max}.`, 400);
  }
  return value;
}

function parseCategoryIds(value) {
  return uniqueValues(
    String(value || "")
      .split(/[\s,]+/)
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean)
      .filter((item) => /^[a-z0-9_-]+$/.test(item) && !RESERVED_CATEGORY_IDS.has(item))
  ).slice(0, INT_SETTING_LIMITS.maxCategoryIds[1]);
}

function parseProductUrls(value) {
  return uniqueValues(
    String(value || "")
      .split(/[\s,]+/)
      .map((item) => productUrlFromUrl(item))
      .filter(Boolean)
  ).slice(0, INT_SETTING_LIMITS.maxDirectProductUrls[1]);
}

function maskWebhook(webhookUrl) {
  try {
    const url = new URL(webhookUrl);
    const parts = url.pathname.split("/").filter(Boolean); // api webhooks <id> <token>
    const id = parts[2] || "";
    return `${url.host}/…/${id}/****`;
  } catch {
    return "invalid-url";
  }
}

function parseWebhookUrls(value) {
  return uniqueValues(
    String(value || "")
      .split(/[\s,]+/)
      .map((item) => item.trim())
      .filter(Boolean)
  );
}

function isValidDiscordWebhookUrl(raw) {
  let url;
  try {
    url = new URL(String(raw || "").trim());
  } catch {
    return false;
  }
  const validHost = url.hostname === "discord.com" || url.hostname.endsWith(".discord.com") || url.hostname === "discordapp.com";
  return url.protocol === "https:" && validHost && url.pathname.startsWith("/api/webhooks/");
}

function validateDiscordWebhookList(value) {
  const urls = parseWebhookUrls(value);
  for (const url of urls) {
    if (!isValidDiscordWebhookUrl(url)) {
      throw new MonitorError(`Not a valid Discord webhook URL: ${truncate(url, 60)}`, 400);
    }
  }
  return uniqueValues(urls.map((url) => new URL(url).toString()));
}

async function saveSettingsFromRequest(request, env, cfg) {
  const current = await loadSettings(env, cfg);
  const formData = await request.formData();
  const next = {
    ...current,
    categoryFetchConcurrency: parseFormInt(formData, "categoryFetchConcurrency"),
    checkMinIntervalSeconds: parseFormInt(formData, "checkMinIntervalSeconds"),
    maxAlertsPerRun: parseFormInt(formData, "maxAlertsPerRun"),
    maxCategoryIds: parseFormInt(formData, "maxCategoryIds"),
    maxCategoryPages: parseFormInt(formData, "maxCategoryPages"),
    maxDirectProductUrls: parseFormInt(formData, "maxDirectProductUrls"),
    maxStorefrontSubrequests: parseFormInt(formData, "maxStorefrontSubrequests"),
    maxPages: parseFormInt(formData, "maxPages"),
    prospectiveCategoryShardSize: parseFormInt(formData, "prospectiveCategoryShardSize"),
    relistAfterAbsentRuns: parseFormInt(formData, "relistAfterAbsentRuns"),
    extraCategoryIds: parseCategoryIds(formData.get("extraCategoryIds")),
    extraProductUrls: parseProductUrls(formData.get("extraProductUrls")),
    updatedAt: nowIso()
  };

  for (const key of BOOL_SETTING_KEYS) {
    next[key] = formData.get(key) === "on";
  }

  applyWebhookForm(next, current, formData, cfg.discordWebhookUrls || []);

  await env.STATE.put(cfg.settingsKey, JSON.stringify(next));
  return next;
}

function webhookIdFromUrl(url) {
  const match = String(url || "").match(/\/api\/webhooks\/(\d+)\//);
  return match ? match[1] : "";
}

function applyWebhookForm(next, current, formData, effectiveUrls = []) {
  delete next.discordWebhookUrl; // migrate off the legacy single-URL key
  const saved = Array.isArray(current.discordWebhookUrls) ? current.discordWebhookUrls.filter(Boolean) : [];
  const existing = saved.length ? saved : (effectiveUrls || []).filter((url) => url && isValidDiscordWebhookUrl(url));
  const names = { ...(current.discordWebhookNames && typeof current.discordWebhookNames === "object" ? current.discordWebhookNames : {}) };

  // Remove: one chip's X, plus any ticked checkboxes.
  const removeIds = new Set(
    [formData.get("remove"), ...formData.getAll("selected")]
      .flatMap((value) => String(value || "").split(","))
      .map((value) => value.trim())
      .filter(Boolean)
  );
  let list = removeIds.size ? existing.filter((url) => !removeIds.has(webhookIdFromUrl(url))) : existing;
  for (const id of removeIds) delete names[id];

  const submitted = validateDiscordWebhookList(formData.get("discordWebhookUrls") || formData.get("discordWebhookUrl"));
  if (submitted.length) {
    list = uniqueValues([...list, ...submitted]);
    const label = String(formData.get("webhookName") || "").trim().slice(0, 40);
    if (label && submitted.length === 1) names[webhookIdFromUrl(submitted[0])] = label;
  }

  // Rename an existing chip in place.
  const renameId = String(formData.get("renameId") || "").trim();
  if (renameId) {
    const label = String(formData.get("renameTo") || "").trim().slice(0, 40);
    if (label) names[renameId] = label;
    else delete names[renameId];
  }

  if (formData.get("clearDiscordWebhook") === "on") {
    delete next.discordWebhookUrls;
    delete next.discordWebhookNames;
    return next;
  }

  if (list.length) next.discordWebhookUrls = list;
  else delete next.discordWebhookUrls;
  // Drop labels for webhooks that are no longer configured.
  const liveIds = new Set(list.map(webhookIdFromUrl));
  for (const id of Object.keys(names)) if (!liveIds.has(id)) delete names[id];
  if (Object.keys(names).length) next.discordWebhookNames = names;
  else delete next.discordWebhookNames;

  const mainId = String(formData.get("mainWebhook") || "").trim();
  if (mainId) {
    const mainUrl = list.find((url) => webhookIdFromUrl(url) === mainId);
    if (mainUrl) next.discordMainWebhookUrl = mainUrl;
  }
  if (next.discordMainWebhookUrl && !list.includes(next.discordMainWebhookUrl)) delete next.discordMainWebhookUrl;

  if (formData.get("webhookPrefs") === "1") {
    const verbose = formData.getAll("verbose").map((value) => String(value || "").trim()).filter((id) => liveIds.has(id));
    if (verbose.length) next.discordWebhookVerbose = uniqueValues(verbose);
    else delete next.discordWebhookVerbose;
  } else if (Array.isArray(next.discordWebhookVerbose)) {
    next.discordWebhookVerbose = next.discordWebhookVerbose.filter((id) => liveIds.has(id));
    if (!next.discordWebhookVerbose.length) delete next.discordWebhookVerbose;
  }
  return next;
}

async function saveWebhooksFromRequest(request, env, cfg) {
  const current = await loadSettings(env, cfg);
  const formData = await request.formData();
  const next = applyWebhookForm({ ...current, updatedAt: nowIso() }, current, formData, cfg.discordWebhookUrls || []);
  await env.STATE.put(cfg.settingsKey, JSON.stringify(next));
  return next;
}

function redirectResponse(location) {
  return new Response(null, {
    status: 303,
    headers: {
      location,
      "cache-control": "no-store"
    }
  });
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

function finiteInteger(value, fallback = 0) {
  const number = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(number) ? number : fallback;
}

function rotatingSlice(values, cursor, limit) {
  if (!values.length || limit <= 0) return [];
  const start = Math.max(0, finiteInteger(cursor, 0)) % values.length;
  const selected = [];
  for (let offset = 0; offset < values.length && selected.length < limit; offset += 1) {
    selected.push(values[(start + offset) % values.length]);
  }
  return selected;
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
      "accept-language": "en-US,en;q=0.9",
      referer: `${BASE_URL}/`,
      "user-agent": cfg.userAgent
    },
    cache: "no-store"
  };
}

let bustSequence = 0;
function bustedUrl(url, cfg, kind = "hot") {
  const value = String(url || "");
  if (!value.startsWith(BASE_URL)) return value;
  bustSequence = (bustSequence + 1) % 1296;
  const salt =
    kind === "tail" && !cfg?.bursting
      ? Math.floor(Date.now() / 60000).toString(36)
      : Date.now().toString(36) + bustSequence.toString(36).padStart(2, "0");
  return `${value}${value.includes("?") ? "&" : "?"}chb=${salt}`;
}

function spendSubrequest(cfg) {
  if (cfg && typeof cfg === "object") cfg.subrequestsUsed = (cfg.subrequestsUsed || 0) + 1;
}

function subrequestsLeft(cfg) {
  if (!cfg || !Number.isFinite(cfg.subrequestHardCap)) return Infinity;
  return cfg.subrequestHardCap - (cfg.subrequestsUsed || 0);
}

async function fetchWithTimeout(url, options, timeoutMs, cfg = null) {
  spendSubrequest(cfg);
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

function productSearchUrl(query, pageSize) {
  const url = new URL(PRODUCT_GRID_BASE_URL);
  url.searchParams.set("q", query);
  url.searchParams.set("start", "0");
  url.searchParams.set("sz", String(pageSize));
  return url.toString();
}

async function fetchSearchHtmlSafe(query, cfg, bustKind = "hot") {
  try {
    if (subrequestsLeft(cfg) <= 4) return "";
    return await fetchHtml(productSearchUrl(query, cfg.pageSize), cfg, bustKind);
  } catch {
    return "";
  }
}

function categoryFromUrl(url) {
  try {
    const path = new URL(url).pathname.replace(/^\/+|\/+$/g, "");
    return path ? path.split("/")[0].replaceAll("-", " ").toUpperCase() : "";
  } catch {
    return "";
  }
}

async function fetchHtml(url, cfg, bustKind = "hot") {
  const response = await fetchWithTimeout(
    bustedUrl(url, cfg, bustKind),
    fetchOptions(cfg, "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"),
    cfg.requestTimeoutMs,
    cfg
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

function isPidLikeSegment(segment) {
  return /^\d{4,}[a-z0-9_]*(?:-\d+)?$/i.test(String(segment || "").replace(/\.html$/i, ""));
}

function productUrlFromUrl(value) {
  try {
    const url = new URL(value, BASE_URL);
    if (url.origin !== BASE_URL) return "";
    const pathSegments = url.pathname.split("/").filter(Boolean);
    if (!url.pathname.endsWith(".html")) return "";
    if (RESERVED_CATEGORY_IDS.has(pathSegments[0])) return "";
    if (pathSegments.length < 3 && !isPidLikeSegment(pathSegments[pathSegments.length - 1])) return "";
    return url.toString();
  } catch {
    return "";
  }
}

async function fetchSitemapSignals(cfg) {
  const empty = { categoryIds: [], productUrls: [] };
  if (!cfg.discoverSitemapCategories) return empty;
  try {
    const indexResponse = await fetchWithTimeout(
      bustedUrl(cfg.sitemapIndexUrl, cfg, "hot"),
      fetchOptions(cfg, "application/xml,text/xml,*/*;q=0.8"),
      cfg.requestTimeoutMs,
      cfg
    );
    if (!indexResponse.ok) return empty;

    const sitemapUrls = extractXmlLocations(await indexResponse.text()).filter((url) => url.endsWith(".xml"));
    const categoryIds = [];
    const productUrls = [];
    for (const sitemapUrl of sitemapUrls.slice(0, 5)) {
      const response = await fetchWithTimeout(bustedUrl(sitemapUrl, cfg, "hot"), fetchOptions(cfg, "application/xml,text/xml,*/*;q=0.8"), cfg.requestTimeoutMs, cfg);
      if (!response.ok) continue;
      for (const loc of extractXmlLocations(await response.text())) {
        const categoryId = categoryIdFromUrl(loc);
        if (categoryId) categoryIds.push(categoryId);
        const productUrl = productUrlFromUrl(loc);
        if (productUrl) productUrls.push(productUrl);
      }
    }
    return { categoryIds, productUrls };
  } catch {
    return empty;
  }
}

async function fetchHomepageSignals(cfg) {
  const empty = { categoryIds: [], productUrls: [], html: "" };
  if (!cfg.discoverHomepageCategories) return empty;
  try {
    const html = await fetchHtml(BASE_URL, cfg);
    const hrefs = [...html.matchAll(/\bhref=["']([^"']+)["']/gi)].map((match) => absoluteUrl(match[1]));
    return {
      categoryIds: hrefs.map(categoryIdFromUrl).filter(Boolean),
      productUrls: hrefs.map(productUrlFromUrl).filter(Boolean),
      html
    };
  } catch {
    return empty;
  }
}

async function fetchRobotsProductUrls(cfg) {
  if (!cfg.discoverRobotsProducts) return [];
  try {
    const response = await fetchWithTimeout(ROBOTS_URL, fetchOptions(cfg, "text/plain,*/*;q=0.8"), cfg.requestTimeoutMs, cfg);
    if (!response.ok) return [];
    return [...(await response.text()).matchAll(/(?:Allow|Disallow):\s*(\S+)/gi)]
      .map((match) => productUrlFromUrl(match[1]))
      .filter(Boolean);
  } catch {
    return [];
  }
}

const PID_PARTS_PATTERN = /^(\d{6})([A-Z0-9]{3})([A-Z0-9]{3})([A-Z0-9]{3})$/;

function parsePidParts(pid) {
  const match = String(pid || "").toUpperCase().match(PID_PARTS_PATTERN);
  return match ? { style: match[1], color: match[2], size: match[3], suffix: match[4] } : null;
}

const DEFAULT_COLOR_CODES = ["ABD", "BLK", "WHT", "XXX"];

function minePidCandidates(text) {
  const found = new Set();
  for (const match of String(text || "").matchAll(/[0-9A-Z]{15,24}/g)) {
    const token = match[0];
    for (const candidate of new Set([token, token.slice(-15)])) {
      if (candidate.length === 15 && PID_PARTS_PATTERN.test(candidate) && /[A-Z]/.test(candidate.slice(6))) {
        found.add(candidate);
      }
    }
  }
  return [...found];
}

function styleKeyOf(parts) {
  return `${parts.style}|${parts.size}|${parts.suffix}`;
}

function updateStyleRegistry(products, previousRegistry, now = nowIso()) {
  const registry = { ...(previousRegistry && typeof previousRegistry === "object" ? previousRegistry : {}) };
  for (const [pid, product] of Object.entries(products || {})) {
    const parts = parsePidParts(pid);
    if (!parts) continue;
    const key = styleKeyOf(parts);
    const entry = registry[key] || { style: parts.style, size: parts.size, suffix: parts.suffix, colors: [], name: "", lastSeenAt: now };
    if (!entry.colors.includes(parts.color)) entry.colors = [...entry.colors, parts.color];
    entry.name = product?.name || entry.name;
    entry.lastSeenAt = now;
    registry[key] = entry;
  }
  return registry;
}

function boundStyleRegistry(registry, limit = 400) {
  const entries = Object.entries(registry);
  if (entries.length <= limit) return registry;
  return Object.fromEntries(entries.sort((a, b) => String(b[1].lastSeenAt).localeCompare(String(a[1].lastSeenAt))).slice(0, limit));
}

function enumerationCandidates(cfg, state) {
  if (!cfg.enumerationEnabled) return { mined: [], siblings: [], registrySiblings: [] };
  const seen = state.seen || {};
  const hotWatch = state.hotWatch || {};
  const registry = state.styleRegistry && typeof state.styleRegistry === "object" ? state.styleRegistry : {};
  const mined = minePidCandidates(
    Object.values(seen)
      .map((record) => `${record?.image || ""} ${record?.url || ""}`)
      .join("\n")
  );

  const colorVocab = uniqueValues([
    ...DEFAULT_COLOR_CODES,
    ...[...Object.keys(seen), ...Object.keys(hotWatch)].map((pid) => parsePidParts(pid)?.color).filter(Boolean),
    ...Object.values(registry).flatMap((entry) => entry?.colors || [])
  ]);
  const excluded = (pid) => seen[pid] || hotWatch[pid];
  const siblingsFrom = (parts, knownColors) => {
    const out = [];
    for (const color of colorVocab) {
      if (color === parts.color || (knownColors && knownColors.includes(color))) continue;
      out.push(`${parts.style}${color}${parts.size}${parts.suffix}`);
    }
    return out;
  };

  const recentMs = cfg.enumerationRecentDays * 86400000;
  const hotSeeds = uniqueValues([
    ...Object.keys(hotWatch).filter((pid) => !hotWatch[pid]?.dormant),
    ...Object.values(seen)
      .filter((record) => recentMs > 0 && Date.parse(record?.firstSeenAt || "") > Date.now() - recentMs)
      .map((record) => record?.pid)
  ]);
  const siblings = [];
  for (const seedPid of hotSeeds) {
    const parts = parsePidParts(seedPid);
    if (parts) siblings.push(...siblingsFrom(parts));
  }

  const registrySiblings = [];
  for (const entry of Object.values(registry).sort((a, b) => String(b.lastSeenAt).localeCompare(String(a.lastSeenAt)))) {
    registrySiblings.push(...siblingsFrom({ style: entry.style, color: null, size: entry.size, suffix: entry.suffix }, entry.colors));
  }

  const frontier = [];
  for (const seedPid of hotSeeds.slice(0, 12)) {
    const parts = parsePidParts(seedPid);
    if (!parts || !/^\d{6}$/.test(parts.style)) continue;
    const styleNumber = Number.parseInt(parts.style, 10);
    for (const delta of [1, -1, 2, -2]) {
      const neighbour = styleNumber + delta;
      if (neighbour < 0 || neighbour > 999999) continue;
      frontier.push(`${String(neighbour).padStart(6, "0")}${parts.color}${parts.size}${parts.suffix}`);
    }
  }

  const siblingsOut = uniqueValues(siblings).filter((pid) => !excluded(pid));
  const siblingSet = new Set(siblingsOut);
  const frontierOut = uniqueValues(frontier).filter((pid) => !excluded(pid) && !siblingSet.has(pid));
  return {
    mined: uniqueValues(mined).filter((pid) => !excluded(pid)),
    siblings: siblingsOut,
    frontier: frontierOut,
    registrySiblings: uniqueValues(registrySiblings).filter(
      (pid) => !excluded(pid) && !siblingSet.has(pid) && !frontierOut.includes(pid)
    )
  };
}

function pidFromProductUrl(value) {
  try {
    const url = new URL(value, BASE_URL);
    const segment = url.pathname.split("/").filter(Boolean).pop() || "";
    const pid = segment.replace(/\.html$/i, "");
    return isPidLikeSegment(pid) ? pid : "";
  } catch {
    return "";
  }
}

function stagedNameFromUrl(value) {
  try {
    const segments = new URL(value, BASE_URL).pathname.split("/").filter(Boolean);
    const slug = segments.length >= 2 ? segments[segments.length - 2] : "";
    if (!slug || slug.includes(".")) return "";
    return slug.replaceAll("-", " ").toUpperCase();
  } catch {
    return "";
  }
}

async function fetchSitemapDelta(cfg, previousLastmod = "") {
  const unchanged = { lastmod: previousLastmod, changed: false, categoryIds: [], productUrls: [] };
  if (!cfg.discoverSitemapCategories) return unchanged;
  try {
    const indexResponse = await fetchWithTimeout(
      bustedUrl(cfg.sitemapIndexUrl, cfg, "hot"),
      fetchOptions(cfg, "application/xml,text/xml,*/*;q=0.8"),
      cfg.requestTimeoutMs,
      cfg
    );
    if (!indexResponse.ok) return unchanged;
    const indexXml = await indexResponse.text();
    const lastmod =
      [...indexXml.matchAll(/<lastmod>\s*([^<]+?)\s*<\/lastmod>/gi)].map((match) => match[1].trim()).sort().pop() || "";
    if (lastmod && lastmod === previousLastmod) return { lastmod, changed: false, categoryIds: [], productUrls: [] };

    const categoryIds = [];
    const productUrls = [];
    let fetchedAny = false;
    for (const sitemapUrl of extractXmlLocations(indexXml)
      .filter((url) => url.endsWith(".xml"))
      .slice(0, 3)) {
      const response = await fetchWithTimeout(bustedUrl(sitemapUrl, cfg, "hot"), fetchOptions(cfg, "application/xml,text/xml,*/*;q=0.8"), cfg.requestTimeoutMs, cfg);
      if (!response.ok) continue;
      fetchedAny = true;
      for (const loc of extractXmlLocations(await response.text())) {
        const categoryId = categoryIdFromUrl(loc);
        if (categoryId) categoryIds.push(categoryId);
        const productUrl = productUrlFromUrl(loc);
        if (productUrl) productUrls.push(productUrl);
      }
    }
    if (!fetchedAny) return unchanged;
    return { lastmod, changed: true, categoryIds: uniqueValues(categoryIds).sort(), productUrls };
  } catch {
    return unchanged;
  }
}

function parseHotWatchProbe(body, pid) {
  const product = body?.product || {};
  const variation = parseProductVariationJson(body);
  const priceValue = product?.price?.sales?.value ?? product?.price?.list?.value ?? null;
  const purchasable = Boolean(priceValue !== null && variation.inStockSizeCount > 0 && product.online !== false);
  const imageGroups = product?.images || {};
  const imageUrl =
    ["large", "hiRes", "hi-res", "medium", "small"]
      .map((key) => imageGroups?.[key]?.[0]?.url || imageGroups?.[key]?.[0]?.absURL)
      .find(Boolean) || "";
  let canonicalUrl = "";
  try {
    const rawUrl = String(product.selectedProductUrl || "");
    if (rawUrl) canonicalUrl = absoluteUrl(new URL(rawUrl, BASE_URL).pathname);
  } catch {
    canonicalUrl = "";
  }
  return {
    ok: true,
    pid,
    masterPid: variation.masterPid || pid,
    name: String(product.productName || "").trim(),
    price: priceValue === null ? "" : String(priceValue),
    image: imageUrl ? absoluteUrl(imageUrl) : "",
    url: canonicalUrl,
    online: product.online === undefined ? null : Boolean(product.online),
    category: String(product?.primaryCategory || "").trim(),
    purchasable,
    sizes: variation.sizes,
    inStockSizeCount: variation.inStockSizeCount,
    availabilityMessages: variation.availabilityMessages,
    // The style's full colour set, for the master roll-call.
    colors: variation.colors,
    colorAttributeId: variation.colorAttributeId
  };
}

async function probeHotWatchPids(cfg, pids) {
  const probes = {};
  const cleanPids = (Array.isArray(pids) ? pids : []).map((value) => String(value || "").trim()).filter(isPidLikeSegment);
  await mapWithConcurrency(cleanPids, 4, async (pid) => {
    if (subrequestsLeft(cfg) <= 4) return;
    try {
      const response = await fetchWithTimeout(
        bustedUrl(productVariationUrl(pid, 1), cfg, "hot"),
        {
          headers: {
            accept: "application/json, text/javascript, */*; q=0.01",
            "user-agent": cfg.userAgent,
            "x-requested-with": "XMLHttpRequest"
          },
          cache: "no-store"
        },
        cfg.requestTimeoutMs,
        cfg
      );
      if (!response.ok) {
        try {
          response.body?.cancel?.();
        } catch {
          // ignore
        }
        probes[pid] = { ok: false, status: response.status };
        return;
      }
      probes[pid] = parseHotWatchProbe(await response.json(), pid);
    } catch (error) {
      probes[pid] = { ok: false, error: error.message };
    }
  });
  return probes;
}

async function stagingScan(cfg, opts = {}) {
  const knownPids = new Set(Array.isArray(opts.knownPids) ? opts.knownPids : []);
  const plannedPids = (Array.isArray(opts.probePids) ? opts.probePids : []).filter(isPidLikeSegment);

  const [robotsUrls, homepage, sitemap] = await Promise.all([
    fetchRobotsProductUrls(cfg),
    fetchHomepageSignals(cfg),
    fetchSitemapDelta(cfg, String(opts.sitemapLastmod || ""))
  ]);

  const stagedUrls = [];
  const stagedPids = new Set();
  for (const { url, source } of [
    ...robotsUrls.map((url) => ({ url, source: "robots.txt" })),
    ...(sitemap.productUrls || []).map((url) => ({ url, source: "sitemap" })),
    ...(homepage.productUrls || []).map((url) => ({ url, source: "homepage" }))
  ]) {
    const pid = pidFromProductUrl(url);
    if (!pid || stagedPids.has(pid)) continue;
    stagedPids.add(pid);
    stagedUrls.push({ url, source });
  }

  const minedPids = cfg.enumerationEnabled
    ? minePidCandidates(homepage.html || "").filter((pid) => !knownPids.has(pid) && !stagedPids.has(pid))
    : [];
  const freshPids = [...stagedPids].filter((pid) => !knownPids.has(pid));

  const budget = Math.max(0, Number.isFinite(opts.probeBudget) ? opts.probeBudget : cfg.probeBudgetPerTick ?? 26);
  const probeList = uniqueValues([...freshPids.slice(0, 6), ...plannedPids, ...minedPids.slice(0, 6)]).slice(0, budget + 12);
  const probes = await probeHotWatchPids(cfg, probeList);

  const staticVersion = (homepage.html || "").match(/\/v(1\d{12})\//)?.[1] || null;

  return {
    stagedUrls,
    minedPids: minedPids.slice(0, 12),
    sitemap: { lastmod: sitemap.lastmod, changed: sitemap.changed, categoryIds: sitemap.categoryIds },
    probes,
    staticVersion
  };
}

async function collectStagingSignals(env, cfg, opts) {
  if (cfg.fanoutEnabled && env?.SELF && typeof env.SELF.fetch === "function") {
    try {
      spendSubrequest(cfg);
      const response = await env.SELF.fetch("https://monitor.internal/internal/scan-grids", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${cfg.cronSecret}` },
        body: JSON.stringify({ staging: opts })
      });
      if (response.ok) {
        const body = await response.json();
        if (body?.ok && body.staging) return body.staging;
      }
    } catch {
      // fall through to the local path
    }
  }
  if (subrequestsLeft(cfg) <= 12) return null;
  try {
    return await stagingScan(cfg, opts);
  } catch {
    return null;
  }
}

const HOT_WATCH_EXPIRY_MS = 21 * 24 * 3600 * 1000;

function activeHotWatchCount(map) {
  return Object.values(map).filter((entry) => entry && !entry.dormant).length;
}

const HOT_WATCH_PRIORITY = { "robots.new": 4, "robots.txt": 3, sitemap: 3, homepage: 2, mined: 1, enumeration: 0 };
function hotWatchPriority(entry) {
  if (entry?.dormant) return -1;
  return HOT_WATCH_PRIORITY[entry?.source] ?? 0;
}

function evictForPriority(map, incomingPriority) {
  let victimPid = null;
  let victim = null;
  for (const [pid, entry] of Object.entries(map)) {
    const priority = hotWatchPriority(entry);
    if (priority >= incomingPriority) continue;
    if (
      !victim ||
      priority < hotWatchPriority(victim) ||
      String(entry?.firstStagedAt || "") < String(victim?.firstStagedAt || "")
    ) {
      victimPid = pid;
      victim = entry;
    }
  }
  if (victimPid) {
    delete map[victimPid];
    return true;
  }
  return false;
}

function hotWatchProduct(entry, probe, productType = "hotwatch") {
  const url = probe.url || entry.url || "";
  return {
    pid: entry.pid,
    name: probe.name || entry.name || entry.pid,
    price: probe.price || "",
    brand: "Chrome Hearts",
    category: probe.category || categoryFromUrl(url) || "staged",
    productType,
    url,
    image: probe.image || "",
    sizes: probe.sizes || [],
    inStockSizeCount: probe.inStockSizeCount ?? 0
  };
}

async function runStagingLane(env, cfg, state) {
  const startedAt = Date.now();
  const seen = state.seen || {};
  const previousHotWatch =
    state.hotWatch && typeof state.hotWatch === "object" && !Array.isArray(state.hotWatch) ? state.hotWatch : {};
  const activePids = Object.keys(previousHotWatch)
    .filter((pid) => !previousHotWatch[pid]?.dormant)
    .slice(0, cfg.hotWatchLimit);

  const restockCooldownMs = Math.max(0, cfg.restockCooldownHours ?? 12) * 3600000;
  const restockPids = Object.entries(state.missing || {})
    .filter(([, entry]) => Number(entry?.count || 0) >= cfg.relistAfterAbsentRuns)
    .map(([pid]) => pid)
    .filter((pid) => {
      if (!seen[pid]) return false;
      const lastAlertedMs = Date.parse(seen[pid]?.lastAlertedAt || "");
      return !(restockCooldownMs > 0 && Number.isFinite(lastAlertedMs) && Date.now() - lastAlertedMs < restockCooldownMs);
    })
    .slice(0, 6);
  const bursting = Boolean(state.burstUntil && Date.parse(state.burstUntil) > Date.now());
  const probeBudget = bursting ? Math.max(cfg.probeBudgetPerTick ?? 26, cfg.burstProbeBudget ?? 80) : cfg.probeBudgetPerTick ?? 26;

  const candidates = enumerationCandidates(cfg, state);
  const minedSet = new Set(candidates.mined);
  const minedQueue = candidates.mined;
  const siblingQueue = candidates.siblings;
  const registryQueue = candidates.registrySiblings;
  const enumRoom = Math.max(0, probeBudget - activePids.length - restockPids.length - 6);
  const minedSlice = minedQueue.slice(0, Math.min(enumRoom, 8));
  const rotorMs = Math.max(1000, (bursting ? cfg.burstIntervalSeconds : cfg.fastPollIntervalSeconds) * 1000);
  const rotor = Math.floor(startedAt / rotorMs);
  const siblingRoom = Math.min(Math.max(0, enumRoom - minedSlice.length), bursting ? 40 : 12);
  const siblingSlice = rotatingSlice(siblingQueue, rotor * Math.max(1, siblingRoom), siblingRoom);
  const frontierQueue = candidates.frontier || [];
  const frontierRoom = Math.min(bursting ? 10 : 4, Math.max(0, enumRoom - minedSlice.length - siblingSlice.length));
  const frontierSlice = rotatingSlice(frontierQueue, rotor * Math.max(1, frontierRoom), frontierRoom);
  const registryRoom = Math.max(0, enumRoom - minedSlice.length - siblingSlice.length - frontierSlice.length);
  const registrySlice = rotatingSlice(registryQueue, rotor * Math.max(1, registryRoom), registryRoom);
  const enumSlice = [...minedSlice, ...siblingSlice, ...frontierSlice, ...registrySlice];
  const enumPoolSize = minedQueue.length + siblingQueue.length + frontierQueue.length + registryQueue.length;

  const signals = await collectStagingSignals(env, cfg, {
    probePids: uniqueValues([...activePids, ...restockPids, ...enumSlice]),
    knownPids: [...Object.keys(seen), ...Object.keys(previousHotWatch)],
    sitemapLastmod: state.sitemapIndexLastmod || "",
    probeBudget,
    bursting
  });
  if (!signals) return null;
  for (const pid of signals.minedPids || []) minedSet.add(pid);

  const baselined = Boolean(state.stagingBaselinedAt);
  const now = nowIso();
  const hotWatch = {};
  let dirty = !baselined;

  for (const [pid, entry] of Object.entries(previousHotWatch)) {
    const stagedAtMs = Date.parse(entry?.firstStagedAt || "");
    if (Number.isFinite(stagedAtMs) && Date.now() - stagedAtMs > HOT_WATCH_EXPIRY_MS) {
      dirty = true;
      continue;
    }
    hotWatch[pid] = entry;
  }

  const discoveries = [];
  for (const staged of signals.stagedUrls || []) {
    const pid = pidFromProductUrl(staged.url);
    if (!pid || seen[pid] || hotWatch[pid]) continue;
    if (activeHotWatchCount(hotWatch) >= cfg.hotWatchLimit && !evictForPriority(hotWatch, hotWatchPriority({ source: staged.source }))) break;
    hotWatch[pid] = { pid, url: staged.url, source: staged.source, name: stagedNameFromUrl(staged.url), firstStagedAt: now };
    discoveries.push(hotWatch[pid]);
    dirty = true;
  }

  const liveProducts = {};
  let probedCount = 0;
  for (const [pid, probe] of Object.entries(signals.probes || {})) {
    probedCount += 1;
    if (!probe) continue;
    const entry = hotWatch[pid];

    if (probe.ok === false) continue;

    if (probe.masterPid && probe.masterPid !== pid && (seen[probe.masterPid] || hotWatch[probe.masterPid])) {
      if (entry && !entry.dormant) {
        hotWatch[pid] = { ...entry, dormant: true, masterPid: probe.masterPid };
        dirty = true;
      }
      continue;
    }

    if (seen[pid]) {
      if (probe.purchasable && relistEligible(pid, seen, state.active || seen, state.missing || {}, cfg)) {
        const record = seen[pid] || {};
        liveProducts[pid] = {
          ...hotWatchProduct({ pid, url: record.url || "", name: record.name || "" }, probe, "restock"),
          image: probe.image || record.image || "",
          price: probe.price || record.price || ""
        };
      }
      continue;
    }

    if (!entry) {
      if (!probe.name) continue;
      if (activeHotWatchCount(hotWatch) >= cfg.hotWatchLimit) continue;
      const created = {
        pid,
        url: probe.url || "",
        source: minedSet.has(pid) ? "mined" : "enumeration",
        name: probe.name,
        firstStagedAt: now
      };
      hotWatch[pid] = created;
      discoveries.push(created);
      dirty = true;
      if (probe.purchasable) liveProducts[pid] = hotWatchProduct(created, probe);
      continue;
    }

    if (!probe.purchasable) continue;
    liveProducts[pid] = hotWatchProduct(entry, probe);
  }

  const previousCategories = Array.isArray(state.sitemapCategoryIds) ? state.sitemapCategoryIds : null;
  let sitemapCategoryIds = null;
  const addedCategories = [];
  let sitemapLastmod;
  if (signals.sitemap?.changed && Array.isArray(signals.sitemap.categoryIds)) {
    sitemapCategoryIds = uniqueValues(signals.sitemap.categoryIds).sort();
    sitemapLastmod = signals.sitemap.lastmod || "";
    if (previousCategories) {
      for (const cgid of sitemapCategoryIds) {
        if (!previousCategories.includes(cgid)) addedCategories.push(cgid);
      }
    }
    const lastmodChanged = sitemapLastmod !== (state.sitemapIndexLastmod || "");
    const categoriesChanged = !previousCategories || previousCategories.join(",") !== sitemapCategoryIds.join(",");
    if (lastmodChanged || categoriesChanged) dirty = true;
  }

  if (baselined && cfg.stagedIntelPings) {
    const lines = [
      ...discoveries.map(
        (entry) =>
          `👀 **STAGED ITEM** ${entry.name || entry.pid} — <${entry.url || `${BASE_URL}/search?q=${entry.pid}`}> — found via ${entry.source}, not yet purchasable. Hot-watching every tick.`
      ),
      ...addedCategories.map((cgid) => `📁 **SITEMAP** category \`/${cgid}\` just appeared — possible drop prep.`)
    ];
    if (lines.length) await sendStagingPings(cfg, lines);
  }

  const previousStyleColors =
    state.styleColors && typeof state.styleColors === "object" && !Array.isArray(state.styleColors)
      ? state.styleColors
      : {};
  const styleColors = { ...previousStyleColors };
  const newColorways = [];
  for (const [pid, probe] of Object.entries(signals.probes || {})) {
    const colors = probe?.colors;
    if (!Array.isArray(colors) || !colors.length) continue;
    const master = probe.masterPid || pid;
    const known = new Set(previousStyleColors[master]?.codes || []);
    const codes = colors.map((color) => color.code);
    if (known.size) {
      for (const color of colors) {
        if (!known.has(color.code)) {
          newColorways.push({
            master,
            code: color.code,
            label: color.label,
            selectable: color.selectable,
            name: probe.name || null
          });
        }
      }
    }
    styleColors[master] = { codes: uniqueValues([...known, ...codes]), at: nowIso() };
  }
  const styleColorsDirty = newColorways.length > 0 || Object.keys(styleColors).length !== Object.keys(previousStyleColors).length;

  const staticVersion = signals.staticVersion || null;
  const versionBumped = Boolean(staticVersion && state.staticVersion && staticVersion !== state.staticVersion);
  if (staticVersion && staticVersion !== (state.staticVersion || null)) dirty = true;

  const dropSignal = discoveries.length > 0 || addedCategories.length > 0 || newColorways.length > 0 || versionBumped;

  return {
    staticVersion,
    versionBumped,
    hotWatch,
    liveProducts,
    discoveries,
    probedCount,
    enumPoolSize,
    bursting,
    dropSignal,
    dirty: dirty || styleColorsDirty,
    baselined,
    styleColors,
    newColorways,
    ms: Date.now() - startedAt,
    sitemapIndexLastmod: sitemapLastmod,
    sitemapCategoryIds
  };
}

function discoveryFetchReserve(cfg) {
  let reserve = 0;
  if (cfg.discoverSitemapCategories) reserve += 6;
  if (cfg.discoverHomepageCategories) reserve += 1;
  if (cfg.discoverRobotsProducts) reserve += 1;
  return reserve;
}

async function productDiscoverySignals(cfg, state = {}) {
  const emptySignals = { categoryIds: [], productUrls: [] };
  const [sitemap, homepage, robotsProductUrls] = cfg.lightDiscoveryRun
    ? [emptySignals, emptySignals, []]
    : await Promise.all([fetchSitemapSignals(cfg), fetchHomepageSignals(cfg), fetchRobotsProductUrls(cfg)]);
  const baseCategoryIds = uniqueValues([
    "root",
    "shop",
    ...(Array.isArray(state.knownCategoryIds) ? state.knownCategoryIds : []),
    ...sitemap.categoryIds,
    ...homepage.categoryIds,
    ...cfg.extraCategoryIds
  ]);
  const reserve = (cfg.lightDiscoveryRun ? 0 : discoveryFetchReserve(cfg)) + (cfg.searchQueries?.length || 0);
  const maxCategoryFetches = Math.max(2, cfg.maxStorefrontSubrequests - reserve - cfg.maxDirectProductUrls);
  const categoryLimit = Math.min(cfg.maxCategoryIds, maxCategoryFetches);
  const prospectiveCursor = finiteInteger(state.prospectiveCategoryCursor, 0);
  const prospectiveRoom = Math.max(0, categoryLimit - baseCategoryIds.length);
  const prospectiveLimit = cfg.scanAllCategoriesOnFullSweep
    ? prospectiveRoom
    : Math.max(0, Math.min(cfg.prospectiveCategoryShardSize, prospectiveRoom));
  const prospectiveCategoryIds = rotatingSlice(cfg.prospectiveCategoryIds, prospectiveCursor, prospectiveLimit);
  const categoryIds = uniqueValues([...baseCategoryIds, ...prospectiveCategoryIds]).slice(0, categoryLimit);
  const productUrlLimit = Math.max(0, Math.min(cfg.maxDirectProductUrls, cfg.maxStorefrontSubrequests - reserve - categoryIds.length));
  const productUrls = uniqueValues([...sitemap.productUrls, ...homepage.productUrls, ...robotsProductUrls, ...cfg.extraProductUrls]).slice(
    0,
    productUrlLimit
  );
  const nextProspectiveCategoryCursor = cfg.prospectiveCategoryIds.length
    ? (prospectiveCursor + prospectiveCategoryIds.length) % cfg.prospectiveCategoryIds.length
    : 0;

  return {
    categoryIds,
    productUrls,
    prospectiveCategoryIds,
    prospectiveCategoryCursor: prospectiveCursor,
    nextProspectiveCategoryCursor,
    storefrontSubrequestBudget: cfg.maxStorefrontSubrequests,
    plannedStorefrontSubrequests: reserve + categoryIds.length + productUrls.length
  };
}

async function fetchProductsForCategory(cgid, cfg, maxPages) {
  const allProducts = {};
  for (let page = 0; page < maxPages; page += 1) {
    const start = page * cfg.pageSize;
    const html = await fetchHtml(productGridUrl(cgid, start, cfg.pageSize), cfg);
    const pidCount = extractGridPids(html).size;
    if (pidCount === 0) break;
    const pageProducts = parseProducts(html);
    let newOnPage = 0;

    for (const [pid, product] of Object.entries(pageProducts)) {
      if (!allProducts[pid]) newOnPage += 1;
      allProducts[pid] = product;
    }

    if (pidCount < cfg.pageSize) break;
    if (newOnPage === 0) break;
  }
  return allProducts;
}

async function fetchDirectProduct(productUrl, cfg) {
  try {
    if (subrequestsLeft(cfg) <= 6) return null;
    const html = await fetchHtml(productUrl, cfg);
    const snapshot = parseProductStockPage(html, productUrl);
    const pid = snapshot.masterPid || snapshot.selectedVariantPid || productUrl.match(/\/([^/]+)\.html/)?.[1] || "";
    if (!pid || !snapshot.name) return null;
    return {
      pid,
      name: snapshot.name || pid,
      price: snapshot.price || "",
      brand: snapshot.brand || "Chrome Hearts",
      category: snapshot.category || categoryFromUrl(productUrl),
      productType: "direct",
      url: productUrl,
      image: snapshot.image || ""
    };
  } catch {
    return null;
  }
}

async function fetchProducts(cfg, state = {}) {
  const allProducts = {};
  const discovery = await productDiscoverySignals(cfg, state);
  cfg.discoveryRun = {
    categoryCount: discovery.categoryIds.length,
    directProductUrlCount: discovery.productUrls.length,
    prospectiveCategoryCount: discovery.prospectiveCategoryIds.length,
    prospectiveCategoryCursor: discovery.prospectiveCategoryCursor,
    nextProspectiveCategoryCursor: discovery.nextProspectiveCategoryCursor,
    plannedStorefrontSubrequests: discovery.plannedStorefrontSubrequests,
    storefrontSubrequestBudget: discovery.storefrontSubrequestBudget
  };
  const queuedCategoryIds = [...discovery.categoryIds];
  const visitedCategoryIds = new Set();
  const activeCategoryIds = new Set(); // cgids that returned >=1 product this sweep
  const failedCategoryIds = [];

  while (queuedCategoryIds.length && visitedCategoryIds.size < cfg.maxCategoryIds) {
    const batch = [];
    while (queuedCategoryIds.length && visitedCategoryIds.size + batch.length < cfg.maxCategoryIds) {
      const cgid = queuedCategoryIds.shift();
      if (!cgid || visitedCategoryIds.has(cgid) || batch.includes(cgid)) continue;
      batch.push(cgid);
    }
    if (!batch.length) break;

    for (const cgid of batch) visitedCategoryIds.add(cgid);
    const results = await mapWithConcurrency(batch, cfg.categoryFetchConcurrency, async (cgid) => {
      const maxPages = cgid === "root" || cgid === "shop" ? cfg.maxPages : cfg.maxCategoryPages;
      try {
        return { cgid, products: await fetchProductsForCategory(cgid, cfg, maxPages) };
      } catch (error) {
        return { cgid, products: {}, error: error.message };
      }
    });

    for (const { cgid, products, error } of results) {
      if (error) failedCategoryIds.push(cgid);
      const pids = Object.keys(products);
      if (pids.length) activeCategoryIds.add(cgid);
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
  }

  for (const productUrl of discovery.productUrls) {
    const product = await fetchDirectProduct(productUrl, cfg);
    if (product) allProducts[product.pid] = product;
  }

  let newFromSearch = 0;
  for (const query of cfg.searchQueries || []) {
    const found = parseProducts(await fetchSearchHtmlSafe(query, cfg));
    for (const [pid, product] of Object.entries(found)) {
      if (!allProducts[pid]) {
        newFromSearch += 1;
        const categoryId = categoryIdFromUrl(product.url);
        if (categoryId) activeCategoryIds.add(categoryId);
      }
      allProducts[pid] = product;
    }
  }

  cfg.sweepStats = {
    categoriesScanned: visitedCategoryIds.size,
    activeCategoryIds: [...activeCategoryIds],
    failedCategoryIds,
    failedCategoryCount: failedCategoryIds.length,
    searchQueryCount: (cfg.searchQueries || []).length,
    newFromSearch
  };

  const count = Object.keys(allProducts).length;
  if (count < cfg.minProducts) {
    throw new MonitorError(`Fetched only ${count} products; refusing update below MIN_PRODUCTS=${cfg.minProducts}.`);
  }
  return allProducts;
}

function extractGridPids(html) {
  const pids = new Set();
  const pattern = /data-pid\s*=\s*["']([^"']+)["']/g;
  let match;
  while ((match = pattern.exec(html)) !== null) {
    if (match[1]) pids.add(match[1]);
  }
  return pids;
}

function extractShowMoreUrl(html) {
  if (!html) return null;
  const matches = String(html).matchAll(/data-url="([^"]*Search-UpdateGrid[^"]*)"/gi);
  for (const match of matches) {
    const url = match[1].replaceAll("&amp;", "&");
    if (/[?&]start=\d+/.test(url) && /[?&]sz=\d+/.test(url)) return url;
  }
  return null;
}

async function fetchRootCatalog(cfg) {
  const products = {};
  const pids = new Set();
  let url = productGridUrl(cfg.rootCatalogCgid, 0, cfg.rootCatalogPageSize);
  let pages = 0;
  let truncated = false;

  while (url && pages < cfg.rootCatalogMaxPages) {
    if (subrequestsLeft(cfg) <= 6) {
      truncated = true;
      break;
    }
    let html = "";
    try {
      html = await fetchHtml(url, cfg);
    } catch {
      truncated = true;
      break;
    }
    pages += 1;
    for (const pid of extractGridPids(html)) pids.add(pid);
    if (extractGridPids(html).size) Object.assign(products, parseProducts(html));
    const next = extractShowMoreUrl(html);
    if (!next) {
      url = null;
      break;
    }
    url = next;
  }
  // Ran out of page budget with the chain still going.
  if (url && pages >= cfg.rootCatalogMaxPages) truncated = true;

  return { products, pids, pages, truncated, complete: !truncated };
}

async function fetchGridHtmlSafe(cgid, cfg, bustKind = "hot") {
  try {
    return await fetchHtml(productGridUrl(cgid, 0, cfg.pageSize), cfg, bustKind);
  } catch {
    return "";
  }
}

async function selfScanGrids(env, cfg, cgids, queries = []) {
  if (!cfg.fanoutEnabled || !env?.SELF || typeof env.SELF.fetch !== "function" || (!cgids.length && !queries.length)) {
    return null;
  }
  const sliceSize = Math.max(5, cfg.fanoutSliceSize);
  const items = [...cgids.map((value) => ({ kind: "c", value })), ...queries.map((value) => ({ kind: "q", value }))];
  const slices = [];
  for (let index = 0; index < items.length; index += sliceSize) {
    slices.push(items.slice(index, index + sliceSize));
  }

  const results = await mapWithConcurrency(slices, 10, async (slice) => {
    try {
      spendSubrequest(cfg);
      const response = await env.SELF.fetch("https://monitor.internal/internal/scan-grids", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${cfg.cronSecret}` },
        body: JSON.stringify({
          cgids: slice.filter((item) => item.kind === "c").map((item) => item.value),
          queries: slice.filter((item) => item.kind === "q").map((item) => item.value),
          bursting: Boolean(cfg.bursting)
        })
      });
      if (!response.ok) return null;
      const body = await response.json();
      return body && body.ok ? body : null;
    } catch {
      return null;
    }
  });

  const retryIndexes = results.map((result, index) => (result ? -1 : index)).filter((index) => index >= 0);
  if (retryIndexes.length && retryIndexes.length < slices.length) {
    const retried = await mapWithConcurrency(retryIndexes, 10, async (index) => {
      const slice = slices[index];
      try {
        spendSubrequest(cfg);
        const response = await env.SELF.fetch("https://monitor.internal/internal/scan-grids", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${cfg.cronSecret}` },
          body: JSON.stringify({
            cgids: slice.filter((item) => item.kind === "c").map((item) => item.value),
            queries: slice.filter((item) => item.kind === "q").map((item) => item.value),
            bursting: Boolean(cfg.bursting)
          })
        });
        if (!response.ok) return null;
        const body = await response.json();
        return body && body.ok ? body : null;
      } catch {
        return null;
      }
    });
    retryIndexes.forEach((sliceIndex, position) => {
      if (retried[position]) results[sliceIndex] = retried[position];
    });
  }

  const okResults = results.filter(Boolean);
  if (!okResults.length) return null;
  const merged = {
    products: {},
    activeCgids: [],
    failed: [],
    slices: slices.length,
    slicesOk: okResults.length,
    slicesRetried: retryIndexes.length,
    scanned: 0
  };
  for (const result of okResults) {
    Object.assign(merged.products, result.products || {});
    merged.activeCgids.push(...(result.activeCgids || []));
    merged.failed.push(...(result.failed || []));
    merged.scanned += result.scanned || 0;
  }
  results.forEach((result, index) => {
    if (!result) merged.failed.push(...slices[index].map((item) => (item.kind === "q" ? `q:${item.value}` : item.value)));
  });
  merged.unscannedCgids = merged.failed.filter((value) => !String(value).startsWith("q:"));
  return merged;
}

async function fetchCategoryStatuses(env, cfg, cgids) {
  if (!env?.SELF || typeof env.SELF.fetch !== "function" || !cgids.length) return null;
  const sliceSize = Math.max(5, cfg.fanoutSliceSize);
  const slices = [];
  for (let index = 0; index < cgids.length; index += sliceSize) {
    slices.push(cgids.slice(index, index + sliceSize));
  }
  const results = await mapWithConcurrency(slices, 10, async (slice) => {
    try {
      spendSubrequest(cfg);
      const response = await env.SELF.fetch("https://monitor.internal/internal/scan-grids", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${cfg.cronSecret}` },
        body: JSON.stringify({ statusCgids: slice })
      });
      if (!response.ok) return null;
      return await response.json();
    } catch {
      return null;
    }
  });
  const statuses = {};
  let anyOk = false;
  for (const result of results) {
    if (result && result.statuses) {
      anyOk = true;
      Object.assign(statuses, result.statuses);
    }
  }
  return anyOk ? statuses : null;
}

function categoryStatusTransitions(previous = {}, current = {}) {
  const transitions = [];
  for (const [cgid, to] of Object.entries(current)) {
    const from = previous[cgid];
    if (from === undefined || from === to || to === 0 || from === 0) continue;
    transitions.push({ cgid, from, to });
  }
  return transitions;
}

function discoveredCategories(previous = {}, current = {}) {
  return Object.entries(current)
    .filter(([cgid, status]) => previous[cgid] === undefined && status >= 200 && status < 400)
    .map(([cgid, status]) => ({ cgid, status }));
}

function interestingCategoryTransition(transition) {
  const { from, to } = transition;
  if (from === 404 && to >= 200 && to < 400) return true;
  if (to === 200 && from !== 200) return true;
  if (from === 301 && to === 302) return true;
  return false;
}

async function scanGridsSlice(env, cfg, cgids, queries = []) {
  const products = {};
  const activeCgids = [];
  const failed = [];
  const parseIfAny = (html) => (extractGridPids(html).size ? parseProducts(html) : null);
  const htmls = await mapWithConcurrency(cgids, cfg.categoryFetchConcurrency, (cgid) => fetchGridHtmlSafe(cgid, cfg, "tail"));
  htmls.forEach((html, index) => {
    if (!html) {
      failed.push(cgids[index]);
      return;
    }
    const found = parseIfAny(html);
    if (found) {
      activeCgids.push(cgids[index]);
      Object.assign(products, found);
    }
  });
  const queryHtmls = await mapWithConcurrency(queries, cfg.categoryFetchConcurrency, (query) => fetchSearchHtmlSafe(query, cfg, "tail"));
  queryHtmls.forEach((html, index) => {
    if (!html) {
      failed.push(`q:${queries[index]}`);
      return;
    }
    const found = parseIfAny(html);
    if (found) Object.assign(products, found);
  });
  return { ok: true, products, activeCgids, failed, scanned: cgids.length + queries.length };
}

async function fastFetchProducts(env, cfg, state, fastCursor = 0, tickNumber = 0) {
  const pool = uniqueValues([
    ...cfg.extraCategoryIds,
    ...cfg.prospectiveCategoryIds,
    ...(Array.isArray(state.sitemapCategoryIds) ? state.sitemapCategoryIds : [])
  ]);
  const knownCategoryIds = Array.isArray(state.knownCategoryIds)
    ? state.knownCategoryIds
    : Array.isArray(state.activeCategoryIds)
    ? state.activeCategoryIds
    : [];
  const searchQueries = cfg.searchQueries || [];
  const cap = Math.max(2, cfg.fastMaxCategories - searchQueries.length);
  const shardReserve = Math.min(10, cfg.fastCategoryShardSize);
  const head = uniqueValues(["root", "shop", ...knownCategoryIds]).slice(0, Math.max(2, cap - shardReserve));

  const remainder = pool.filter((cgid) => !head.includes(cgid));
  const queryPool = (cfg.searchQueryTerms || []).filter((term) => !searchQueries.includes(term));

  const auditThisTick =
    !cfg.rootLaneEnabled || cfg.rootAuditEveryTicks <= 0 || tickNumber % cfg.rootAuditEveryTicks === 0;

  const [rootCatalog, fanout, headHtmls, searchHtmls] = await Promise.all([
    cfg.rootLaneEnabled ? fetchRootCatalog(cfg) : Promise.resolve(null),
    auditThisTick ? selfScanGrids(env, cfg, remainder, queryPool) : Promise.resolve(null),
    mapWithConcurrency(head, cfg.categoryFetchConcurrency, (cgid) => fetchGridHtmlSafe(cgid, cfg)),
    mapWithConcurrency(searchQueries, cfg.categoryFetchConcurrency, (query) => fetchSearchHtmlSafe(query, cfg))
  ]);

  const shardRoom = fanout ? 0 : Math.max(0, Math.min(cfg.fastCategoryShardSize, cap - head.length));
  const shard = rotatingSlice(pool, fastCursor, shardRoom);
  const shardHtmls = shard.length
    ? await mapWithConcurrency(shard, cfg.categoryFetchConcurrency, (cgid) => fetchGridHtmlSafe(cgid, cfg))
    : [];
  const rescueRoom = Math.max(0, Math.min(24, subrequestsLeft(cfg) - 12));
  const rescueCgids = (fanout?.unscannedCgids || []).slice(0, rescueRoom);
  const rescueHtmls = rescueCgids.length
    ? await mapWithConcurrency(rescueCgids, cfg.categoryFetchConcurrency, (cgid) => fetchGridHtmlSafe(cgid, cfg))
    : [];
  const rescuedOk = rescueHtmls.filter(Boolean).length;
  const cgids = uniqueValues([...head, ...shard, ...rescueCgids]);
  const htmls = [...headHtmls, ...shardHtmls, ...rescueHtmls];
  const pidUniverse = new Set();
  for (const html of htmls) if (html) for (const pid of extractGridPids(html)) pidUniverse.add(pid);
  for (const html of searchHtmls) if (html) for (const pid of extractGridPids(html)) pidUniverse.add(pid);
  for (const pid of Object.keys(fanout?.products || {})) pidUniverse.add(pid);
  for (const pid of rootCatalog?.pids || []) pidUniverse.add(pid);

  let auditMissedPids = [];
  if (rootCatalog && rootCatalog.complete && fanout) {
    const fanoutPids = new Set([...Object.keys(fanout.products || {})]);
    for (const html of headHtmls) if (html) for (const pid of extractGridPids(html)) fanoutPids.add(pid);
    auditMissedPids = [...fanoutPids].filter((pid) => !rootCatalog.pids.has(pid));
  }

  const previousSeen = state.seen || {};
  const previousActive = state.active || previousSeen;
  const previousMissing = state.missing || {};
  const candidatePids = [...pidUniverse].filter(
    (pid) => !previousSeen[pid] || relistEligible(pid, previousSeen, previousActive, previousMissing, cfg)
  );

  const nextFastCursor = pool.length ? (fastCursor + shard.length) % pool.length : 0;
  const meta = {
    mode: "fast",
    cgidCount: cgids.length + (fanout?.scanned || 0),
    activeCategoryCount: knownCategoryIds.length,
    shardSize: shard.length,
    root: rootCatalog
      ? { pages: rootCatalog.pages, complete: rootCatalog.complete, pids: rootCatalog.pids.size }
      : null,
    audited: Boolean(fanout && rootCatalog),
    auditMissed: auditMissedPids.length,
    auditMissedPids: auditMissedPids.slice(0, 10),
    fanoutSlices: fanout ? fanout.slices : null,
    fanoutSlicesOk: fanout ? fanout.slicesOk : null,
    fanoutRetried: fanout ? fanout.slicesRetried ?? 0 : null,
    fanoutFailed: fanout ? fanout.failed.length : null,
    unscanned: fanout ? Math.max(0, (fanout.unscannedCgids?.length || 0) - rescuedOk) : null,
    rescued: rescuedOk,
    searchQueries: searchQueries.length,
    searchFetched: searchHtmls.filter(Boolean).length,
    fetched: htmls.filter(Boolean).length,
    pidUniverse: pidUniverse.size,
    candidates: candidatePids.length,
    fastCursor,
    nextFastCursor
  };

  if (candidatePids.length === 0) {
    return { products: {}, meta, nextFastCursor, empty: true };
  }

  const combinedHtml = [...htmls, ...searchHtmls].filter(Boolean).join("\n");
  return {
    products: { ...parseProducts(combinedHtml), ...(fanout?.products || {}), ...(rootCatalog?.products || {}) },
    meta,
    nextFastCursor,
    empty: false
  };
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
  if (text.includes("out of stock") || text.includes("unavailable") || text.includes("not available")) return false;
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

  const colorAttribute = (product.variationAttributes || []).find((attribute) =>
    /^colou?r(val)?$/i.test(String(attribute?.attributeId || attribute?.id || ""))
  );
  const colors = (colorAttribute?.values || [])
    .filter((value) => value?.id)
    .map((value) => ({
      code: String(value.id),
      label: String(value.displayValue || value.value || value.id).trim(),
      selectable: Boolean(value.selectable)
    }));

  const inStockSizeCount = sizes.filter((size) => size.inStock).length;
  return {
    masterPid,
    selectedVariantPid,
    colors,
    colorAttributeId: colorAttribute ? String(colorAttribute.attributeId || colorAttribute.id) : null,
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
    if (subrequestsLeft(cfg) <= 4) return { ...size, exactStockError: "subrequest budget reserved" };

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
        cfg.requestTimeoutMs,
        cfg
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
    cfg.requestTimeoutMs,
    cfg
  );
  if (!response.ok) throw new MonitorError(`Chrome Hearts returned HTTP ${response.status}`, 502);

  let snapshot = parseProductStockPage(await response.text(), productUrl);
  if (!snapshot.masterPid && snapshot.sizes.length === 0 && !snapshot.image) {
    throw new MonitorError("Product detail page did not contain product metadata");
  }

  if (snapshot.variationUrl && subrequestsLeft(cfg) > 4) {
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
        cfg.requestTimeoutMs,
        cfg
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

async function acquireLock(env, cfg, ttlSeconds = cfg.lockSeconds) {
  const existingRaw = await env.STATE.get(cfg.lockKey);
  const existing = existingRaw ? JSON.parse(existingRaw) : null;
  if (existing?.expiresAt && Date.parse(existing.expiresAt) > Date.now()) return null;

  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
  await env.STATE.put(cfg.lockKey, JSON.stringify({ token, expiresAt }), { expirationTtl: ttlSeconds });
  return token;
}

async function releaseLock(env, cfg, token) {
  if (!token) return;
  try {
    const existingRaw = await env.STATE.get(cfg.lockKey);
    const existing = existingRaw ? JSON.parse(existingRaw) : null;
    if (existing?.token === token) await env.STATE.delete(cfg.lockKey);
  } catch {
  }
}

function shouldSkipForInterval(state, cfg) {
  if (!cfg.checkMinIntervalSeconds || !state.lastRunAt) return false;
  const elapsedSeconds = (Date.now() - Date.parse(state.lastRunAt)) / 1000;
  return Number.isFinite(elapsedSeconds) && elapsedSeconds < cfg.checkMinIntervalSeconds;
}

function computeBackoffUntil(state, cfg) {
  const streak = Math.max(1, Number(state.errorStreak || 0) + 1);
  const floorSeconds = Math.max(5, cfg.fastPollIntervalSeconds || cfg.checkMinIntervalSeconds || 60);
  const seconds = Math.min(cfg.maxBackoffSeconds, Math.max(floorSeconds, 2 ** Math.min(streak - 1, 8)));
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
    if (subrequestsLeft(cfg) <= 3) {
      throw new MonitorError("subrequest budget reserved for alert delivery");
    }
    return mergeProductDetail(product, await fetchStockSnapshot(product.url, cfg));
  } catch (error) {
    return {
      ...product,
      masterPid: product.pid,
      selectedVariantPid: "",
      description: product.description || "",
      exactStockKnown: false,
      totalStock: null,
      inStockSizeCount: product.inStockSizeCount ?? 0,
      sizes: product.sizes || [],
      detailError: error.message,
      enrichedAt: nowIso()
    };
  }
}

function buildProductEmbed(product) {
  const price = priceText(product.price) || "unknown";
  const inStock = compactList(sizeLabels(product, true)) || "none";
  const outOfStock = compactList(sizeLabels(product, false)) || "none";
  const fields = [
    { name: "Price", value: truncate(price, 1024), inline: true },
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
    color: 0xffffff,
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

async function postToWebhook(cfg, webhookUrl, payload) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    let response;
    try {
      response = await fetchWithTimeout(
        webhookUrl,
        {
          method: "POST",
          headers: { "content-type": "application/json", "user-agent": cfg.userAgent },
          body: JSON.stringify(payload),
          cache: "no-store"
        },
        cfg.webhookTimeoutMs,
        cfg
      );
    } catch {
      if (attempt < 3) {
        await sleep(400 * (attempt + 1));
        continue;
      }
      return false;
    }
    if (response.ok) return true;
    if (response.status === 429 && attempt < 3) {
      const retryAfter = Number.parseFloat(response.headers.get("retry-after") || "1");
      await sleep(Math.max(1, retryAfter) * 1000);
      continue;
    }
    return false;
  }
  return false;
}

function mainWebhookUrl(cfg) {
  const configured = (cfg.discordWebhookUrls || []).filter(Boolean);
  return cfg.discordMainWebhookUrl || configured[0] || null;
}

function operationalWebhookUrls(cfg) {
  const main = mainWebhookUrl(cfg);
  const opted = new Set(Array.isArray(cfg.discordWebhookVerbose) ? cfg.discordWebhookVerbose : []);
  const extra = (cfg.discordWebhookUrls || []).filter((url) => url !== main && opted.has(webhookIdFromUrl(url)));
  return [main, ...extra].filter(Boolean);
}

async function postToMainWebhook(cfg, payload) {
  const targets = operationalWebhookUrls(cfg);
  if (!targets.length) return false;
  const results = await Promise.all(
    targets.map((webhookUrl) =>
      postToWebhook(cfg, webhookUrl, payload).then(
        () => true,
        () => false
      )
    )
  );
  return results.some(Boolean);
}

const baselineMarkersEnsured = new Set();
async function ensureBaselineMarker(env, cfg, seenCount) {
  if (!seenCount || baselineMarkersEnsured.has(cfg.stateKey)) return;
  baselineMarkersEnsured.add(cfg.stateKey);
  try {
    const key = `${cfg.stateKey}:baselined`;
    if (!(await env.STATE.get(key))) await env.STATE.put(key, JSON.stringify({ at: nowIso() }));
  } catch {
    baselineMarkersEnsured.delete(cfg.stateKey);
  }
}

async function notifyStateLoss(cfg, productCount) {
  const payload = {
    username: "Chrome Hearts Monitor",
    content: "Monitor state was lost — re-baselined",
    embeds: [
      {
        author: { name: "Chrome Hearts Drop Monitor", url: BASE_URL },
        title: "State lost — products absorbed without alerting",
        description:
          `The stored catalog state was missing, so the monitor re-baselined and took in ` +
          `**${productCount} currently-live products without alerting on any of them**.\n\n` +
          `If a drop landed during this window it did NOT ping. Check the site manually.`,
        color: 0xffffff,
        footer: { text: "Chrome Hearts monitor - state loss" },
        timestamp: nowIso()
      }
    ]
  };
  await postToMainWebhook(cfg, payload);
}

async function notifyMonitorDegraded(cfg, message, streak) {
  const payload = {
    username: "Chrome Hearts Monitor",
    content: "Monitor is failing — not scanning reliably",
    embeds: [
      {
        author: { name: "Chrome Hearts Drop Monitor", url: BASE_URL },
        title: "Monitor degraded",
        description:
          `${streak} consecutive failed runs.\n\n\`\`\`${truncate(String(message || "unknown"), 500)}\`\`\`\n` +
          `Drops may not be detected until this clears.`,
        color: 0xffffff,
        footer: { text: "Chrome Hearts monitor - health" },
        timestamp: nowIso()
      }
    ]
  };
  await postToMainWebhook(cfg, payload);
}

async function notifyCoverageRegression(cfg, missedPids) {
  const payload = {
    username: "Chrome Hearts Monitor",
    content: "Coverage regression — cgid=root is no longer complete",
    embeds: [
      {
        author: { name: "Chrome Hearts Drop Monitor", url: BASE_URL },
        title: "Root catalog missed live products",
        description:
          `The category fan-out found **${missedPids.length}** live product(s) that the ` +
          `root-catalog lane did not return:\n\`\`\`${missedPids.slice(0, 15).join("\n")}\`\`\`\n` +
          `The guessed-slug lanes are load-bearing again. Nothing was missed — the ` +
          `auditor caught these — but the fast lane needs re-tuning.`,
        color: 0xffffff,
        footer: { text: "Chrome Hearts monitor - coverage audit" },
        timestamp: nowIso()
      }
    ]
  };
  await postToMainWebhook(cfg, payload);
}

async function notifyNewColorways(cfg, colorways) {
  const lines = colorways
    .slice(0, 8)
    .map(
      (entry) =>
        `\u{1f195} **NEW COLORWAY** \`${entry.code}\` ${entry.label ? `(${entry.label}) ` : ""}on style \`${entry.master}\`` +
        `${entry.name ? ` — ${entry.name}` : ""} — ${entry.selectable ? "**purchasable now**" : "staged, not yet buyable"}`
    );
  if (!lines.length) return;
  await postToMainWebhook(cfg, { username: "Chrome Hearts Monitor", content: lines.join("\n") });
}

async function sendDiscord(cfg, products) {
  const webhookUrls = (cfg.discordWebhookUrls || []).filter(Boolean);
  if (!webhookUrls.length) throw new MonitorError("No Discord webhook configured.", 500);

  const failures = [];
  await Promise.all(
    webhookUrls.map(async (webhookUrl) => {
      for (let index = 0; index < products.length; index += 10) {
        const chunk = products.slice(index, index + 10);
        const payload = {
          username: "Chrome Hearts Monitor",
          content: chunk.length === 1 ? "New Chrome Hearts item loaded" : `${chunk.length} new Chrome Hearts items loaded`,
          embeds: chunk.map(buildProductEmbed)
        };
        if (!(await postToWebhook(cfg, webhookUrl, payload))) {
          failures.push(webhookUrl);
          return;
        }
      }
    })
  );

  if (failures.length === webhookUrls.length) {
    throw new MonitorError(`All ${failures.length} Discord webhook(s) failed`, 502);
  }
  return { delivered: webhookUrls.length - failures.length, failed: failures.length };
}

async function sendInstantPing(cfg, products) {
  try {
    const lines = products
      .slice(0, 10)
      .map((product) => `🚨 **${truncate(product.name || product.pid, 120)}** — ${priceText(product.price) || "price unknown"} — <${product.url}>`);
    if (!lines.length) return;
    const payload = { username: "Chrome Hearts Monitor", content: lines.join("\n") };
    await Promise.all((cfg.discordWebhookUrls || []).map((webhookUrl) => postToWebhook(cfg, webhookUrl, payload).catch(() => false)));
  } catch {
    // never let the bonus ping break the alert path
  }
}

async function sendStagingPings(cfg, lines) {
  try {
    if (!lines.length) return;
    const payload = { username: "Chrome Hearts Monitor", content: lines.slice(0, 6).join("\n") };
    await postToMainWebhook(cfg, payload);
  } catch {
    // best-effort
  }
}

function alertStockLevel(product) {
  if (!product) return null;
  if (product.exactStockKnown && Number.isFinite(product.totalStock)) return { units: product.totalStock };
  if (Number.isFinite(product.cappedOrderableTotal) && product.cappedOrderableTotal > 0) {
    return { units: product.cappedOrderableTotal, capped: true };
  }
  return null;
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

function buildCatalogState(products, state, deferredPids, cfg, { partial = false } = {}) {
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

  if (partial) return { seen, active, missing };

  const graceMs = Math.max(0, (cfg.freshMissingGraceMinutes || 0) * 60000);

  for (const pid of Object.keys(previousActive)) {
    if (currentPids.has(pid)) continue;
    const freshMs = Math.max(Date.parse(seen[pid]?.firstSeenAt || "") || 0, Date.parse(seen[pid]?.lastAlertedAt || "") || 0);
    if (graceMs && freshMs && Date.now() - freshMs < graceMs) continue;
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

function logRun(cfg, entry) {
  if (!cfg || cfg.logVerbose === false) return;
  try {
    console.log(`chmon ${JSON.stringify(entry)}`);
  } catch {
    // never let logging break a run
  }
}

function runLogEntry(mode, result, ms, cfg) {
  const sweep = cfg?.sweepStats || null;
  return {
    at: nowIso(),
    mode,
    ms,
    ok: result.ok !== false,
    reason: result.reason || null,
    productCount: result.productCount ?? null,
    alerted: result.alerted ?? 0,
    deferred: result.deferred ?? 0,
    newPids: result.newPids || [],
    categoriesScanned: sweep?.categoriesScanned ?? result.fast?.cgidCount ?? null,
    activeCategories: sweep ? sweep.activeCategoryIds?.length ?? null : result.fast?.activeCategoryCount ?? null,
    failedCategories: sweep?.failedCategoryCount ?? result.fast?.fanoutFailed ?? 0,
    unscanned: sweep ? 0 : result.fast?.unscanned ?? 0,
    rescued: sweep ? 0 : result.fast?.rescued ?? 0,
    rootPages: result.fast?.root?.pages ?? null,
    rootPids: result.fast?.root?.pids ?? null,
    rootComplete: result.fast?.root?.complete ?? null,
    audited: result.fast?.audited ?? null,
    auditMissed: result.fast?.auditMissed ?? null,
    oracleAhead: result.oracleAhead ?? null,
    newColorways: (result.newColorways || []).length,
    stylesTracked: result.staging?.stylesTracked ?? null,
    lagSec: (result.lagSamples || []).map((sample) => sample.lagSec).filter((v) => v !== null && v !== undefined),
    searches: sweep?.searchQueryCount ?? result.fast?.searchQueries ?? 0,
    newFromSearch: sweep?.newFromSearch ?? null,
    staging: result.staging || null,
    enrichMs: result.enrichMs || 0,
    sendMs: result.sendMs || 0,
    error: result.error || null
  };
}

function catalogFingerprint(state) {
  return JSON.stringify([
    Object.keys(state.seen || {}).sort(),
    Object.keys(state.active || state.seen || {}).sort(),
    Object.entries(state.missing || {})
      .map(([pid, entry]) => `${pid}:${entry?.count || 0}`)
      .sort(),
    state.knownCategoryIds || [],
    state.activeCategoryIds || [],
    Object.entries(state.hotWatch || {})
      .map(([pid, entry]) => `${pid}:${entry?.dormant ? 1 : 0}`)
      .sort(),
    state.sitemapIndexLastmod || "",
    state.sitemapCategoryIds || [],
    Object.entries(state.styleRegistry || {})
      .map(([key, entry]) => `${key}:${(entry?.colors || []).slice().sort().join(",")}`)
      .sort(),
    state.burstUntil && Date.parse(state.burstUntil) > Date.now() ? 1 : 0
  ]);
}

async function runMonitor(env, cfg = null, opts = {}) {
  if (!cfg) cfg = await getRuntimeConfig(env);
  const mode = opts.mode === "fast" ? "fast" : "full";
  const skipLock = opts.skipLock === true;
  const fastCursor = mode === "fast" ? finiteInteger(opts.fastCursor, 0) : 0;
  const externalProspectiveCursor = Number.isInteger(opts.prospectiveCursor) ? opts.prospectiveCursor : null;
  const tickNumber = finiteInteger(opts.tickNumber, 0);
  const startedAt = Date.now();
  cfg.sweepStats = null;
  cfg.subrequestsUsed = 0;
  cfg.lightDiscoveryRun = opts.lightDiscovery === true;
  const done = (result) => {
    logRun(cfg, runLogEntry(mode, result, Date.now() - startedAt, cfg));
    return result;
  };

  let lockToken = null;
  if (!skipLock) {
    const lockTtl = mode === "fast" ? Math.max(10, cfg.fastPollIntervalSeconds + 10) : cfg.lockSeconds;
    lockToken = await acquireLock(env, cfg, lockTtl);
    if (!lockToken) return done({ ok: true, skipped: true, reason: "locked", mode, storage: "cloudflare-kv" });
  }

  let state = await loadState(env, cfg);
  cfg.bursting = Boolean(state.burstUntil && Date.parse(state.burstUntil) > Date.now());
  try {
    if (!skipLock && state.backoffUntil && Date.parse(state.backoffUntil) > Date.now()) {
      return done({ ok: true, skipped: true, reason: "backoff", mode, backoffUntil: state.backoffUntil, storage: "cloudflare-kv" });
    }
    if (!skipLock && mode === "full" && shouldSkipForInterval(state, cfg)) {
      return done({ ok: true, skipped: true, reason: "interval", mode, lastRunAt: state.lastRunAt, storage: "cloudflare-kv" });
    }

    const previousSeen = state.seen || {};
    const previousActive = state.active || previousSeen;
    const previousMissing = state.missing || {};
    const firstRun = Object.keys(previousSeen).length === 0;

    const baselineMarkerKey = `${cfg.stateKey}:baselined`;
    const stateLost = firstRun ? Boolean(await env.STATE.get(baselineMarkerKey).catch(() => null)) : false;

    const stagingPromise =
      cfg.stagingLaneEnabled && !firstRun ? runStagingLane(env, cfg, state).catch(() => null) : Promise.resolve(null);

    let products;
    let staging = null;
    let nextFastCursor = fastCursor;
    let fastMeta = null;
    if (mode === "fast") {
      if (firstRun) {
        await stagingPromise;
        return done({ ok: true, skipped: true, reason: "awaiting-baseline", mode, nextFastCursor: fastCursor, storage: "cloudflare-kv" });
      }
      const [fast, stagingResult] = await Promise.all([fastFetchProducts(env, cfg, state, fastCursor, tickNumber), stagingPromise]);
      staging = stagingResult;
      products = fast.products;
      nextFastCursor = fast.nextFastCursor;
      fastMeta = fast.meta;

      const stagingLiveCount = staging ? Object.keys(staging.liveProducts || {}).length : 0;
      if (fast.empty && !stagingLiveCount && !staging?.dirty) {
        return done({
          ok: true,
          mode,
          alerted: 0,
          deferred: 0,
          newPids: [],
          productCount: fast.meta.pidUniverse,
          fast: fast.meta,
          staging: staging
            ? {
                probed: staging.probedCount,
                hotWatch: Object.keys(staging.hotWatch).length,
                enumPool: staging.enumPoolSize ?? 0,
                version: staging.staticVersion || null,
                versionBump: Boolean(staging.versionBumped),
                ms: staging.ms ?? 0
              }
            : null,
          nextFastCursor,
          storage: "cloudflare-kv",
          checkedAt: nowIso()
        });
      }
    } else {
      const [full, stagingResult] = await Promise.all([
        fetchProducts(cfg, externalProspectiveCursor === null ? state : { ...state, prospectiveCategoryCursor: externalProspectiveCursor }),
        stagingPromise
      ]);
      products = full;
      staging = stagingResult;
    }

    if (staging) {
      for (const [pid, product] of Object.entries(staging.liveProducts || {})) {
        if (!products[pid]) products[pid] = product;
      }
    }

    const newPids = Object.keys(products).filter(
      (pid) => !previousSeen[pid] || relistEligible(pid, previousSeen, previousActive, previousMissing, cfg)
    );
    const baseline = mode === "full" && firstRun && !cfg.notifyInitial;
    if (baseline && stateLost) {
      await notifyStateLoss(cfg, Object.keys(products).length).catch(() => {});
    }
    const candidates = baseline ? [] : newPids.map((pid) => products[pid]);
    const productsToAlert = candidates.slice(0, cfg.maxAlertsPerRun);
    const deferredProducts = candidates.slice(cfg.maxAlertsPerRun);
    const deferredPids = new Set(deferredProducts.map((product) => product.pid));

    const pingPromise = cfg.pingFirstAlerts && productsToAlert.length ? sendInstantPing(cfg, productsToAlert) : null;

    const enrichStartedAt = Date.now();
    const enriched = productsToAlert.length
      ? await mapWithConcurrency(
          productsToAlert,
          Math.min(cfg.maxAlertsPerRun, cfg.exactStockProbeConcurrency > 1 ? 5 : 3),
          (product) => enrichProduct(product, cfg)
        )
      : [];
    const enrichMs = productsToAlert.length ? Date.now() - enrichStartedAt : 0;
    if (pingPromise) await pingPromise;
    const sendStartedAt = Date.now();
    if (enriched.length) await sendDiscord(cfg, enriched);
    const sendMs = enriched.length ? Date.now() - sendStartedAt : 0;

    if (staging?.newColorways?.length) {
      await notifyNewColorways(cfg, staging.newColorways).catch(() => {});
    }

    if (fastMeta?.auditMissed) {
      await notifyCoverageRegression(cfg, fastMeta.auditMissedPids || []).catch(() => {});
    }

    const indexedPids = new Set(Object.keys(products));
    const lagWatch = { ...(state.lagWatch || {}) };
    const lagSamples = [];
    for (const pid of Object.keys(staging?.liveProducts || {})) {
      if (!lagWatch[pid] && !indexedPids.has(pid)) {
        lagWatch[pid] = { at: nowIso(), name: staging.liveProducts[pid]?.name || null };
      }
    }
    for (const [pid, entry] of Object.entries(lagWatch)) {
      const openedMs = Date.parse(entry?.at || "") || 0;
      if (!openedMs) {
        delete lagWatch[pid];
        continue;
      }
      if (indexedPids.has(pid)) {
        lagSamples.push({
          pid,
          name: entry.name || null,
          lagSec: Math.round((Date.now() - openedMs) / 1000),
          at: nowIso()
        });
        delete lagWatch[pid];
      } else if (Date.now() - openedMs > 2 * 3600 * 1000) {
        lagSamples.push({ pid, name: entry.name || null, lagSec: null, censored: true, at: nowIso() });
        delete lagWatch[pid];
      }
    }
    const lagLog = [...(state.lagLog || []), ...lagSamples].slice(-200);

    const sweep = cfg.sweepStats || null;
    const result = {
      ok: true,
      mode,
      baseline,
      productCount: Object.keys(products).length,
      alerted: enriched.length,
      deferred: deferredProducts.length,
      newPids: productsToAlert.map((product) => product.pid),
      pinged: pingPromise ? productsToAlert.length : 0,
      discovery: mode === "full" ? cfg.discoveryRun || null : null,
      sweep,
      fast: fastMeta,
      staging: staging
        ? {
            discoveries: staging.discoveries.length,
            probed: staging.probedCount,
            live: Object.keys(staging.liveProducts || {}).length,
            hotWatch: Object.keys(staging.hotWatch).length,
            enumPool: staging.enumPoolSize ?? 0,
            stylesTracked: Object.keys(staging.styleColors || {}).length,
            newColorways: (staging.newColorways || []).length,
            bursting: Boolean(staging.bursting),
            version: staging.staticVersion || null,
            versionBump: Boolean(staging.versionBumped),
            ms: staging.ms ?? 0
          }
        : null,
      alertLanes: enriched.length ? Object.fromEntries(enriched.map((product) => [product.pid, product.productType || "grid"])) : null,
      nextFastCursor,
      nextProspectiveCursor: mode === "full" ? cfg.discoveryRun?.nextProspectiveCategoryCursor ?? null : null,
      subrequestsUsed: cfg.subrequestsUsed || 0,
      enrichMs,
      sendMs,
      oracleAhead: Object.keys(lagWatch).length,
      lagSamples,
      newColorways: staging?.newColorways || [],
      storage: "cloudflare-kv",
      checkedAt: nowIso()
    };

    const degraded = mode === "full" && (sweep?.failedCategoryCount || 0) > 5;
    const nextState = {
      ...state,
      ...buildCatalogState(products, state, baseline ? new Set() : deferredPids, cfg, {
        partial: mode === "fast" || degraded
      }),
      lastRunAt: nowIso(),
      lastResult: result,
      lagWatch,
      lagLog,
      errorStreak: 0,
      backoffUntil: null,
      lastError: null,
      lastErrorAt: null
    };
    if (mode === "full") {
      if (externalProspectiveCursor === null) {
        nextState.prospectiveCategoryCursor =
          cfg.discoveryRun?.nextProspectiveCategoryCursor ?? state.prospectiveCategoryCursor ?? 0;
      }
      if (sweep && !degraded) nextState.activeCategoryIds = sweep.activeCategoryIds;
      const learned = uniqueValues([
        ...(Array.isArray(state.knownCategoryIds) ? state.knownCategoryIds : []),
        ...(sweep && !degraded ? sweep.activeCategoryIds : []),
        ...Object.values(nextState.seen || {})
          .map((record) => categoryIdFromUrl(record?.url))
          .filter(Boolean)
      ]).filter((cgid) => cgid && cgid !== "root" && cgid !== "shop");
      nextState.knownCategoryIds = learned.slice(-120);
    }

    if (staging) {
      const nextHotWatch = { ...staging.hotWatch };
      for (const product of enriched) {
        delete nextHotWatch[product.pid];
        if (product.masterPid) delete nextHotWatch[product.masterPid];
      }
      nextState.hotWatch = nextHotWatch;
      if (staging.sitemapIndexLastmod !== undefined) nextState.sitemapIndexLastmod = staging.sitemapIndexLastmod;
      if (staging.sitemapCategoryIds) nextState.sitemapCategoryIds = staging.sitemapCategoryIds;
      if (staging.staticVersion) nextState.staticVersion = staging.staticVersion;
      if (staging.styleColors) nextState.styleColors = staging.styleColors;
      if (!state.stagingBaselinedAt) nextState.stagingBaselinedAt = nowIso();
    }
    if (nextState.enumTried) delete nextState.enumTried;

    if (enriched.length && nextState.seen) {
      for (const product of enriched) {
        if (nextState.seen[product.pid]) {
          const previous = nextState.seen[product.pid];
          const stock = alertStockLevel(product);
          nextState.seen[product.pid] = {
            ...previous,
            lastAlertedAt: nowIso(),
            image: product.image || previous.image || "",
            ...(stock === null
              ? {}
              : {
                  initialStock: previous.initialStock ?? stock,
                  initialStockAt: previous.initialStockAt || nowIso(),
                  latestStock: stock,
                  latestStockAt: nowIso()
                })
          };
        }
      }
    }

    if (Object.keys(products).length) {
      nextState.styleRegistry = boundStyleRegistry(updateStyleRegistry(products, state.styleRegistry));
    }

    if (cfg.burstWindowSeconds > 0) {
      const previousActiveCats = Array.isArray(state.activeCategoryIds) ? state.activeCategoryIds : [];
      const dropSignal =
        enriched.length > 0 ||
        (staging && (staging.dropSignal || Object.keys(staging.liveProducts || {}).length > 0)) ||
        (mode === "full" &&
          !degraded &&
          previousActiveCats.length > 0 &&
          Array.isArray(sweep?.activeCategoryIds) &&
          sweep.activeCategoryIds.some((cgid) => !previousActiveCats.includes(cgid)));
      if (dropSignal) {
        nextState.burstUntil = new Date(Date.now() + cfg.burstWindowSeconds * 1000).toISOString();
      } else if (state.burstUntil && Date.parse(state.burstUntil) <= Date.now()) {
        delete nextState.burstUntil;
      }
      result.burstUntil = nextState.burstUntil || null;
    }

    const quietFullSweep =
      mode === "full" &&
      externalProspectiveCursor !== null &&
      !baseline &&
      enriched.length === 0 &&
      deferredProducts.length === 0 &&
      Boolean(state.lastRunAt) &&
      !state.lastError &&
      !state.backoffUntil &&
      !state.enumTried &&
      catalogFingerprint(nextState) === catalogFingerprint(state);
    result.kvWrite = !quietFullSweep;
    if (!quietFullSweep) await saveState(env, cfg, nextState);
    await ensureBaselineMarker(env, cfg, Object.keys(nextState.seen || {}).length);

    return done(result);
  } catch (error) {
    const backoff = computeBackoffUntil(state, cfg);
    if (backoff.errorStreak === 3) {
      await notifyMonitorDegraded(cfg, error.message, backoff.errorStreak).catch(() => {});
    }
    await saveState(env, cfg, {
      ...state,
      ...backoff,
      lastError: error.message,
      lastErrorAt: nowIso(),
      lastResult: { ok: false, mode, error: error.message, checkedAt: nowIso() }
    }).catch(() => {});
    logRun(cfg, runLogEntry(mode, { ok: false, error: error.message }, Date.now() - startedAt, cfg));
    throw error;
  } finally {
    await releaseLock(env, cfg, lockToken);
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

function checked(value) {
  return value ? " checked" : "";
}

function numField(name, label, value, min, max, defaultValue, help = "") {
  return `<div class="field num">
      <label for="${name}">${escapeHtml(label)} <span class="deflt">default: ${escapeHtml(defaultValue)}</span></label>
      <input id="${name}" name="${name}" type="number" min="${escapeHtml(min)}" max="${escapeHtml(max)}" value="${escapeHtml(value)}"${
    help ? ` title="${escapeHtml(help)}"` : ""
  }>
    </div>`;
}

function dashboard(state, cfg, settings = {}, flags = {}) {
  const saved = flags.saved === true;
  const webhooksSaved = flags.webhooksSaved ?? null;
  const last = state.lastResult || {};
  const seenCount = Object.keys(state.seen || {}).length;
  const activeCount = Object.keys(state.active || state.seen || {}).length;
  const missingCount = Object.keys(state.missing || {}).length;
  const cadenceSeconds = cfg.fastPollEnabled ? cfg.fastPollIntervalSeconds : 60;
  const controller = flags.controller || null;
  const heartbeatIso = controller?.lastTickAt || "";
  const heartbeatReadable = Boolean(heartbeatIso);
  const lastRunMs = Date.parse(heartbeatIso) || 0;
  const staleMs = lastRunMs ? Math.max(0, Date.now() - lastRunMs) : null;
  const staleLimitMs = Math.max(150000, cadenceSeconds * 1000 * (DO_FLUSH_EVERY_TICKS + 6));
  const loopStalled = staleMs !== null && staleMs > staleLimitMs;
  const status = !heartbeatReadable
    ? state.lastRunAt
      ? "UNKNOWN"
      : "Ready"
    : loopStalled
    ? "STALLED"
    : last.ok === false
    ? "Issue"
    : "Online";
  const lastRun = state.lastRunAt || "Never";
  const durationText = (ms) => {
    const seconds = Math.round(ms / 1000);
    if (seconds < 90) return `${seconds}s`;
    const minutes = Math.round(seconds / 60);
    if (minutes < 90) return `${minutes} min`;
    const hours = Math.round(minutes / 60);
    return hours < 48 ? `${hours}h` : `${Math.round(hours / 24)} days`;
  };
  const agoText = (ms) => (ms === null ? "never" : `${durationText(ms)} ago`);
  const lastProducts = last.productCount ?? seenCount;
  const updated = state.updatedAt || state.createdAt || nowIso();
  const extraCategoryIds = cfg.extraCategoryIds.join(", ");
  const extraProductUrls = cfg.extraProductUrls.join("\n");
  const webhookCount = (cfg.discordWebhookUrls || []).length;
  const dashboardWebhookCount = Array.isArray(settings.discordWebhookUrls) ? settings.discordWebhookUrls.length : 0;
  const webhookSource = dashboardWebhookCount ? "dashboard-managed" : "from Worker secret";
  const webhookStatus = `${webhookCount} webhook${webhookCount === 1 ? "" : "s"} active (${webhookSource})`;
  const newestFirst = (a, b) => (Date.parse(b) || 0) - (Date.parse(a) || 0);
  const seenValues = Object.values(state.seen || {}).filter((entry) => entry && entry.pid);
  const pingedProducts = seenValues
    .filter((entry) => entry.lastAlertedAt)
    .sort((a, b) => newestFirst(a.lastAlertedAt, b.lastAlertedAt));
  const lastPing = pingedProducts[0] || null;
  const lastPingMs = lastPing ? Date.parse(lastPing.lastAlertedAt) || 0 : 0;
  const activeValues = Object.values(state.active || {})
    .filter((entry) => entry && entry.pid)
    .sort((a, b) => newestFirst(a.firstSeenAt, b.firstSeenAt));
  const priceCell = (value) => {
    const text = priceText(value);
    return text ? escapeHtml(text) : "—";
  };
  const stockText = (stock) => (stock ? `${stock.units}${stock.capped ? "+" : ""}` : "—");
  const stockCell = (entry) => {
    const initial = entry.initialStock || null;
    const latest = entry.latestStock || null;
    if (!initial && !latest) return "—";
    if (!initial || !latest || initial.units === latest.units) {
      return `<span class="stock">${escapeHtml(stockText(latest || initial))}</span>`;
    }
    const dropping = latest.units < initial.units;
    return `<span class="stock was">${escapeHtml(stockText(initial))}</span>
      <span class="arrow ${dropping ? "down" : "up"}">${dropping ? "↓" : "↑"}</span>
      <span class="stock ${dropping ? "down" : "up"}">${escapeHtml(stockText(latest))}</span>`;
  };
  const thumbUrl = (url) => `${String(url).split("?")[0]}?sw=80&sh=80&sm=fit`;
  const thumb = (entry) =>
    entry.image
      ? `<img class="thumb" src="${escapeHtml(thumbUrl(entry.image))}" alt="" loading="lazy">`
      : `<span class="thumb empty"></span>`;
  const productRow = (entry, whenIso, whenLabel, withStock = false) => `<tr>
    <td class="prod">${thumb(entry)}<span>${
      entry.url
        ? `<a href="${escapeHtml(entry.url)}" target="_blank" rel="noreferrer">${escapeHtml(entry.name || entry.pid)}</a>`
        : escapeHtml(entry.name || entry.pid)
    }<div class="pid">${escapeHtml(entry.pid)}</div></span></td>
    <td>${priceCell(entry.price)}</td>
    <td>${escapeHtml(entry.category || "—")}</td>
    ${withStock ? `<td>${stockCell(entry)}</td>` : ""}
    <td title="${escapeHtml(whenIso || "")}">${escapeHtml(whenLabel)}</td>
  </tr>`;
  const mainHook = mainWebhookUrl(cfg);
  const hookNames = cfg.discordWebhookNames && typeof cfg.discordWebhookNames === "object" ? cfg.discordWebhookNames : {};
  const verboseIds = new Set(Array.isArray(cfg.discordWebhookVerbose) ? cfg.discordWebhookVerbose : []);
  const webhookRows = (cfg.discordWebhookUrls || []).map((url) => {
    const id = webhookIdFromUrl(url);
    return {
      id,
      name: hookNames[id] || `Webhook ${id.slice(-4)}`,
      masked: maskWebhook(url),
      isMain: url === mainHook,
      verbose: verboseIds.has(id)
    };
  });

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Chrome Hearts Monitor</title>
  <style>
    :root { color-scheme: dark; --bg: #080909; --panel: #121414; --line: #2a2d2d; --text: #f1f1ee; --muted: #a9aaa4; --mint: #b8f3d4; --blue: #b7b2ff; --field: #0c0d0d; --alarm: #ffb4a8; }
    * { box-sizing: border-box; }
    body { margin: 0; font: 14px/1.45 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: var(--bg); color: var(--text); }
    main { width: min(1120px, calc(100vw - 32px)); margin: 0 auto; padding: 32px 0; }
    header { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; border-bottom: 1px solid var(--line); padding-bottom: 18px; }
    h1 { margin: 0; font-size: clamp(24px, 5vw, 44px); line-height: 1; letter-spacing: 0; }
    .pill { border: 1px solid var(--line); border-radius: 999px; padding: 8px 12px; color: var(--mint); white-space: nowrap; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 12px; margin: 22px 0; }
    h2 .count { margin-left: 8px; padding: 2px 9px; border-radius: 999px; border: 1px solid var(--line); color: var(--muted); font-size: 12px; vertical-align: middle; }
    .tablewrap { border: 1px solid var(--line); border-radius: 8px; overflow-x: auto; background: var(--panel); }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th { text-align: left; padding: 10px 14px; color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: .08em; border-bottom: 1px solid var(--line); white-space: nowrap; }
    td { padding: 10px 14px; border-bottom: 1px solid var(--line); vertical-align: top; }
    tr:last-child td { border-bottom: 0; }
    td a { color: var(--blue); text-decoration: none; }
    td a:hover { text-decoration: underline; }
    .pid { color: var(--muted); font-size: 11px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; margin-top: 2px; }
    td.prod { display: flex; gap: 10px; align-items: flex-start; }
    .thumb { width: 40px; height: 40px; border-radius: 6px; object-fit: contain; background: #fff; border: 1px solid var(--line); flex: 0 0 auto; }
    .thumb.empty { display: inline-block; }
    .stock { font-variant-numeric: tabular-nums; }
    .stock.was { color: var(--muted); }
    .stock.down, .arrow.down { color: var(--alarm); }
    .stock.up, .arrow.up { color: var(--mint); }
    .arrow { padding: 0 2px; }
    .card { border: 1px solid var(--line); border-radius: 8px; background: var(--panel); padding: 14px; min-height: 96px; }
    .label { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: .08em; }
    .value { margin-top: 10px; font-size: 22px; font-weight: 700; overflow-wrap: anywhere; }
    .sub { margin-top: 6px; color: var(--muted); font-size: 12px; }
    .card.alarm { border-color: var(--alarm); background: color-mix(in srgb, var(--alarm) 12%, var(--panel)); }
    .card.alarm .value, .card.alarm .sub { color: var(--alarm); }
    .banner { margin: 16px 0 0; padding: 12px 14px; border: 1px solid var(--alarm); border-radius: 8px; background: color-mix(in srgb, var(--alarm) 12%, var(--panel)); color: var(--alarm); }
    .pill.stalled { color: var(--alarm); border-color: var(--alarm); }
    .tag { display: inline-block; margin-left: 8px; padding: 2px 8px; border-radius: 999px; border: 1px solid var(--mint); color: var(--mint); font-size: 11px; letter-spacing: .04em; }
    .tag.muted-tag { border-color: var(--line); color: var(--muted); }
    .chips { display: flex; flex-direction: column; gap: 8px; margin: 4px 0 14px; }
    .chip { display: flex; align-items: center; gap: 12px; padding: 8px 10px 8px 12px; border: 1px solid var(--line); border-radius: 10px; background: var(--field); flex-wrap: wrap; }
    .chip.main { border-color: var(--mint); }
    .chip-body { display: flex; flex-direction: column; min-width: 200px; flex: 1 1 220px; }
    .chip-name { font-weight: 600; }
    .chip-url { color: var(--muted); font-size: 11px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    .chip-opt { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--muted); white-space: nowrap; cursor: pointer; }
    .chip.main .chip-opt input[type=radio] { accent-color: var(--mint); }
    .chip-pick { display: inline-flex; align-items: center; }
    .chip-x { background: transparent; border: 1px solid var(--line); color: var(--muted); border-radius: 8px; width: 30px; height: 30px; font-size: 17px; line-height: 1; cursor: pointer; padding: 0; }
    .chip-x:hover { border-color: var(--alarm); color: var(--alarm); }
    .addhook { display: flex; gap: 12px; align-items: flex-end; flex-wrap: wrap; }
    .addhook .field { margin: 0; }
    .addhook .field.grow { flex: 1 1 340px; }
    .hint { color: var(--muted); font-weight: 400; font-size: 11px; }
    button.ghost { background: transparent; color: var(--muted); border: 1px solid var(--line); }
    button.ghost:hover { border-color: var(--alarm); color: var(--alarm); }
    fieldset.group { border: 1px solid var(--line); border-radius: 10px; padding: 14px 16px 16px; margin: 0 0 14px; }
    fieldset.group legend { padding: 0 8px; color: var(--text); font-size: 12px; text-transform: uppercase; letter-spacing: .08em; }
    .group-note { color: var(--muted); font-size: 12px; margin: 0 0 12px; }
    .fields { display: flex; flex-wrap: wrap; gap: 14px; }
    .fields .field { margin: 0; }
    .field.num { width: 150px; }
    .field.wide { flex: 1 1 100%; }
    .field .deflt { display: block; color: var(--muted); font-weight: 400; font-size: 11px; margin-top: 2px; }
    .check .deflt { display: inline; margin-left: 4px; }
    section { border-top: 1px solid var(--line); padding-top: 18px; margin-top: 18px; }
    pre { white-space: pre-wrap; overflow-wrap: anywhere; background: #0c0d0d; border: 1px solid var(--line); border-radius: 8px; padding: 14px; color: var(--muted); }
    form { display: grid; gap: 16px; }
    .form-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
    .field { display: grid; gap: 7px; }
    label, .check { color: var(--muted); font-size: 13px; }
    input[type="text"], input[type="url"], input[type="number"], textarea { width: 100%; min-height: 42px; border: 1px solid var(--line); border-radius: 6px; background: var(--field); color: var(--text); padding: 9px 10px; font: inherit; }
    textarea { min-height: 92px; resize: vertical; grid-column: span 2; }
    input[type="checkbox"] { width: 16px; height: 16px; accent-color: var(--mint); }
    .checks { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px 16px; }
    .check { display: flex; align-items: center; gap: 8px; min-height: 28px; }
    .actions { display: flex; justify-content: space-between; gap: 12px; align-items: center; flex-wrap: wrap; }
    button { border: 1px solid var(--mint); border-radius: 6px; background: var(--mint); color: #07100b; min-height: 40px; padding: 0 14px; font: inherit; font-weight: 700; cursor: pointer; }
    .note { color: var(--muted); margin: 0; }
    .saved { color: var(--mint); }
    a { color: var(--blue); }
    h2 { margin: 0 0 2px; font-size: 20px; }
    .mint { color: var(--mint); }
    section.webhooks { border: 1px solid var(--mint); border-radius: 10px; background: var(--panel); padding: 18px; margin: 22px 0; display: grid; gap: 12px; }
    section.webhooks form { gap: 12px; }
    .hooklist { border: 1px solid var(--line); border-radius: 8px; background: var(--field); padding: 10px 14px; }
    .hooklist ul { margin: 8px 0 0; padding-left: 18px; }
    .hooklist li { color: var(--text); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; overflow-wrap: anywhere; }
    section.webhooks .checks { grid-template-columns: 1fr; }
    details.help { border-top: 1px solid var(--line); padding-top: 10px; }
    details.help summary { cursor: pointer; color: var(--blue); }
    details.help ol { color: var(--muted); margin: 10px 0 0; padding-left: 20px; line-height: 1.7; }
    details.help li { margin-bottom: 4px; }
    @media (max-width: 860px) { header { display: block; } .pill { display: inline-block; margin-top: 14px; } .grid, .form-grid, .checks { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
    @media (max-width: 560px) { .grid, .form-grid, .checks { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <h1>Chrome Hearts Monitor</h1>
        <p>Cloudflare Worker cron, KV state, Discord product alerts.</p>
      </div>
      <div class="pill${loopStalled ? " stalled" : ""}">${escapeHtml(status)}</div>
    </header>
    <div class="grid">
      <div class="card${loopStalled || !heartbeatReadable ? " alarm" : ""}">
        <div class="label">Last check</div>
        <div class="value">${heartbeatReadable ? escapeHtml(agoText(staleMs)) : "unknown"}</div>
        <div class="sub">${
          !heartbeatReadable
            ? "HEARTBEAT UNREADABLE — cannot confirm the loop is running"
            : loopStalled
            ? `NOT SCANNING — expected every ~${escapeHtml(cadenceSeconds)}s`
            : `scanning every ~${escapeHtml(cadenceSeconds)}s`
        }</div>
      </div>
      <div class="card"><div class="label">Products tracked</div><div class="value">${activeCount}</div><div class="sub">${seenCount} seen all-time</div></div>
      <div class="card"><div class="label">Watching for restock</div><div class="value">${missingCount}</div><div class="sub">sold out or delisted</div></div>
      <div class="card">
        <div class="label">Last ping</div>
        <div class="value">${lastPing ? escapeHtml(agoText(Math.max(0, Date.now() - lastPingMs))) : "none yet"}</div>
        <div class="sub">${lastPing ? escapeHtml(truncate(lastPing.name || lastPing.pid, 42)) : "no alert has fired yet"}</div>
      </div>
      <div class="card"><div class="label">Discord servers</div><div class="value">${webhookCount}</div><div class="sub">${escapeHtml(webhookSource)}</div></div>
    </div>
    ${
      loopStalled
        ? `<p class="banner">The monitor has not completed a check for ${escapeHtml(
            durationText(staleMs)
          )}. Drops are NOT being detected right now. The 1-minute watchdog retries automatically — if this does not clear within a few minutes, redeploy.</p>`
        : !heartbeatReadable && state.lastRunAt
        ? `<p class="banner">The Durable Object heartbeat could not be read, so whether the loop is scanning is UNKNOWN. This page deliberately does not fall back to the catalog timestamp — that is what reported a healthy monitor throughout the 7-day 2026-07-17 outage. Check /health and \`wrangler tail\` for chmon.hb lines.</p>`
        : ""
    }

    <section>
      <h2>Alert history</h2>
      <p class="note">Every product the monitor has pinged Discord about, newest first.</p>
      ${
        pingedProducts.length
          ? `<div class="tablewrap"><table>
              <thead><tr><th>Product</th><th>Price</th><th>Category</th><th>Stock at ping → now</th><th>Pinged</th></tr></thead>
              <tbody>${pingedProducts
                .slice(0, 25)
                .map((entry) =>
                  productRow(entry, entry.lastAlertedAt, agoText(Math.max(0, Date.now() - (Date.parse(entry.lastAlertedAt) || 0))), true)
                )
                .join("")}</tbody>
            </table></div>
            ${pingedProducts.length > 25 ? `<p class="note">Showing the 25 most recent of ${pingedProducts.length} alerts.</p>` : ""}`
          : `<p class="note">No alerts have fired yet. Products already in the catalog when the monitor first ran are baselined silently — only genuinely new items ping.</p>`
      }
    </section>

    <section>
      <h2>Products tracked <span class="count">${activeValues.length}</span></h2>
      <p class="note">Currently live in the catalog, newest first.${
        missingCount ? ` ${missingCount} ${missingCount === 1 ? "other is" : "others are"} being watched for restock.` : ""
      }</p>
      ${
        activeValues.length
          ? `<div class="tablewrap"><table>
              <thead><tr><th>Product</th><th>Price</th><th>Category</th><th>First seen</th></tr></thead>
              <tbody>${activeValues
                .slice(0, 100)
                .map((entry) => productRow(entry, entry.firstSeenAt, agoText(Math.max(0, Date.now() - (Date.parse(entry.firstSeenAt) || 0)))))
                .join("")}</tbody>
            </table></div>
            ${activeValues.length > 100 ? `<p class="note">Showing 100 of ${activeValues.length}.</p>` : ""}`
          : `<p class="note">Nothing tracked yet — the first full sweep will populate this.</p>`
      }
    </section>

    <section class="webhooks">
      <div class="actions">
        <div>
          <h2>Discord webhooks</h2>
          <p class="note">
            <strong class="mint">${escapeHtml(webhookStatus)}</strong>${
    webhooksSaved !== null ? ` <span class="saved">Saved — ${escapeHtml(webhooksSaved)} active. Live within ~${escapeHtml(cadenceSeconds)}s.</span>` : ""
  }
          </p>
        </div>
      </div>
      <p class="note">
        <strong>Product alerts</strong> (new items and restocks) go to <em>every</em> webhook below — one per Discord server.
        <strong>Everything else</strong> — health warnings, staging/category intel and test alerts — goes to the
        <strong class="mint">MAIN</strong> webhook only, so other people's servers only ever see real drops.
        Changes apply on the next check, about <strong>${escapeHtml(cadenceSeconds)} seconds</strong>, no redeploy.
      </p>
      ${
        webhookRows.length
          ? `<form action="/webhooks" method="post">
              <input type="hidden" name="webhookPrefs" value="1">
              <div class="chips">${webhookRows
                .map(
                  (row) => `<div class="chip${row.isMain ? " main" : ""}">
                    <label class="chip-pick"><input type="checkbox" name="selected" value="${escapeHtml(row.id)}"></label>
                    <span class="chip-body">
                      <span class="chip-name">${escapeHtml(row.name)}</span>
                      <span class="chip-url">${escapeHtml(row.masked)}</span>
                    </span>
                    <label class="chip-opt" title="Make this the MAIN webhook — it receives everything and is the target for test alerts">
                      <input type="radio" name="mainWebhook" value="${escapeHtml(row.id)}"${row.isMain ? " checked" : ""}> MAIN
                    </label>
                    <label class="chip-opt" title="Also send staging intel, new-category notices and health warnings to this server">
                      <input type="checkbox" name="verbose" value="${escapeHtml(row.id)}"${row.verbose || row.isMain ? " checked" : ""}${
                    row.isMain ? " disabled" : ""
                  }> + intel
                    </label>
                    <button class="chip-x" type="submit" name="remove" value="${escapeHtml(row.id)}" title="Remove this webhook" aria-label="Remove ${escapeHtml(
                    row.name
                  )}">×</button>
                  </div>`
                )
                .join("")}</div>
              <div class="actions">
                <button type="submit">Save webhook settings</button>
                <button class="ghost" type="submit" name="removeSelected" value="1">Remove selected</button>
                <p class="note">Tick the boxes to remove several at once, or click a chip's × to remove just that one.</p>
              </div>
            </form>`
          : `<p class="note">No webhooks configured — alerts have nowhere to go until you add one.</p>`
      }
      <form action="/webhooks" method="post" class="addhook">
        <div class="field">
          <label for="webhookName">Name <span class="hint">optional — e.g. "Main server"</span></label>
          <input id="webhookName" name="webhookName" type="text" maxlength="40" autocomplete="off" placeholder="Spidey Bot">
        </div>
        <div class="field grow">
          <label for="discordWebhookUrls">Webhook URL</label>
          <input id="discordWebhookUrls" name="discordWebhookUrls" type="text" autocomplete="off" placeholder="https://discord.com/api/webhooks/…">
        </div>
        <button type="submit">Add webhook</button>
      </form>
      <p class="note">
        <a href="/selftest">Send a test alert</a> — goes to the MAIN webhook only.
        <a href="/selftest?all=1">Test every webhook</a> if you just added one and want to prove it delivers.
      </p>
      <details class="help">
        <summary>How to add or remove a webhook</summary>
        <ol>
          <li><strong>Get a URL:</strong> in Discord → <em>Server Settings → Integrations → Webhooks → New Webhook</em>, pick a channel, then <em>Copy Webhook URL</em>.</li>
          <li><strong>Add a server:</strong> paste the URL, choose <em>Add</em>, and Save. Do this once per server.</li>
          <li><strong>Remove one:</strong> choose <em>Replace</em> and paste only the URLs you want to keep (leave out the one to drop), then Save.</li>
          <li><strong>Remove all:</strong> tick <em>Remove all</em> and Save — the monitor falls back to the Worker-secret webhook.</li>
          <li><strong>Which one is MAIN?</strong> The first in the list, or whichever <code>DISCORD_MAIN_WEBHOOK_URL</code> is set to. It is the only webhook that receives non-product traffic — health warnings, staging intel and test alerts. Every other server gets product alerts and nothing else.</li>
          <li><strong>Is it live?</strong> Yes — saved webhooks apply on the next check (~${escapeHtml(cadenceSeconds)}s). The "Currently active" list above always reflects what's in effect right now. Use <em>Send a test alert</em> to confirm.</li>
        </ol>
      </details>
    </section>

    <section>
      <form action="/settings" method="post">
        <div class="actions">
          <div>
            <div class="label">Runtime settings</div>
            <p class="note">Tuning only — webhooks are managed above.${saved ? ' <span class="saved">Settings saved.</span>' : ""}</p>
          </div>
          <button type="submit">Save settings</button>
        </div>
        <fieldset class="group">
          <legend>Alerting</legend>
          <p class="group-note">How much the monitor is allowed to say, and how quickly a sold-out item counts as relisted.</p>
          <div class="fields">
            ${numField("maxAlertsPerRun", "Max alerts per run", cfg.maxAlertsPerRun, 1, 10, 5, "Extra finds wait for the next tick — none are dropped.")}
            ${numField("relistAfterAbsentRuns", "Relist after absent runs", cfg.relistAfterAbsentRuns, 1, 12, 2, "Full sweeps a product must be missing before a restock re-alerts.")}
            ${numField("checkMinIntervalSeconds", "Min interval (s)", cfg.checkMinIntervalSeconds, 0, 3600, 0, "Throttle for manual /api/cron runs only. The fast loop ignores it.")}
          </div>
        </fieldset>

        <fieldset class="group">
          <legend>Coverage</legend>
          <p class="group-note">How much of the catalog each sweep reaches. Higher means fewer blind spots and more fetches.</p>
          <div class="fields">
            ${numField("maxCategoryIds", "Max categories", cfg.maxCategoryIds, 1, 400, 250)}
            ${numField("maxCategoryPages", "Pages per category", cfg.maxCategoryPages, 1, 5, 2)}
            ${numField("prospectiveCategoryShardSize", "Hidden category shard", cfg.prospectiveCategoryShardSize, 1, 400, 60, "Rotation size when the SELF fan-out is unavailable.")}
            ${numField("maxPages", "Root pages", cfg.maxPages, 1, 20, 10)}
            ${numField("maxDirectProductUrls", "Direct product URLs", cfg.maxDirectProductUrls, 0, 50, 4)}
            <div class="field wide">
              <label for="extraCategoryIds">Extra categories <span class="deflt">default: none</span></label>
              <input id="extraCategoryIds" name="extraCategoryIds" type="text" value="${escapeHtml(extraCategoryIds)}" placeholder="hat, hoodie, jewelry">
            </div>
            <div class="field wide">
              <label for="extraProductUrls">Extra product URLs <span class="deflt">default: none — one per line</span></label>
              <textarea id="extraProductUrls" name="extraProductUrls" placeholder="https://www.chromehearts.com/category/item/PID.html">${escapeHtml(extraProductUrls)}</textarea>
            </div>
          </div>
        </fieldset>

        <fieldset class="group">
          <legend>Fetch budget</legend>
          <p class="group-note">Guard rails against the Workers subrequest cap. Raising these on the free plan risks "too many subrequests".</p>
          <div class="fields">
            ${numField("categoryFetchConcurrency", "Grid concurrency", cfg.categoryFetchConcurrency, 1, 24, 20)}
            ${numField("maxStorefrontSubrequests", "Storefront fetches", cfg.maxStorefrontSubrequests, 10, 400, 40)}
          </div>
        </fieldset>

        <fieldset class="group">
          <legend>Discovery &amp; stock</legend>
          <p class="group-note">Where new category slugs are learned from, and whether exact stock counts are probed.</p>
          <div class="checks">
            <label class="check"><input name="discoverSitemapCategories" type="checkbox"${checked(cfg.discoverSitemapCategories)}> Sitemap categories <span class="deflt">on</span></label>
            <label class="check"><input name="discoverHomepageCategories" type="checkbox"${checked(cfg.discoverHomepageCategories)}> Homepage categories <span class="deflt">on</span></label>
            <label class="check"><input name="discoverProductUrlCategories" type="checkbox"${checked(cfg.discoverProductUrlCategories)}> Product URL categories <span class="deflt">on</span></label>
            <label class="check"><input name="discoverRobotsProducts" type="checkbox"${checked(cfg.discoverRobotsProducts)}> Robots product URLs <span class="deflt">on</span></label>
            <label class="check"><input name="probeExactStock" type="checkbox"${checked(cfg.probeExactStock)}> Exact stock probe <span class="deflt">on</span></label>
          </div>
        </fieldset>
      </form>
    </section>
    <section>
      <div class="label">Last run</div>
      <pre>${escapeHtml(lastRun)}</pre>
      <div class="label">Last grid count</div>
      <pre>${escapeHtml(lastProducts)}</pre>
      <div class="label">Last alerted</div>
      <pre>${escapeHtml(last.alerted ?? 0)}</pre>
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
  let baseCfg;
  try {
    baseCfg = getConfig(env);
  } catch (error) {
    return jsonResponse({ ok: false, error: error.message }, 500);
  }

  const url = new URL(request.url);
  if (url.pathname === "/" || url.pathname === "/dashboard") {
    if (!isPrivatePageAuthorized(request, baseCfg)) return privatePageUnauthorized(request);
    const settings = await loadSettings(env, baseCfg);
    const cfg = applyRuntimeSettings(baseCfg, settings);
    const controller = await fastPollStatus(env).catch(() => null);
    return htmlResponse(
      dashboard(await loadState(env, cfg), cfg, settings, {
        saved: url.searchParams.get("saved") === "1",
        webhooksSaved: url.searchParams.has("webhooks") ? url.searchParams.get("webhooks") : null,
        controller
      })
    );
  }
  if (url.pathname === "/settings") {
    if (!isPrivatePageAuthorized(request, baseCfg)) return privatePageUnauthorized(request);
    if (request.method !== "POST") return redirectResponse("/");
    try {
      await saveSettingsFromRequest(request, env, baseCfg);
      return redirectResponse("/?saved=1");
    } catch (error) {
      const status = error instanceof MonitorError ? error.statusCode : 500;
      return jsonResponse({ ok: false, error: error.message }, status);
    }
  }
  if (url.pathname === "/webhooks") {
    if (!isPrivatePageAuthorized(request, baseCfg)) return privatePageUnauthorized(request);
    if (request.method !== "POST") return redirectResponse("/");
    try {
      const saved = await saveWebhooksFromRequest(request, env, baseCfg);
      const count = Array.isArray(saved.discordWebhookUrls) ? saved.discordWebhookUrls.length : 0;
      return redirectResponse(`/?webhooks=${count}`);
    } catch (error) {
      const status = error instanceof MonitorError ? error.statusCode : 500;
      return jsonResponse({ ok: false, error: error.message }, status);
    }
  }
  if (url.pathname === "/health") {
    if (!isPrivatePageAuthorized(request, baseCfg)) return privatePageUnauthorized(request);
    const settings = await loadSettings(env, baseCfg);
    const cfg = applyRuntimeSettings(baseCfg, settings);
    const state = await loadState(env, cfg);
    return jsonResponse({
      ok: true,
      storage: "cloudflare-kv",
      seen: Object.keys(state.seen || {}).length,
      active: Object.keys(state.active || state.seen || {}).length,
      missing: Object.keys(state.missing || {}).length,
      universeSize: cfg.prospectiveCategoryIds.length,
      activeCategories: Array.isArray(state.activeCategoryIds) ? state.activeCategoryIds : [],
      knownCategories: Array.isArray(state.knownCategoryIds) ? state.knownCategoryIds : [],
      workersPlan: cfg.workersPlan,
      staging: {
        enabled: cfg.stagingLaneEnabled,
        baselinedAt: state.stagingBaselinedAt || null,
        hotWatch: state.hotWatch || {},
        enumerationEnabled: cfg.enumerationEnabled,
        styleRegistrySize: Object.keys(state.styleRegistry || {}).length,
        burstActive: Boolean(state.burstUntil && Date.parse(state.burstUntil) > Date.now()),
        burstUntil: state.burstUntil || null,
        sitemapIndexLastmod: state.sitemapIndexLastmod || null,
        sitemapCategories: Array.isArray(state.sitemapCategoryIds) ? state.sitemapCategoryIds : [],
        staticVersion: state.staticVersion || null
      },
      fastPoll: {
        enabled: cfg.fastPollEnabled,
        intervalSeconds: cfg.fastPollIntervalSeconds,
        fullSweepEveryTicks: cfg.fullSweepEveryTicks,
        fastCategoryShardSize: cfg.fastCategoryShardSize,
        scanAllOnFullSweep: cfg.scanAllCategoriesOnFullSweep,
        controller: await fastPollStatus(env)
      },
      settings: {
        webhookCount: (cfg.discordWebhookUrls || []).length,
        mainWebhook: maskWebhook(mainWebhookUrl(cfg) || ""),
        mainWebhookSource: cfg.discordMainWebhookUrl ? "configured" : "first-in-list",
        dashboardManagedWebhooks: Array.isArray(settings.discordWebhookUrls) ? settings.discordWebhookUrls.length : 0,
        checkMinIntervalSeconds: cfg.checkMinIntervalSeconds,
        categoryFetchConcurrency: cfg.categoryFetchConcurrency,
        maxAlertsPerRun: cfg.maxAlertsPerRun,
        maxCategoryIds: cfg.maxCategoryIds,
        maxStorefrontSubrequests: cfg.maxStorefrontSubrequests,
        extraCategoryIds: cfg.extraCategoryIds,
        prospectiveCategoryShardSize: cfg.prospectiveCategoryShardSize,
        extraProductUrls: cfg.extraProductUrls,
        maxDirectProductUrls: cfg.maxDirectProductUrls
      },
      lastRunAt: state.lastRunAt || null,
      lastResult: state.lastResult || null
    });
  }
  if (url.pathname === "/logs") {
    if (!isPrivatePageAuthorized(request, baseCfg)) return privatePageUnauthorized(request);
    const stub = monitorStub(env);
    if (!stub) return jsonResponse({ ok: false, error: "MONITOR Durable Object binding is not configured." }, 501);
    const limit = Math.min(500, Math.max(1, Number.parseInt(url.searchParams.get("limit") || "100", 10) || 100));
    const type = url.searchParams.get("type") === "alerts" ? "&type=alerts" : "";
    const doResponse = await stub.fetch(`https://monitor.internal/logs?limit=${limit}${type}`);
    return jsonResponse({ ok: true, ...(await doResponse.json()) });
  }
  if (url.pathname === "/selftest") {
    if (!isPrivatePageAuthorized(request, baseCfg)) return privatePageUnauthorized(request);
    const settings = await loadSettings(env, baseCfg);
    const cfg = applyRuntimeSettings(baseCfg, settings);
    const testProduct = {
      pid: "SELFTEST",
      name: "Monitor self-test",
      price: "0",
      category: "diagnostic",
      brand: "Chrome Hearts Monitor",
      url: BASE_URL,
      image: "",
      description: `Webhook delivery test at ${nowIso()}. If you can read this in Discord, alerts work.`,
      sizes: [],
      inStockSizeCount: 0
    };
    const payload = { username: "Chrome Hearts Monitor", content: "Monitor self-test", embeds: [buildProductEmbed(testProduct)] };
    const results = [];
    const testAll = ["1", "true", "yes"].includes(String(url.searchParams.get("all") || "").toLowerCase());
    const targets = testAll ? cfg.discordWebhookUrls || [] : [mainWebhookUrl(cfg)].filter(Boolean);
    for (const webhookUrl of targets) {
      let ok = false;
      try {
        ok = await postToWebhook(cfg, webhookUrl, payload);
      } catch (error) {
        ok = false;
      }
      results.push({ webhook: maskWebhook(webhookUrl), delivered: ok });
    }
    const deliveredCount = results.filter((entry) => entry.delivered).length;
    return jsonResponse(
      {
        ok: deliveredCount > 0,
        sent: deliveredCount,
        total: results.length,
        scope: testAll ? "all-webhooks" : "main-webhook-only",
        mainWebhook: maskWebhook(mainWebhookUrl(cfg) || ""),
        configuredWebhooks: (cfg.discordWebhookUrls || []).length,
        source: Array.isArray(settings.discordWebhookUrls) ? "dashboard" : "worker-secret",
        results,
        at: nowIso()
      },
      deliveredCount > 0 ? 200 : 502
    );
  }
  if (url.pathname === "/do") {
    if (!isPrivatePageAuthorized(request, baseCfg)) return privatePageUnauthorized(request);
    const stub = monitorStub(env);
    if (!stub) return jsonResponse({ ok: false, error: "MONITOR Durable Object binding is not configured." }, 501);
    const action = request.method === "POST" ? url.searchParams.get("action") || "ensure" : "status";
    const doResponse = await stub.fetch(`https://monitor.internal/${action}`, { method: request.method });
    return jsonResponse({ ok: true, action, controller: await doResponse.json() });
  }
  if (url.pathname === "/internal/scan-grids") {
    if (request.method !== "POST") return jsonResponse({ ok: false, error: "Method not allowed" }, 405);
    if (!isAuthorized(request, baseCfg)) return jsonResponse({ ok: false, error: "Unauthorized" }, 401);
    const cfg = applyPlanPreset(baseCfg);
    cfg.subrequestsUsed = 0;
    const body = await request.json().catch(() => ({}));
    cfg.bursting = Boolean(body?.bursting || body?.staging?.bursting);
    if (body && body.staging && typeof body.staging === "object") {
      const cleanPidList = (values, cap) =>
        (Array.isArray(values) ? values : [])
          .map((value) => String(value || "").trim())
          .filter(isPidLikeSegment)
          .slice(0, cap);
      const probeBudget = Number.parseInt(body.staging.probeBudget, 10);
      const staging = await stagingScan(cfg, {
        probePids: cleanPidList(body.staging.probePids, 128),
        knownPids: cleanPidList(body.staging.knownPids, 500),
        sitemapLastmod: String(body.staging.sitemapLastmod || ""),
        probeBudget: Number.isFinite(probeBudget) ? probeBudget : undefined
      });
      return jsonResponse({ ok: true, staging });
    }
    const cleanList = (values) =>
      (Array.isArray(values) ? values : [])
        .map((value) => String(value || "").trim().toLowerCase())
        .filter((value) => /^[a-z0-9_-]+$/.test(value))
        .slice(0, 40);
    const statusCgids = cleanList(body.statusCgids);
    if (statusCgids.length) {
      const statuses = {};
      await mapWithConcurrency(statusCgids, cfg.categoryFetchConcurrency, async (cgid) => {
        try {
          const response = await fetchWithTimeout(
            bustedUrl(`${BASE_URL}/${cgid}`, cfg, "tail"),
            { ...fetchOptions(cfg, "text/html,*/*;q=0.8"), redirect: "manual" },
            cfg.requestTimeoutMs,
            cfg
          );
          statuses[cgid] = response.status;
        } catch {
          statuses[cgid] = 0;
        }
      });
      return jsonResponse({ ok: true, statuses });
    }
    return jsonResponse(await scanGridsSlice(env, cfg, cleanList(body.cgids), cleanList(body.queries)));
  }
  if (url.pathname === "/api/cron" || url.pathname === "/run") {
    if (!["GET", "POST"].includes(request.method)) return jsonResponse({ ok: false, error: "Method not allowed" }, 405);
    if (!isAuthorized(request, baseCfg)) return jsonResponse({ ok: false, error: "Unauthorized" }, 401);
    try {
      const cfg = await getRuntimeConfig(env);
      const mode = url.searchParams.get("mode") === "fast" ? "fast" : "full";
      const result = await runMonitor(env, cfg, { mode });
      if (cfg.fastPollEnabled) await ensureFastPollLoop(env).catch(() => {});
      return jsonResponse(result);
    } catch (error) {
      const status = error instanceof MonitorError ? error.statusCode : 500;
      return jsonResponse({ ok: false, error: error.message, details: error.details || {} }, status);
    }
  }
  return jsonResponse({ ok: false, error: "Not found" }, 404);
}

function monitorStub(env) {
  if (!env.MONITOR || typeof env.MONITOR.idFromName !== "function") return null;
  return env.MONITOR.get(env.MONITOR.idFromName(DO_SINGLETON_NAME));
}

async function ensureFastPollLoop(env) {
  const stub = monitorStub(env);
  if (!stub) return { armed: false, reason: "no-durable-object-binding" };
  const response = await stub.fetch("https://monitor.internal/ensure", { method: "POST" });
  return response.json();
}

async function fastPollStatus(env) {
  const stub = monitorStub(env);
  if (!stub) return { armed: false, reason: "no-durable-object-binding" };
  try {
    const response = await stub.fetch("https://monitor.internal/status");
    return response.json();
  } catch (error) {
    return { armed: false, error: String(error?.message || error) };
  }
}

class MonitorController {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.mem = null;
    this.pendingLogs = [];
    this.expiredLogKeys = [];
  }

  async hydrate() {
    if (this.mem) return this.mem;
    const stored = await this.state.storage.get([
      "tick",
      "lastTickAt",
      "fastCursor",
      "prospectiveCursor",
      "fullCount",
      "burstUntil"
    ]);
    const tick = Number(stored.get("tick")) || 0;
    this.mem = {
      tick,
      lastTickAt: stored.get("lastTickAt") || null,
      fastCursor: Number(stored.get("fastCursor")) || 0,
      prospectiveCursor: Number(stored.get("prospectiveCursor")) || 0,
      fullCount: Number(stored.get("fullCount")) || 0,
      burstUntil: stored.get("burstUntil") || null,
      lastResult: null,
      lastFlushTick: tick,
      dirty: false
    };
    return this.mem;
  }

  async flush(force = false) {
    const mem = this.mem;
    if (!mem || !mem.dirty) return;
    if (!force && mem.tick - mem.lastFlushTick < DO_FLUSH_EVERY_TICKS) return;
    const batch = {
      tick: mem.tick,
      lastTickAt: mem.lastTickAt,
      fastCursor: mem.fastCursor,
      prospectiveCursor: mem.prospectiveCursor,
      fullCount: mem.fullCount,
      lastResult: mem.lastResult || null
    };
    // Buffered tick logs ride along in the same write.
    for (const [key, entry] of this.pendingLogs) batch[key] = entry;
    if (mem.burstUntil) batch.burstUntil = mem.burstUntil;
    await this.state.storage.put(batch);
    if (!mem.burstUntil) await this.state.storage.delete("burstUntil").catch(() => {});
    if (this.expiredLogKeys && this.expiredLogKeys.length) {
      await this.state.storage.delete(this.expiredLogKeys).catch(() => {});
      this.expiredLogKeys = [];
    }
    this.pendingLogs = [];
    mem.dirty = false;
    mem.lastFlushTick = mem.tick;
  }

  async ensure() {
    let cfg = null;
    try {
      cfg = await getRuntimeConfig(this.env);
    } catch {
      cfg = null;
    }
    if (!cfg || !cfg.fastPollEnabled) {
      await this.state.storage.deleteAlarm().catch(() => {});
      return { armed: false, reason: cfg ? "disabled" : "config-error" };
    }
    const now = Date.now();
    const graceMs = Math.max(60000, (cfg.fastPollIntervalSeconds || 12) * 4000);
    const existing = await this.state.storage.getAlarm();
    const lastTickMs = Date.parse((this.mem?.lastTickAt || (await this.state.storage.get("lastTickAt")) || "")) || 0;
    const missing = existing === null || existing === undefined;
    const overdue = !missing && existing < now - graceMs;
    const flatlined = lastTickMs > 0 && now - lastTickMs > graceMs;
    if (missing || overdue || flatlined) {
      await this.state.storage.setAlarm(now + 1000);
      return {
        armed: true,
        rearmed: true,
        reason: missing ? "no-alarm" : overdue ? "overdue-alarm" : "stale-heartbeat",
        staleForMs: lastTickMs ? now - lastTickMs : null
      };
    }
    return { armed: true, nextAlarm: new Date(existing).toISOString() };
  }

  async status() {
    const alarm = await this.state.storage.getAlarm();
    const logs = await this.state.storage.list({ prefix: "log:", limit: 1000 });
    const mem = await this.hydrate();
    const lastTickMs = Date.parse(mem.lastTickAt || "") || 0;
    return {
      tick: mem.tick,
      lastTickAt: mem.lastTickAt,
      staleForMs: lastTickMs ? Date.now() - lastTickMs : null,
      alive: lastTickMs ? Date.now() - lastTickMs < 120000 : false,
      nextAlarm: alarm ? new Date(alarm).toISOString() : null,
      alarmOverdueMs: alarm && alarm < Date.now() ? Date.now() - alarm : 0,
      fastCursor: mem.fastCursor,
      prospectiveCursor: mem.prospectiveCursor,
      fullSweeps: mem.fullCount,
      categoryStatusesTracked: Object.keys((await this.state.storage.get("catStatus")) || {}).length,
      logCount: logs.size + this.pendingLogs.length,
      unflushedTicks: this.pendingLogs.length,
      lastResult: mem.lastResult || (await this.state.storage.get("lastResult")) || null
    };
  }

  async logs(limit = 100) {
    const capped = Math.max(1, Math.min(500, limit));
    const listed = await this.state.storage.list({ prefix: "log:", reverse: true, limit: capped });
    const buffered = this.pendingLogs.map(([, entry]) => entry).reverse();
    const runs = [...buffered, ...listed.values()].slice(0, capped);
    if (runs.length) return { count: runs.length, runs };
    const legacy = (await this.state.storage.get("logs")) || [];
    return { count: legacy.length, runs: legacy.slice(-capped).reverse() };
  }

  async categoryStatusSweep(cfg) {
    let knownCategoryIds = [];
    try {
      const state = await loadState(this.env, cfg);
      knownCategoryIds = Array.isArray(state.knownCategoryIds) ? state.knownCategoryIds : [];
    } catch {
      knownCategoryIds = [];
    }
    const universe = uniqueValues([...cfg.prospectiveCategoryIds, ...cfg.extraCategoryIds, ...knownCategoryIds]);
    const current = await fetchCategoryStatuses(this.env, cfg, universe);
    if (!current) return;

    const previous = (await this.state.storage.get("catStatus")) || null;
    await this.state.storage.put("catStatus", current);
    if (!previous) {
      logRun(cfg, { at: nowIso(), mode: "catstatus-baseline", tracked: Object.keys(current).length });
      return;
    }

    const transitions = categoryStatusTransitions(previous, current).filter(interestingCategoryTransition);
    const discovered = discoveredCategories(previous, current);
    logRun(cfg, {
      at: nowIso(),
      mode: "catstatus",
      tracked: Object.keys(current).length,
      transitions: transitions.length,
      discovered: discovered.length,
      transitionCgids: transitions.map((transition) => transition.cgid)
    });
    if (!discovered.length) return;

    const lines = discovered.map(
      (entry) => `- [/${entry.cgid}](${BASE_URL}/${entry.cgid}) — new category (HTTP ${entry.status})`
    );
    const payload = {
      username: "Chrome Hearts Monitor",
      content: discovered.length === 1 ? "New Chrome Hearts category" : `${discovered.length} new Chrome Hearts categories`,
      embeds: [
        {
          author: { name: "Chrome Hearts Drop Monitor", url: BASE_URL },
          title: "New category found",
          description: truncate(lines.join("\n"), 4096),
          color: 0xffffff,
          footer: { text: "Chrome Hearts monitor - new category" },
          timestamp: nowIso()
        }
      ]
    };
    logRun(cfg, {
      at: nowIso(),
      mode: "catdiscovery",
      discovered: discovered.map((entry) => `${entry.cgid}:${entry.status}`)
    });
  }

  async record(entry, bufferSize) {
    const cap = Math.max(0, bufferSize || 0);
    if (!cap) return;
    const ordinal = Number.isFinite(entry?.tick) ? entry.tick : 0;
    this.pendingLogs.push([`log:${String(ordinal).padStart(10, "0")}`, entry]);
    const expired = ordinal - cap;
    if (expired > 0) this.expiredLogKeys.push(`log:${String(expired).padStart(10, "0")}`);
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/ensure" || url.pathname === "/start") return Response.json(await this.ensure());
    if (url.pathname === "/status") return Response.json(await this.status());
    if (url.pathname === "/logs") {
      if (url.searchParams.get("type") === "alerts") {
        const alerts = (await this.state.storage.get("alertLog")) || [];
        return Response.json({ count: alerts.length, alerts: alerts.slice().reverse() });
      }
      return Response.json(await this.logs(Number.parseInt(url.searchParams.get("limit") || "100", 10) || 100));
    }
    if (url.pathname === "/stop") {
      await this.state.storage.deleteAlarm().catch(() => {});
      return Response.json({ armed: false, stopped: true });
    }
    return new Response("Not found", { status: 404 });
  }

  async alarm() {
    const startedAt = Date.now();
    const provisionalSeconds = Math.max(5, Number.parseInt(this.env.FAST_POLL_INTERVAL_SECONDS, 10) || 12);
    await this.state.storage.setAlarm(startedAt + provisionalSeconds * 1000);

    try {
      const previousTickAt = this.mem?.lastTickAt ? Date.parse(this.mem.lastTickAt) : 0;
      console.log(
        "chmon.hb " +
          JSON.stringify({
            t: new Date(startedAt).toISOString(),
            tick: (this.mem?.tick ?? 0) + 1,
            gapMs: previousTickAt ? startedAt - previousTickAt : null
          })
      );
    } catch {
    }

    let cfg = null;
    try {
      cfg = await getRuntimeConfig(this.env);
    } catch {
      cfg = null;
    }
    if (!cfg) return;
    if (!cfg.fastPollEnabled) {
      await this.state.storage.deleteAlarm().catch(() => {});
      return;
    }

    const mem = await this.hydrate();
    const tick = mem.tick + 1;
    const everyTicks = Math.max(1, cfg.fullSweepEveryTicks);
    const mode = tick % everyTicks === 0 ? "full" : "fast";
    const burstUntilMs = Date.parse(mem.burstUntil || "") || 0;
    const bursting = cfg.burstWindowSeconds > 0 && burstUntilMs > startedAt;
    const effectiveIntervalSeconds = bursting ? Math.max(3, cfg.burstIntervalSeconds) : Math.max(5, cfg.fastPollIntervalSeconds);
    const intervalMs = effectiveIntervalSeconds * 1000;
    if (effectiveIntervalSeconds !== provisionalSeconds) {
      await this.state.storage.setAlarm(startedAt + intervalMs + Math.floor(Math.random() * 400));
    }
    const previousTickAt = Date.parse(mem.lastTickAt || "") || null;
    const tickGapMs = previousTickAt ? startedAt - previousTickAt : null;

    let result;
    const fullCount = mem.fullCount + (mode === "full" ? 1 : 0);
    try {
      const lightDiscovery = mode === "full" && fullCount % Math.max(1, cfg.discoveryEveryFullSweeps) !== 0;
      result = await runMonitor(this.env, cfg, {
        mode,
        skipLock: true,
        fastCursor: mem.fastCursor,
        prospectiveCursor: mem.prospectiveCursor,
        tickNumber: mem.tick,
        lightDiscovery
      });
      if (mode === "fast" && Number.isInteger(result?.nextFastCursor)) {
        mem.fastCursor = result.nextFastCursor;
      }
      if (mode === "full") {
        mem.fullCount = fullCount;
        if (Number.isInteger(result?.nextProspectiveCursor)) mem.prospectiveCursor = result.nextProspectiveCursor;
      }
    } catch (error) {
      result = { ok: false, mode, error: String(error?.message || error) };
    }

    if (result && Object.prototype.hasOwnProperty.call(result, "burstUntil")) {
      mem.burstUntil = result.burstUntil || null;
    }

    mem.tick = tick;
    mem.lastTickAt = nowIso();
    mem.lastResult = result;
    mem.dirty = true;

    if (cfg.categoryStatusEveryTicks > 0 && tick % cfg.categoryStatusEveryTicks === 0) {
      try {
        await this.categoryStatusSweep(cfg);
      } catch (error) {
        console.error("catstatus sweep failed:", error);
      }
    }
    // Ring buffer of recent ticks for the /logs endpoint.
    await this.record(
      {
        at: nowIso(),
        tick,
        mode: result.mode || mode,
        ms: Date.now() - startedAt,
        tickGapMs,
        ok: result.ok !== false,
        reason: result.reason || null,
        productCount: result.productCount ?? null,
        alerted: result.alerted ?? 0,
        newPids: result.newPids || [],
        activeCategories: result.sweep?.activeCategoryIds?.length ?? result.fast?.activeCategoryCount ?? null,
        failedCategories: result.sweep?.failedCategoryCount ?? result.fast?.fanoutFailed ?? 0,
        // >0 means the tick did not see the whole universe.
        unscanned: result.sweep ? 0 : result.fast?.unscanned ?? 0,
        staged: result.staging?.discoveries ?? 0,
        hotWatch: result.staging?.hotWatch ?? null,
        enumPool: result.staging?.enumPool ?? 0,
        burst: result.staging?.bursting ? 1 : 0,
        stagingMs: result.staging?.ms ?? 0,
        enrichMs: result.enrichMs || 0,
        sendMs: result.sendMs || 0,
        error: result.error || null
      },
      cfg.logBufferSize
    );

    if ((result.alerted || 0) > 0) {
      const alerts = (await this.state.storage.get("alertLog")) || [];
      alerts.push({
        at: nowIso(),
        tick,
        mode: result.mode || mode,
        pids: result.newPids || [],
        lanes: result.alertLanes || null,
        totalMs: Date.now() - startedAt,
        stagingMs: result.staging?.ms ?? 0,
        enrichMs: result.enrichMs || 0,
        sendMs: result.sendMs || 0,
        tickGapMs
      });
      await this.state.storage.put("alertLog", alerts.slice(-300));
      await this.flush(true);
    } else {
      await this.flush();
    }

    if (Date.now() > startedAt + intervalMs) {
      await this.state.storage.setAlarm(Date.now() + 100);
    }
  }
}

export default {
  fetch: handleFetch,
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(
      (async () => {
        let cfg = null;
        try {
          cfg = await getRuntimeConfig(env);
        } catch {
          cfg = null;
        }
        if (cfg && cfg.fastPollEnabled && monitorStub(env)) {
          const armed = await ensureFastPollLoop(env).catch((error) => {
            console.error(error);
            return { armed: false, reason: "ensure-failed" };
          });
          if (armed?.rearmed) console.log(`chmon watchdog recovered loop: ${JSON.stringify(armed)}`);
          if (!armed || armed.armed === false) {
            await runMonitor(env, cfg).catch((error) => console.error(error));
          }
        } else {
          await runMonitor(env, cfg || undefined).catch((error) => console.error(error));
        }
      })()
    );
  }
};

export { MonitorController };
export {
  parseProducts,
  parseProductStockPage,
  parseProductVariationJson,
  runMonitor,
  extractGridPids,
  fastFetchProducts,
  buildCatalogState,
  productUrlFromUrl,
  isPidLikeSegment,
  categoryStatusTransitions,
  interestingCategoryTransition,
  discoveredCategories,
  pidFromProductUrl,
  stagedNameFromUrl,
  parseHotWatchProbe,
  applyPlanPreset,
  runStagingLane,
  stagingScan,
  bustedUrl,
  parsePidParts,
  minePidCandidates,
  enumerationCandidates,
  updateStyleRegistry,
  boundStyleRegistry
};
