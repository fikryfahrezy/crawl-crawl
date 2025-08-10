import http from "node:http";
import OpenAI from "openai";
import { firefox } from "playwright";

/**
 * @typedef {Object} Product
 * @property {string} name
 * @property {number} price
 * @property {string} description
 */

/**
 * @typedef {Object} ExtractProductReturn
 * @property {Product[]} products
 *
 * @param {OpenAI} aiSDK
 * @param {string} htmlContent
 * @returns {Promise<ExtractProductReturn>}
 */
async function extractProduct(aiSDK, htmlContent) {
  const productSchema = {
    name: "product_schema",
    schema: {
      type: "object",
      properties: {
        products: {
          type: "array",
          description: "A list of product objects.",
          items: {
            type: "object",
            properties: {
              name: {
                type: "string",
                description: "The product name.",
              },
              price: {
                type: "string",
                description: "The product's price.",
              },
              description: {
                type: "string",
                description: "The product's description.",
              },
            },
          },
        },
      },
    },
  };
  const prompt = `
    You are an expert data extraction bot. Your task is to extract structured data from the provided HTML content.
    Extract information about each product listed on the page. When the information not available just fill it with dash (-)
    The data should strictly follow this JSON schema:
    ${JSON.stringify(productSchema, null, 2)}
    
    The output must be a JSON array of objects, where each object represents a product.
    
    HTML content:
    ${htmlContent}
    `;

  const completion = await aiSDK.chat.completions.create({
    model: "deepseek-chat",
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
  });

  const jsonResponse = completion.choices[0].message.content;
  const extractedData = JSON.parse(jsonResponse);
  return extractedData;
}

/**
 * @param {import('playwright').Page} page
 * @param {string} link
 */
async function awaitSplashUI(page, link) {
  const pageUrl = new URL(link);
  await page.waitForURL(`**\/${pageUrl.pathname.substring(1)}**`);
}

/**
 * @param {import('playwright').Page} page
 * @param {string} url
 * @returns {Promise<string[]>}
 */
async function getPaginationLinks(page, url) {
  const links = await page.$$eval('nav[role="navigation"] ol a', (anchors) => {
    return anchors.map((a) => {
      return a.href;
    });
  });

  return links
    .filter((link) => {
      // Make sure to return the link to in the same website
      return new URL(link).hostname === new URL(url).hostname;
    })
    .map((link) => {
      // Move the pagination always in the end of query string
      const url = new URL(link);
      const params = url.searchParams;
      const pgnValue = params.get("_pgn");
      params.delete("_pgn");
      params.append("_pgn", pgnValue);
      return url.toString();
    });
}

/**
 * @typedef {Object} ProductItem
 * @property {string} productId
 * @property {string} productItemHtml
 * @property {string} productDetailHtml
 * @property {string} detailLink
 */

/**
 * @param {import('playwright').Page} page
 * @returns {Promise<ProductItem[]>}
 */
async function getProductItems(page) {
  const result = await page.$$eval("#srp-river-results li[id]", (nodes) => {
    return nodes.map((node) => {
      const detailLink = node.querySelector("a").href;
      const productId = new URL(detailLink).pathname.replace("/itm/", "");
      /**
       * @type {ProductItem}
       */
      const productItem = {
        productId,
        detailLink,
        productItemHtml: node.outerHTML,
        productDetailHtml: "",
      };
      return productItem;
    });
  });
  return result;
}

/**
 * @param {import('playwright').Page} page
 * @returns {Promise<string[]>}
 */
async function getProductDescription(page) {
  const result = await page.$$eval(
    "div[data-testid=d-tabs] div[data-testid=d-vi-evo-region]",
    (nodes) => {
      return nodes.map((node) => {
        return node.outerHTML;
      });
    }
  );
  return result;
}

/**
 * @typedef {Object} CrawlQuery
 * @property {number} search
 * @property {number} fromPage
 * @property {number} toPage
 *
 * @param {OpenAI} aiSDK
 * @param {import('playwright').Page} page
 * @param {string} startUrl
 * @param {CrawlQuery} query
 * @returns {Promise<Product[]>}
 */
async function crawlAndExtract(aiSDK, page, startUrl, query) {
  const { search, fromPage, toPage } = query;

  if (!search) {
    return [];
  }

  const visitedUrls = new Set();
  const toVisitUrls = [`${startUrl}&_nkw=nike&_pgn=${fromPage}`];
  /**
   * @type {Product[]}
   */
  const allProductData = [];

  // Batch per 5 items to prevenet error max token limit in the LLM
  /**
   * @type {ProductItem[][]}
   */
  const bathces = [];
  const itemsPerBatch = 5;

  // Get all items
  while (toVisitUrls.length > 0 && visitedUrls.size < toPage) {
    const currentUrl = toVisitUrls.shift();
    if (visitedUrls.has(currentUrl)) {
      continue;
    }
    visitedUrls.add(currentUrl);

    try {
      console.log("Crawling product list at:");
      console.log(currentUrl);
      await page.goto(currentUrl, { waitUntil: "domcontentloaded" });
      await awaitSplashUI(page, currentUrl);
      console.log("Successfully crawling product list\n");

      console.log("Get pagination links");
      const paginationLinks = await getPaginationLinks(page, currentUrl);
      for (const paginationLink of paginationLinks) {
        if (!visitedUrls.has(paginationLink)) {
          toVisitUrls.push(paginationLink);
        }
      }
      console.log("Successfully get pagination links\n");

      console.log("Extracting product list content");
      const productItems = await getProductItems(page);
      console.log(`Product items count: ${productItems.length}`);
      for (let i = 0; i < productItems.length; i += itemsPerBatch) {
        bathces.push(productItems.slice(i, i + itemsPerBatch));
      }
      console.log("Successfully product list content\n");
    } catch (error) {
      console.error(
        `Error when visit product list ${currentUrl}: ${String(error)}`
      );
      continue;
    }
  }

  for (let i = 0; i < bathces.length; i++) {
    const batch = bathces[i];
    if (!batch || batch.length === 0) {
      continue;
    }

    for (let j = 0; j < batch.length; j++) {
      const batchItem = batch[j];
      if (!batchItem) {
        continue;
      }

      try {
        console.log("Crawling detail page at:");
        console.log(batchItem.productId);
        await page.goto(batchItem.detailLink, {
          waitUntil: "domcontentloaded",
        });
        await awaitSplashUI(page, batchItem.detailLink);
        console.log("Successfully crawling detail page\n");

        console.log("Extracting data from detail page");
        batch[j].productDetailHtml = await getProductDescription(page);
        console.log("Successfully extracting data from detail page\n");
      } catch (error) {
        console.error(
          `Error when get product detail ${batchItem.productId}: ${String(
            error
          )}`
        );
        continue;
      }
    }
  }

  /**
   * @type {Promise<ExtractProductReturn>[]}
   */
  const extractProductPromises = [];
  for (let i = 0; i < bathces.length; i++) {
    const batch = bathces[i];
    if (!batch || batch.length === 0) {
      continue;
    }
    const productIds = batch.map((batchItem) => {
      return batchItem.productId;
    });
    const productBatchItems = batch.map((batchItem) => {
      return `
        <div class="product_${batchItem.productId}">
          <ul class="product_item">
            ${batchItem.productItemHtml}
          <ul>
          <div class="product_item_detail">
            ${batchItem.productDetailHtml}
          </div>
        </div>`;
    });
    const productBatchContent = `
    <div class="product_list">
      ${productBatchItems.join("")}
    <div>`;

    console.log(`Extracting data from product id: ${productIds.join(", ")}`);
    const extractProductPromise = extractProduct(aiSDK, productBatchContent);
    extractProductPromises.push(extractProductPromise);
  }

  const extractedResults = await Promise.allSettled(extractProductPromises);
  for (const extractedResult of extractedResults) {
    if (extractedResult.status === "rejected") {
      continue;
    }

    if (
      typeof extractedResult.value === "object" &&
      "products" in extractedResult.value &&
      Array.isArray(extractedResult.value.products)
    ) {
      allProductData.push(...extractedResult.value.products);
    }
  }

  console.log(`Data successfully extracted.`);
  console.log(JSON.stringify(allProductData));
  return allProductData;
}

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const DEEPSEEK_BASE_URL = "https://api.deepseek.com/v1";
const HOSTNAME = "0.0.0.0";
const PORT = 3000;

const TARGET_BASE_URL =
  "https://www.ebay.com/sch/i.html?_from=R40&_sacat=0&rt=nc&_ipg=60";

const ai = new OpenAI({
  apiKey: DEEPSEEK_API_KEY,
  baseURL: DEEPSEEK_BASE_URL,
});

const browser = await firefox.launch({ headless: true });
const browserContext = await browser.newContext({
  user_agent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  viewport: { width: 1920, height: 1080 },
});
const page = await browserContext.newPage();

function simpleRateLimitMiddleware() {
  const requestCounts = new Map();
  const windowMs = 60 * 1000; // 1 minute window
  const maxRequests = 5; // Max 5 requests per minute per IP

  /**
   * @param {import("http").IncomingMessage} req
   * @param {import("http").ServerResponse<import("http").IncomingMessage>} res
   * @param {() => Promise<void>} next
   */
  const middleware = async (req, res, next) => {
    const ip = req.socket.remoteAddress;
    const count = requestCounts.get(ip) || 0;

    if (count >= maxRequests) {
      res.writeHead(429, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          success: false,
          message:
            "Too many requests from this IP, please try again after a minute",
        })
      );
      return;
    }

    requestCounts.set(ip, count + 1);
    if (count === 0) {
      setTimeout(() => {
        requestCounts.delete(ip);
        console.log(`Rate limit for IP ${ip} has been reset.`);
      }, windowMs);
    }

    await next();
  };

  return middleware;
}

const rateLimitMiddleware = simpleRateLimitMiddleware();
const server = http.createServer(async (req, res) => {
  const next = async () => {
    const url = new URL(`http://${req.headers.host}${req.url}`);
    const { pathname } = url;

    try {
      if (pathname === "/scrape") {
        const search = url.searchParams.get("search") || "";
        const fromPage = Number(url.searchParams.get("from_page")) || 1;
        const toPage = Number(url.searchParams.get("to_page")) || fromPage;
        const scrappedData = await crawlAndExtract(ai, page, TARGET_BASE_URL, {
          search,
          fromPage,
          toPage,
        });

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(scrappedData));
      } else if (pathname === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true }));
      } else {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ message: "Not Found." }));
      }
    } catch (error) {
      console.error(error);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify(error));
    }
  };

  rateLimitMiddleware(req, res, next);
});

server.timeout = 0;
server.keepAliveTimeout = 0;
server.headersTimeout = 0;
server.requestTimeout = 0;

server.listen(PORT, HOSTNAME, () => {
  console.log(`Server running at http://${HOSTNAME}:${PORT}`);
});

async function gracefulShutdown() {
  console.log("Preparing to shutdown...");
  await browser.close();
  console.log("Shutdown successfully.");
  process.exit(0);
}

process.on("SIGTERM", gracefulShutdown);
process.on("SIGINT", gracefulShutdown);
