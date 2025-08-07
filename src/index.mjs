import http from "node:http";
import OpenAI from "openai";
import { chromium } from "playwright";

/**
 * @typedef {Object} Product
 * @property {string} title
 * @property {number} price
 * @property {boolean} rating
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
              title: {
                type: "string",
                description: "The product title.",
              },
              price: {
                type: "string",
                description: "The product's price.",
              },
              rating: {
                type: "integer",
                description: "The product's rating.",
              },
            },
          },
        },
      },
    },
  };
  const prompt = `
    You are an expert data extraction bot. Your task is to extract structured data from the provided HTML content.
    Extract information about each product listed on the page. The data should strictly follow this JSON schema:
    ${JSON.stringify(productSchema, null, 2)}
    
    The output must be a JSON array of objects, where each object represents a product.
    
    HTML content:
    ${htmlContent}
    `;

  const completion = await aiSDK.chat.completions.create({
    model: DEEPSEEK_MODEL,
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
  });

  const jsonResponse = completion.choices[0].message.content;
  const extractedData = JSON.parse(jsonResponse);
  return extractedData;
}

/**
 * @param {string} url
 * @param {import('playwright').Page} page
 * @returns {Promise<string[]>}
 */
async function getPaginationLinks(url, page) {
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
 * @param {import('playwright').Page} page
 * @returns {Promise<string[]>}
 */
async function getResultItems(page) {
  const result = await page.$$eval("#srp-river-results li", (nodes) => {
    return nodes.map((node) => {
      return node.outerHTML;
    });
  });
  return result;
}

/**
 * @param {OpenAI} aiSDK
 * @param {import('playwright').Page} page
 * @param {number} maxPage
 * @returns {Promise<Product[]>}
 */
async function crawlAndExtract(aiSDK, page, maxPage) {
  const startUrl = TARGET_BASE_URL;
  const visitedUrls = new Set();
  const toVisitUrls = [startUrl];
  const allProductData = [];

  // Batch per 25 items to prevenet error max token limit in the LLM
  /**
   * @type {string[]}
   */
  const bathces = [];
  const itemsPerBatch = 25;

  // Get all items
  while (toVisitUrls.length > 0 && visitedUrls.size < maxPage) {
    const currentUrl = toVisitUrls.shift();
    if (visitedUrls.has(currentUrl)) {
      continue;
    }

    console.log(`Crawling: ${currentUrl}`);
    visitedUrls.add(currentUrl);

    await page.goto(currentUrl, { waitUntil: "domcontentloaded" });
    const paginationLinks = await getPaginationLinks(currentUrl, page);
    for (const paginationLink of paginationLinks) {
      if (!visitedUrls.has(paginationLink)) {
        toVisitUrls.push(paginationLink);
      }
    }

    const resultItems = await getResultItems(page);
    for (let i = 0; i < resultItems.length; i += itemsPerBatch) {
      bathces.push(resultItems.slice(i, itemsPerBatch));
    }
  }

  while (bathces.length > 0) {
    const batch = bathces.shift();
  }

  console.log(batched);

  // console.log(`Extracting data from: ${currentUrl}`);
  // const extractedData = await extractProduct(aiSDK, pageContent);

  // if (
  //   typeof extractedData === "object" &&
  //   "products" in extractedData &&
  //   Array.isArray(extractedData.products)
  // ) {
  //   allProductData.push(...extractedData.products);
  // }

  console.log(`${currentUrl}: Data successfully extracted.`);
  return allProductData;
}

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const DEEPSEEK_BASE_URL = "https://api.deepseek.com/v1";
const DEEPSEEK_MODEL = "deepseek-chat";
const HOSTNAME = "0.0.0.0";
const PORT = 3000;

const TARGET_BASE_URL =
  "https://www.ebay.com/sch/i.html?_from=R40&_nkw=nike&_sacat=0&rt=nc&_ipg=240&_pgn=1";

const ai = new OpenAI({
  apiKey: DEEPSEEK_API_KEY,
  baseURL: DEEPSEEK_BASE_URL,
});

const browser = await chromium.launch();
const page = await browser.newPage();

const server = http.createServer(async (req, res) => {
  const url = new URL(`http://${req.headers.host}${req.url}`);
  const { pathname } = url;

  try {
    if (pathname === "/scape") {
      const maxPage = Number(url.searchParams.get("max_page")) || 2;
      const scrappedData = await crawlAndExtract(ai, page, maxPage);

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
});

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
