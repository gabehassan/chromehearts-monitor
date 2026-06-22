import assert from "node:assert/strict";
import test from "node:test";
import { fetchStockSnapshot, parseProductStockPage, stockDiff } from "../scripts/stock-watch.js";

function stockHtml() {
  return `
    <div class="container product-detail" data-pid="152701BLKXSM04K">
      <span class="product-metadata d-none"
        data-pid="152701BLKXXX04K"
        data-name="BLACK HOODIE"
        data-price="750.00"
        data-brand="Chrome Hearts"
        data-category="Hoodie"
        data-defaultvariant-id="152701BLKXSM04K"></span>
      <picture>
        <source srcset="/dw/image/v2/BFBV_PRD/example-large.png?sw=1600 1600w">
        <img data-large-img="/dw/image/v2/BFBV_PRD/example-large.png?sw=1600" src="/dw/image/v2/BFBV_PRD/example.png?sw=540" />
      </picture>

      <select class="quantity-select">
        <option value="1">1</option>
        <option value="10">10</option>
      </select>

      <button class="swatch-attribute size-attribute"
        data-url="https://www.chromehearts.com/on/demandware.store/Sites-ChromeHearts-Site/en_US/Product-Variation?dwvar_152701BLKXXX04K_size=&amp;pid=152701BLKXXX04K&amp;quantity=1">
        <span data-attr-value="XSM" class="size-value swatch-box selected selectable">XS</span>
      </button>
      <button class="swatch-attribute size-attribute"
        data-url="https://www.chromehearts.com/on/demandware.store/Sites-ChromeHearts-Site/en_US/Product-Variation?dwvar_152701BLKXXX04K_size=LRG&amp;pid=152701BLKXXX04K&amp;quantity=1">
        <span data-attr-value="LRG" class="size-value swatch-box unselectable">L</span>
      </button>
      <button class="swatch-attribute size-attribute"
        data-url="/on/demandware.store/Sites-ChromeHearts-Site/en_US/Product-Variation?dwvar_152701BLKXXX04K_size=2XL&amp;pid=152701BLKXXX04K&amp;quantity=1">
        <span data-attr-value="2XL" class="size-value swatch-box selectable">XXL</span>
      </button>
    </div>
  `;
}

test("parseProductStockPage extracts size availability and capped totals", () => {
  const snapshot = parseProductStockPage(stockHtml(), "https://www.chromehearts.com/example.html");

  assert.equal(snapshot.masterPid, "152701BLKXXX04K");
  assert.equal(snapshot.selectedVariantPid, "152701BLKXSM04K");
  assert.equal(snapshot.name, "BLACK HOODIE");
  assert.equal(snapshot.brand, "Chrome Hearts");
  assert.equal(snapshot.category, "Hoodie");
  assert.equal(snapshot.image, "https://www.chromehearts.com/dw/image/v2/BFBV_PRD/example-large.png?sw=1600");
  assert.ok(snapshot.images.includes("https://www.chromehearts.com/dw/image/v2/BFBV_PRD/example.png?sw=540"));
  assert.equal(snapshot.maxOrderQuantity, 10);
  assert.equal(snapshot.exactStockKnown, false);
  assert.equal(snapshot.totalStock, null);
  assert.equal(snapshot.inStockSizeCount, 2);
  assert.equal(snapshot.cappedOrderableTotal, 20);
  assert.deepEqual(
    snapshot.sizes.map((size) => [size.code, size.label, size.inStock]),
    [
      ["XSM", "XS", true],
      ["LRG", "L", false],
      ["2XL", "XXL", true]
    ]
  );
  assert.equal(new URL(snapshot.sizes[0].variationUrl).searchParams.get("dwvar_152701BLKXXX04K_size"), "XSM");
});

test("stockDiff reports availability and total changes", () => {
  const previous = {
    inStockSizeCount: 1,
    cappedOrderableTotal: 10,
    sizes: [
      { code: "XSM", label: "XS", inStock: true },
      { code: "LRG", label: "L", inStock: false }
    ]
  };
  const current = {
    inStockSizeCount: 2,
    cappedOrderableTotal: 20,
    sizes: [
      { code: "XSM", label: "XS", inStock: false },
      { code: "LRG", label: "L", inStock: true },
      { code: "2XL", label: "XXL", inStock: true }
    ]
  };

  const diff = stockDiff(previous, current);

  assert.equal(diff.firstRun, false);
  assert.equal(diff.inStockSizeCountChange, 1);
  assert.equal(diff.cappedOrderableTotalChange, 10);
  assert.deepEqual(diff.sizeChanges, [
    { code: "2XL", label: "XXL", from: "missing", to: "in_stock" },
    { code: "LRG", label: "L", from: "out_of_stock", to: "in_stock" },
    { code: "XSM", label: "XS", from: "in_stock", to: "out_of_stock" }
  ]);
});

test("fetchStockSnapshot rejects pages without product metadata", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("<html><body>home</body></html>", { status: 200 });

  try {
    await assert.rejects(
      () => fetchStockSnapshot("https://www.chromehearts.com/stale-product.html", { timeoutMs: 1000 }),
      /did not contain product metadata/
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
