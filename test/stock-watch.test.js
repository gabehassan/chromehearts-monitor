import assert from "node:assert/strict";
import test from "node:test";
import { fetchStockSnapshot, parseProductStockPage, parseProductVariationJson, stockDiff } from "../scripts/stock-watch.js";

function stockHtml() {
  return `
    <meta name="description" content="The Official Website of Chrome Hearts Fine Jewelry, Accessories, Shoes, Fragrance &amp; Home Goods Made in the USA." />
    <script type="application/ld+json">
      {
        "@context": "http://schema.org/",
        "@type": "Product",
        "name": "BLACK HOODIE",
        "description": null,
        "offers": {
          "@type": "Offer",
          "availability": "http://schema.org/InStock"
        }
      }
    </script>
    <div class="container product-detail" data-pid="152701BLKXSM04K">
      <span class="product-metadata d-none"
        data-pid="152701BLKXXX04K"
        data-name="BLACK HOODIE"
        data-price="750.00"
        data-brand="Chrome Hearts"
        data-category="Hoodie"
        data-defaultvariant-id="152701BLKXSM04K"
        data-defaultvariant-url="/on/demandware.store/Sites-ChromeHearts-Site/en_US/Product-Variation?dwvar_152701BLKXXX04K_size=XSM&amp;pid=152701BLKXXX04K&amp;quantity=1"></span>
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
    <div class="collapse pdp-collapse show" id="collapseMenu">
      <div class="row details">
        <div class="col-sm-12 value content" id="collapsible-details-1">
          <ul>
            <li>BLACK COTTON FLEECE HOODIE WITH CHROME HEARTS SLEEVE PRINT</li>
            <li>MADE IN USA</li>
          </ul>
        </div>
      </div>
    </div>
  `;
}

function oneSizeHtml() {
  return `
    <script type="application/ld+json">
      {
        "@context": "http://schema.org/",
        "@type": "Product",
        "name": "TRUCKER HAT",
        "description": "Mesh trucker hat with Chrome Hearts front patch.",
        "sku": "196451DAYOSZ262",
        "offers": {
          "@type": "Offer",
          "price": "395.00",
          "availability": "http://schema.org/InStock"
        }
      }
    </script>
    <div class="container product-detail" data-pid="196451DAYOSZ262">
      <span class="product-metadata d-none"
        data-pid="196451DAYOSZ262"
        data-name="TRUCKER HAT"
        data-price="395.00"
        data-brand="CHROME HEARTS"
        data-category="Hat"></span>
      <img data-large-img="/dw/image/v2/BFBV_PRD/hat.png?sw=1600" src="/dw/image/v2/BFBV_PRD/hat.png?sw=540" />
      <input id="qty-select-input" class="quantity-select" min="1" max="10" value="1" name="quantity" type="number" />
      <button class="add-to-cart" data-pid="196451DAYOSZ262">Add to cart</button>
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
  assert.equal(snapshot.description, "BLACK COTTON FLEECE HOODIE WITH CHROME HEARTS SLEEVE PRINT\nMADE IN USA");
  assert.equal(snapshot.image, "https://www.chromehearts.com/dw/image/v2/BFBV_PRD/example-large.png?sw=1600");
  assert.ok(snapshot.images.includes("https://www.chromehearts.com/dw/image/v2/BFBV_PRD/example.png?sw=540"));
  assert.equal(snapshot.maxOrderQuantity, 10);
  assert.equal(snapshot.exactStockKnown, false);
  assert.equal(snapshot.totalStock, null);
  assert.equal(snapshot.inStockSizeCount, 2);
  assert.equal(snapshot.cappedOrderableTotal, 20);
  assert.equal(
    snapshot.variationUrl,
    "https://www.chromehearts.com/on/demandware.store/Sites-ChromeHearts-Site/en_US/Product-Variation?dwvar_152701BLKXXX04K_size=XSM&pid=152701BLKXXX04K&quantity=1"
  );
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

test("parseProductVariationJson extracts Demandware selectable stock signal", () => {
  const signal = parseProductVariationJson(
    {
      product: {
        id: "165064BLKLRG140",
        masterProductId: "165064XXXXXX140",
        selectedQuantity: 1,
        maxOrderQuantity: 10,
        available: true,
        readyToOrder: true,
        availability: { messages: ["In Stock"], inStockDate: null },
        variationAttributes: [
          {
            id: "color",
            values: [
              { id: "BLK", displayValue: "Black", selected: true, selectable: true },
              { id: "PNB", displayValue: "Baby Pink", selected: false, selectable: true }
            ]
          },
          {
            id: "size",
            values: [
              { id: "XSM", displayValue: "XS", selected: false, selectable: false },
              { id: "SML", displayValue: "S", selected: false, selectable: false },
              { id: "MED", displayValue: "M", selected: false, selectable: false },
              { id: "LRG", displayValue: "L", selected: true, selectable: true },
              { id: "1XL", displayValue: "XL", selected: false, selectable: true }
            ]
          }
        ]
      }
    },
    "https://www.chromehearts.com/on/demandware.store/Sites-ChromeHearts-Site/en_US/Product-Variation?dwvar_165064XXXXXX140_color=BLK&dwvar_165064XXXXXX140_size=LRG&pid=165064XXXXXX140&quantity=1"
  );

  assert.equal(signal.stockSource, "Product-Variation JSON");
  assert.equal(signal.masterPid, "165064XXXXXX140");
  assert.equal(signal.selectedVariantPid, "165064BLKLRG140");
  assert.equal(signal.productAvailable, true);
  assert.equal(signal.readyToOrder, true);
  assert.equal(signal.maxOrderQuantity, 10);
  assert.equal(signal.inStockSizeCount, 2);
  assert.equal(signal.cappedOrderableTotal, 20);
  assert.deepEqual(
    signal.sizes.map((size) => [size.code, size.label, size.inStock]),
    [
      ["XSM", "XS", false],
      ["SML", "S", false],
      ["MED", "M", false],
      ["LRG", "L", true],
      ["1XL", "XL", true]
    ]
  );
});

test("fetchStockSnapshot overlays Product-Variation JSON over PDP HTML", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    if (String(url).includes("Product-Variation")) {
      return new Response(
        JSON.stringify({
          product: {
            id: "152701BLKXSM04K",
            masterProductId: "152701BLKXXX04K",
            maxOrderQuantity: 10,
            available: true,
            readyToOrder: true,
            availability: { messages: ["In Stock"] },
            variationAttributes: [
              {
                id: "size",
                values: [
                  { id: "XSM", displayValue: "XS", selected: true, selectable: true },
                  { id: "LRG", displayValue: "L", selected: false, selectable: false }
                ]
              }
            ]
          }
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
    return new Response(stockHtml(), { status: 200, headers: { "content-type": "text/html" } });
  };

  try {
    const snapshot = await fetchStockSnapshot("https://www.chromehearts.com/hoodie/black-hoodie/152701BLKXXX04K.html", {
      timeoutMs: 1000
    });

    assert.equal(calls.length, 2);
    assert.equal(snapshot.stockSource, "Product-Variation JSON");
    assert.equal(snapshot.selectedVariantPid, "152701BLKXSM04K");
    assert.equal(snapshot.inStockSizeCount, 1);
    assert.equal(snapshot.cappedOrderableTotal, 10);
    assert.deepEqual(
      snapshot.sizes.map((size) => [size.code, size.label, size.inStock]),
      [
        ["XSM", "XS", true],
        ["LRG", "L", false]
      ]
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchStockSnapshot can probe exact stock from high-quantity SFCC messages", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    const currentUrl = new URL(String(url));
    calls.push(currentUrl.toString());
    if (currentUrl.pathname.includes("Product-Variation") && currentUrl.searchParams.get("quantity") === "999") {
      return new Response(
        JSON.stringify({
          product: {
            id: "152701BLKXSM04K",
            availability: {
              messages: ["7 Item(s) in Stock", "The remaining items are currently not available. Please adjust the quantity"]
            }
          }
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
    if (currentUrl.pathname.includes("Product-Variation")) {
      return new Response(
        JSON.stringify({
          product: {
            id: "152701BLKXSM04K",
            masterProductId: "152701BLKXXX04K",
            maxOrderQuantity: 10,
            available: true,
            readyToOrder: true,
            availability: { messages: ["In Stock"] },
            variationAttributes: [
              {
                id: "size",
                values: [
                  { id: "XSM", displayValue: "XS", selected: true, selectable: true },
                  { id: "LRG", displayValue: "L", selected: false, selectable: false }
                ]
              }
            ]
          }
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
    return new Response(stockHtml(), { status: 200, headers: { "content-type": "text/html" } });
  };

  try {
    const snapshot = await fetchStockSnapshot("https://www.chromehearts.com/hoodie/black-hoodie/152701BLKXXX04K.html", {
      timeoutMs: 1000,
      probeExactStock: true,
      exactStockProbeQuantity: 999
    });

    assert.equal(calls.length, 3);
    assert.equal(snapshot.exactStockKnown, true);
    assert.equal(snapshot.totalStock, 7);
    assert.equal(snapshot.stockSource, "Product-Variation JSON + exact quantity probe");
    assert.deepEqual(
      snapshot.sizes.map((size) => [size.code, size.label, size.inStock, size.exactStock]),
      [
        ["XSM", "XS", true, 7],
        ["LRG", "L", false, 0]
      ]
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("parseProductStockPage creates an OS stock row for one-size products", () => {
  const snapshot = parseProductStockPage(oneSizeHtml(), "https://www.chromehearts.com/hat/trucker-hat/196451DAYOSZ262.html");

  assert.equal(snapshot.masterPid, "196451DAYOSZ262");
  assert.equal(snapshot.name, "TRUCKER HAT");
  assert.equal(snapshot.description, "Mesh trucker hat with Chrome Hearts front patch.");
  assert.equal(snapshot.maxOrderQuantity, 10);
  assert.equal(snapshot.inStockSizeCount, 1);
  assert.equal(snapshot.cappedOrderableTotal, 10);
  assert.deepEqual(snapshot.sizes, [
    {
      code: "OSZ",
      label: "OS",
      selected: true,
      inStock: true,
      selectable: true,
      variationUrl: "https://www.chromehearts.com/hat/trucker-hat/196451DAYOSZ262.html"
    }
  ]);
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
