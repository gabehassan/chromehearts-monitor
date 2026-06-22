#!/usr/bin/env node
import * as cheerio from "cheerio";
import fs from "node:fs/promises";
import { pathToFileURL } from "node:url";

const BASE_URL = "https://www.chromehearts.com";
const DEFAULT_INTERVAL_SECONDS = 10;
const DEFAULT_TIMEOUT_MS = 12000;
const DEFAULT_USER_AGENT = "ChromeHeartsMonitor/1.0";

function absoluteUrl(url) {
  if (!url) return "";
  return new URL(url, BASE_URL).toString();
}

function firstSrcsetUrl(srcset) {
  return String(srcset || "")
    .split(",")
    .map((item) => item.trim().split(/\s+/)[0])
    .find(Boolean) || "";
}

function uniqueValues(values) {
  return [...new Set(values.filter(Boolean))];
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

function intOption(value, name, min) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < min) {
    throw new Error(`${name} must be an integer >= ${min}`);
  }
  return parsed;
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
  if (Array.isArray(value)) {
    return value.map(findAvailability).find(Boolean) || "";
  }

  const type = Array.isArray(value["@type"]) ? value["@type"].join(" ") : String(value["@type"] || "");
  if (type.toLowerCase().includes("product")) {
    const offers = Array.isArray(value.offers) ? value.offers : [value.offers];
    const availability = offers.map((offer) => offer?.availability).find(Boolean);
    if (availability) return String(availability);
  }

  return Object.values(value).map(findAvailability).find(Boolean) || "";
}

function schemaAvailability($) {
  return $("script[type='application/ld+json']")
    .toArray()
    .map((script) => findAvailability(parseJsonLd($(script).text())))
    .find(Boolean) || "";
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
  const value = `${masterPid} ${selectedVariantPid}`;
  return value.includes("OSZ") ? "OSZ" : "ONE_SIZE";
}

function parseProductStockPage(html, pageUrl = "") {
  const $ = cheerio.load(html);
  const metadata = $(".product-metadata").first();
  const productDetail = $(".product-detail[data-pid]").first();
  const images = collectProductImages($);
  const masterPid = String(metadata.attr("data-pid") || "").trim();
  const selectedVariantPid = String(productDetail.attr("data-pid") || metadata.attr("data-defaultvariant-id") || "").trim();
  const availability = schemaAvailability($);
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
    checkedAt: new Date().toISOString(),
    sourceUrl: pageUrl || "",
    masterPid,
    selectedVariantPid,
    name: String(metadata.attr("data-name") || $("h1").first().text() || "").trim(),
    price: String(metadata.attr("data-price") || "").trim(),
    brand: String(metadata.attr("data-brand") || "Chrome Hearts").trim(),
    category: String(metadata.attr("data-category") || "").trim(),
    image: images[0] || "",
    images,
    maxOrderQuantity,
    exactStockKnown: false,
    totalStock: null,
    inStockSizeCount,
    cappedOrderableTotal,
    sizes
  };
}

function stockDiff(previous, current) {
  if (!previous) {
    return {
      firstRun: true,
      inStockSizeCountChange: 0,
      cappedOrderableTotalChange: 0,
      sizeChanges: []
    };
  }

  const previousSizes = new Map((previous.sizes || []).map((size) => [size.code, size]));
  const currentSizes = new Map((current.sizes || []).map((size) => [size.code, size]));
  const codes = new Set([...previousSizes.keys(), ...currentSizes.keys()]);
  const sizeChanges = [];

  for (const code of [...codes].sort()) {
    const before = previousSizes.get(code);
    const after = currentSizes.get(code);
    if (!before && after) {
      sizeChanges.push({ code, label: after.label, from: "missing", to: after.inStock ? "in_stock" : "out_of_stock" });
    } else if (before && !after) {
      sizeChanges.push({ code, label: before.label, from: before.inStock ? "in_stock" : "out_of_stock", to: "missing" });
    } else if (before.inStock !== after.inStock) {
      sizeChanges.push({
        code,
        label: after.label,
        from: before.inStock ? "in_stock" : "out_of_stock",
        to: after.inStock ? "in_stock" : "out_of_stock"
      });
    }
  }

  const cappedBefore = Number.isFinite(previous.cappedOrderableTotal) ? previous.cappedOrderableTotal : 0;
  const cappedAfter = Number.isFinite(current.cappedOrderableTotal) ? current.cappedOrderableTotal : 0;

  return {
    firstRun: false,
    inStockSizeCountChange: current.inStockSizeCount - (previous.inStockSizeCount || 0),
    cappedOrderableTotalChange: cappedAfter - cappedBefore,
    sizeChanges
  };
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

async function fetchStockSnapshot(productUrl, options = {}) {
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  const userAgent = options.userAgent || DEFAULT_USER_AGENT;
  const response = await fetchWithTimeout(
    productUrl,
    {
      headers: {
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "user-agent": userAgent
      },
      cache: "no-store"
    },
    timeoutMs
  );

  if (!response.ok) {
    throw new Error(`Chrome Hearts returned HTTP ${response.status}`);
  }

  const snapshot = parseProductStockPage(await response.text(), productUrl);
  if (!snapshot.masterPid && snapshot.sizes.length === 0 && !snapshot.image) {
    throw new Error("Product detail page did not contain product metadata");
  }
  return snapshot;
}

async function readPreviousState(path) {
  if (!path) return null;
  try {
    return JSON.parse(await fs.readFile(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function writeState(path, snapshot) {
  if (!path) return;
  await fs.writeFile(path, `${JSON.stringify(snapshot, null, 2)}\n`);
}

function formatSnapshot(snapshot, diff) {
  const lines = [
    `[${snapshot.checkedAt}] ${snapshot.name || snapshot.masterPid || "Chrome Hearts product"}`,
    `in-stock sizes: ${snapshot.inStockSizeCount}/${snapshot.sizes.length}`,
    `exact stock: unknown`,
    `capped orderable total: ${snapshot.cappedOrderableTotal ?? "unknown"}`
  ];

  if (!diff.firstRun) {
    const signedSizes = diff.inStockSizeCountChange >= 0 ? `+${diff.inStockSizeCountChange}` : String(diff.inStockSizeCountChange);
    const signedCapped =
      diff.cappedOrderableTotalChange >= 0 ? `+${diff.cappedOrderableTotalChange}` : String(diff.cappedOrderableTotalChange);
    lines.push(`change: sizes ${signedSizes}, capped orderable ${signedCapped}`);
  } else {
    lines.push("change: first run");
  }

  lines.push(
    `sizes: ${snapshot.sizes
      .map((size) => `${size.label}:${size.inStock ? "in" : "out"}`)
      .join(" ")}`
  );

  if (diff.sizeChanges.length) {
    lines.push(`size changes: ${diff.sizeChanges.map((change) => `${change.label} ${change.from}->${change.to}`).join(", ")}`);
  }

  return lines.join("\n");
}

function parseArgs(argv) {
  const args = {
    intervalSeconds: DEFAULT_INTERVAL_SECONDS,
    once: false,
    json: false,
    stateFile: "",
    timeoutMs: DEFAULT_TIMEOUT_MS,
    productUrl: process.env.STOCK_URL || ""
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--once") args.once = true;
    else if (value === "--json") args.json = true;
    else if (value === "--interval") args.intervalSeconds = intOption(argv[++index], "--interval", 1);
    else if (value === "--state-file") args.stateFile = argv[++index] || "";
    else if (value === "--timeout-ms") args.timeoutMs = intOption(argv[++index], "--timeout-ms", 1000);
    else if (value === "--help" || value === "-h") args.help = true;
    else if (!args.productUrl) args.productUrl = value;
    else throw new Error(`Unexpected argument: ${value}`);
  }

  return args;
}

function usage() {
  return `Usage: node scripts/stock-watch.js <product-url> [--once] [--interval 10] [--json] [--state-file path]\n\nExamples:\n  npm run stock:once -- "https://www.chromehearts.com/hoodie/black-hoodie/152701BLKXXX04K.html?dwvar_152701BLKXXX04K_size=XSM"\n  npm run stock:watch -- "https://www.chromehearts.com/hoodie/black-hoodie/152701BLKXXX04K.html?dwvar_152701BLKXXX04K_size=XSM" --interval 10`;
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help || !args.productUrl) {
    console.log(usage());
    return args.help ? 0 : 2;
  }

  let previous = await readPreviousState(args.stateFile);

  while (true) {
    const snapshot = await fetchStockSnapshot(args.productUrl, { timeoutMs: args.timeoutMs });
    const diff = stockDiff(previous, snapshot);

    if (args.json) {
      console.log(JSON.stringify({ snapshot, diff }, null, 2));
    } else {
      console.log(formatSnapshot(snapshot, diff));
      console.log("");
    }

    await writeState(args.stateFile, snapshot);
    previous = snapshot;

    if (args.once) break;
    await sleep(args.intervalSeconds * 1000);
  }

  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      console.error(error.message);
      process.exitCode = 1;
    }
  );
}

export { fetchStockSnapshot, formatSnapshot, parseArgs, parseProductStockPage, stockDiff };
