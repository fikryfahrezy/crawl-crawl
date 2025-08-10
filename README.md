# Crawl Crawl

## API Documentation

### Health

To check if the server can accept requests or not.

<table>
  <tbody>
    <tr>
      <td>Method</td>
      <td>
        <code>GET</code>
      </td>
    </tr>
    <tr>
      <td>Path</td>
      <td>
        <code>/health</code>
      </td>
    </tr>
  </tbody>
</table>

Example with cURL.

```bash
curl --request GET \
  --url 'https://crawl.fahrezy.work/health'
```

Response (200):

```json
{
  "success": true
}
```

### Scrape

Scrape product list from eBay.

<table>
  <tbody>
    <tr>
      <td>Method</td>
      <td>
        <code>GET</code>
      </td>
    </tr>
    <tr>
      <td>Path</td>
      <td>
        <code>/scrape</code>
      </td>
    </tr>
    <tr>
      <td>Query</td>
      <td>
        <ul>
          <li>
            <code>(Required) search: string</code>
          </li>
          <li>
            <code>(Optional) from_page: number</code>, default to <code>1</code>
          </li>
          <li>
            <code>(Optional) to_page: number</code>, default to <code>from_page</code>
          </li>
        </ul>
      </td>
    </tr>
  </tbody>
</table>

Example with cURL.

```bash
curl --request GET \
  --url 'https://crawl.fahrezy.work/scrape?search=nike&from_page=1&to_page=1'
```

Response (200):

```json
[
	{
		"name": "Nike Air Max 2017 Triple Black Mens Sneakers Size US 7-15 Casual Shoes New✅",
		"price": "$97.83",
		"description": "New with box: A brand-new, unused, and unworn item (including handmade items) in the original packaging (such as the original box or bag) and/or with the original tags attached."
	},
	{
		"name": "Nike Dunk Low Retro SE Armory Navy Gum Men Casual Shoes Sneakers HQ1931-400",
		"price": "$119.99",
		"description": "Brand New"
	}
]
```

## Project Setup

### Create Env File

Create `.env` file by copying the `.env.example` and adjusting each key's value.

```bash
cp .env.example .env
```

### Install Dependencies

```bash
pnpm install
```

### Run the Project

```bash
npm run start
```

## Running with Docker

Create `.env` file like in the [Project Setup section](#project-setup), then run it with `Docker Compose`.

```bash
docker compose up --build --remove-orphans
```
