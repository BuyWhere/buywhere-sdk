# @buywhere/sdk

<p align="left">
  <a href="https://buywhere.ai/api-keys"><img src="https://img.shields.io/badge/🔑_Get_your_free_API_key-60_seconds-4f46e5?style=for-the-badge" alt="Get your free API key"></a>
</p>

Official TypeScript/JavaScript SDK for BuyWhere product search, compare, deals, price history, and key rotation.

## Installation

```bash
npm install @buywhere/sdk
```

## Quick start

```ts
import { createClient } from '@buywhere/sdk';

const client = createClient('bw_live_your_api_key');

const results = await client.search.search('wireless headphones', {
  country: 'US',
  limit: 5,
});

const comparison = await client.compare(['sku_123', 'sku_456']);
const history = await client.priceHistory('sku_123', {
  limit: 30,
  since: '2026-01-01T00:00:00Z',
});

console.log(results.items.length, comparison.products.length, history.price_history.length);
```

## Configuration

```ts
import { BuyWhereSDK } from '@buywhere/sdk';

const client = new BuyWhereSDK({
  apiKey: 'bw_live_your_api_key',
  baseUrl: 'https://api.buywhere.ai',
  timeout: 30000,
  defaultCurrency: 'USD',
  defaultCountry: 'US',
  retry: {
    maxRetries: 3,
    initialDelayMs: 1000,
    maxDelayMs: 10000,
    backoffMultiplier: 2,
  },
});
```

## v0.2.0 methods

```ts
import type {
  CompareResponse,
  PriceHistoryResponse,
  RotateApiKeyResponse,
} from '@buywhere/sdk';

const client = createClient('bw_live_your_api_key');

const compareResult: CompareResponse = await client.compare(['sku_123', 'sku_456']);

const historyResult: PriceHistoryResponse = await client.priceHistory('sku_123', {
  limit: 14,
  since: '2026-04-01T00:00:00Z',
});

const rotation: RotateApiKeyResponse = await client.rotateApiKey();
```

### Not currently supported

The API does not yet expose webhooks, product price alerts, or review summaries.
`client.webhooks.*`, `client.products.getAlerts()`, and
`client.products.getReviewsSummary()` therefore reject immediately with a
`BuyWhereError` whose `errorCode` is `endpoint_not_supported`, rather than
issuing a request that would return an opaque HTTP 404.

The existing namespaced helpers still work:

```ts
const categoryComparison = await client.compare.compareByCategory('electronics');
const product = await client.products.getProduct(12345);
const deals = await client.deals.getDeals({ country: 'US', limit: 10 });
```

## Error handling

```ts
import { BuyWhereError, createClient } from '@buywhere/sdk';

const client = createClient('bw_live_your_api_key');

try {
  await client.compare(['sku_123', 'sku_456']);
} catch (error) {
  if (error instanceof BuyWhereError) {
    console.error(error.statusCode);
    console.error(error.errorCode);
    console.error(error.requestId);
    console.error(error.message);
  }
}
```

`BuyWhereError` normalizes the API error payload into:

- `statusCode`
- `errorCode`
- `requestId`
- `message`

## Module formats

The package ships dual ESM + CJS builds with typed exports:

```ts
import { createClient } from '@buywhere/sdk';
```

```js
const { createClient } = require('@buywhere/sdk');
```

## Get your API key

Sign up free at <https://buywhere.ai/api-keys> — 60 seconds, no credit card.


## AI framework integrations

The SDK ships plug-and-play adapters for OpenAI, Vercel AI SDK, and Anthropic. No hand-wiring required.

### OpenAI (Chat Completions / Responses API)

```ts
import { createClient, createOpenAITools } from '@buywhere/sdk';
import OpenAI from 'openai';

const sdk = createClient('bw_live_your_api_key');
const openai = new OpenAI();
const { tools, execute } = createOpenAITools(sdk);

const res = await openai.chat.completions.create({
  model: 'gpt-4o',
  tools,
  messages: [{ role: 'user', content: 'Find the best price for wireless headphones' }],
});

for (const call of res.choices[0]?.message?.tool_calls ?? []) {
  const result = await execute(call.function.name, call.function.arguments);
  console.log(result);
}
```

### Vercel AI SDK (`generateText` / `streamText`)

```ts
import { generateText } from 'ai';
import { openai } from '@ai-sdk/openai';
import { createClient, createVercelAITools } from '@buywhere/sdk';

const sdk = createClient('bw_live_your_api_key');
const tools = createVercelAITools(sdk);

const { text } = await generateText({
  model: openai('gpt-4o'),
  tools,
  prompt: 'Compare prices for mechanical keyboards',
});
```

### Anthropic (Claude Messages API)

```ts
import Anthropic from '@anthropic-ai/sdk';
import { createClient, createAnthropicTools, executeAnthropicToolUse } from '@buywhere/sdk';

const sdk = createClient('bw_live_your_api_key');
const anthropic = new Anthropic();
const tools = createAnthropicTools(sdk);

const message = await anthropic.messages.create({
  model: 'claude-sonnet-4-5',
  tools,
  messages: [{ role: 'user', content: 'Find deals on running shoes' }],
});

for (const block of message.content) {
  if (block.type === 'tool_use') {
    const result = await executeAnthropicToolUse(sdk, block.name, block.input);
    console.log(result);
  }
}
```

### Low-level dispatch

All three adapters call `dispatchToolCall` under the hood. Use it directly for custom integrations:

```ts
import { createClient, dispatchToolCall } from '@buywhere/sdk';

const sdk = createClient('bw_live_your_api_key');
const result = await dispatchToolCall(sdk, 'resolve_product_query', {
  query: 'wireless headphones',
  limit: 5,
  country: 'US',
});
```

## Development

```bash
npm run build
npm test
```
