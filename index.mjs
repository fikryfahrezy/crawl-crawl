import OpenAI from "openai";
import { chromium } from "playwright";

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const DEEPSEEK_BASE_URL = "https://api.deepseek.com/v1";
const DEEPSEEK_MODEL = "deepseek-chat";

const TARGET_BASE_URL = "https://books.toscrape.com";

const ai = new OpenAI({
  apiKey: DEEPSEEK_API_KEY,
  baseURL: DEEPSEEK_BASE_URL,
});

const bookSchema = {
  name: "book_schema",
  schema: {
    type: "object",
    properties: {
      books: {
        type: "array",
        description: "A list of book objects.",
        items: {
          type: "object",
          properties: {
            title: {
              type: "string",
              description: "The book title.",
            },
            price: {
              type: "string",
              description: "The book's price.",
            },
            rating: {
              type: "integer",
              description: "The book's rating.",
            },
          },
        },
      },
    },
  },
};

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const startUrl = `${TARGET_BASE_URL}/`;
  const visitedUrls = new Set();
  const toVisitUrls = [startUrl];
  const allBookData = [];

  while (toVisitUrls.length > 0 && visitedUrls.size < 20) {
    const currentUrl = toVisitUrls.shift();

    if (visitedUrls.has(currentUrl)) {
      continue;
    }

    console.log(`Crawling: ${currentUrl}`);
    visitedUrls.add(currentUrl);

    try {
      await page.goto(currentUrl, { waitUntil: "domcontentloaded" });
      const pageContent = await page.content();

      const extractedData = await extractDataWithAI(pageContent, bookSchema);
      if (
        typeof extractedData === "object" &&
        "books" in extractedData &&
        Array.isArray(extractedData.books)
      ) {
        allBookData.push(...extractedData.books);
      }

      // const links = await page.$$eval("a", (anchors) =>
      //   anchors.map((a) => a.href)
      // );
      // links.forEach((link) => {
      //   try {
      //     const absoluteUrl = new URL(link, currentUrl).href;
      //     if (
      //       new URL(absoluteUrl).hostname === new URL(startUrl).hostname &&
      //       !visitedUrls.has(absoluteUrl)
      //     ) {
      //       toVisitUrls.push(absoluteUrl);
      //     }
      //   } catch (e) {
      //     console.error(`Invalid link ${link}: ${error.message}`);
      //   }
      // });
    } catch (error) {
      console.error(`Failed to crawl ${currentUrl}: ${error.message}`);
    }
  }

  console.log("Crawling finished. Extracted books:", allBookData);
  await browser.close();
}

async function extractDataWithAI(htmlContent, schema) {
  try {
    const prompt = `
    You are an expert data extraction bot. Your task is to extract structured data from the provided HTML content.
    Extract information about each book listed on the page. The data should strictly follow this JSON schema:
    ${JSON.stringify(schema, null, 2)}
    
    The output must be a JSON array of objects, where each object represents a book.
    
    HTML content:
    ${htmlContent}
    `;

    const completion = await ai.chat.completions.create({
      model: DEEPSEEK_MODEL,
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
    });

    const jsonResponse = completion.choices[0].message.content;
    const extractedData = JSON.parse(jsonResponse);
    return extractedData;
  } catch (error) {
    console.error("Error extracting data with AI:", error.message);
    return null;
  }
}

void (await main());
