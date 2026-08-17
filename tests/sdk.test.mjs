import assert from 'node:assert/strict';
import test from 'node:test';

import { BuyWhereClient, BuyWhereError, createClient, createOpenAITools, createVercelAITools, createAnthropicTools, executeAnthropicToolUse } from '../dist/index.js';

test('SDK compare is callable and posts product ids', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];

  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({
      products: [],
      meta: {
        total_products: 0,
        total_merchants: 0,
        last_updated: '2026-04-26T00:00:00Z',
      },
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  try {
    const client = createClient('bw_live_test');
    assert.equal(typeof client.compare, 'function');

    await client.compare(['sku_123', 'sku_456']);
    // BUY-70872: the API exposes compare as GET ?ids=, not a POST body.
    // POST /v1/products/compare returns 404 on production.
    assert.equal(
      calls[0].url,
      'https://api.buywhere.ai/v1/products/compare?ids=sku_123%2Csku_456'
    );
    assert.notEqual(calls[0].init.method, 'POST');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('priceHistory sends limit and since query params', async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = '';

  globalThis.fetch = async (url) => {
    requestedUrl = String(url);
    return new Response(JSON.stringify({
      product_id: 123,
      product_name: 'Test Product',
      country: 'US',
      currency: 'USD',
      period: '30d',
      price_history: [],
      lowest_price: 10,
      highest_price: 20,
      average_price: 15,
      lowest_price_date: '2026-04-01T00:00:00Z',
      highest_price_date: '2026-04-10T00:00:00Z',
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  try {
    const client = new BuyWhereClient('bw_live_test');
    await client.priceHistory('sku_123', {
      limit: 30,
      since: '2026-04-01T00:00:00Z',
    });
    assert.equal(
      requestedUrl,
      'https://api.buywhere.ai/v1/products/sku_123/price-history?limit=30&since=2026-04-01T00%3A00%3A00Z',
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('rotateApiKey resolves current key id and maps response fields', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];

  globalThis.fetch = async (url) => {
    calls.push(String(url));

    if (String(url).endsWith('/v1/auth/me')) {
      return new Response(JSON.stringify({
        key_id: 'key_123',
        tier: 'live',
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({
      new_api_key: 'bw_live_rotated',
      old_key_expires_at: '2026-04-27T00:00:00Z',
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  try {
    const client = createClient('bw_live_test');
    const rotation = await client.rotateApiKey();
    assert.deepEqual(rotation, {
      newApiKey: 'bw_live_rotated',
      oldKeyExpiresAt: '2026-04-27T00:00:00Z',
    });
    assert.deepEqual(calls, [
      'https://api.buywhere.ai/v1/auth/me',
      'https://api.buywhere.ai/v1/keys/key_123/rotate',
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('BuyWhereError exposes errorCode and requestId', async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () => new Response(JSON.stringify({
    error_code: 'rate_limit',
    message: 'Slow down',
    request_id: 'req_123',
  }), {
    status: 429,
    headers: { 'content-type': 'application/json' },
  });

  try {
    const client = new BuyWhereClient('bw_live_test');
    await assert.rejects(
      () => client.compare(['sku_123', 'sku_456']),
      (error) => {
        assert.ok(error instanceof BuyWhereError);
        assert.equal(error.statusCode, 429);
        assert.equal(error.errorCode, 'rate_limit');
        assert.equal(error.requestId, 'req_123');
        assert.equal(error.message, 'Slow down');
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('BUY-70872: webhooks facade rejects — API exposes no /v1/webhooks route', async () => {
  const originalFetch = globalThis.fetch;
  let networkCalls = 0;
  globalThis.fetch = async () => { networkCalls++; return new Response('{}', { status: 200 }); };

  try {
    const client = createClient('bw_live_test');
    await assert.rejects(() => client.webhooks.create('https://example.com/webhook', ['price_drop']));
    await assert.rejects(() => client.webhooks.list());
    await assert.rejects(() => client.webhooks.delete('wh_123'));
    assert.equal(networkCalls, 0, 'must not issue HTTP requests for unsupported endpoints');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('BUY-70872: products.getAlerts rejects — API exposes no /alerts route', async () => {
  const originalFetch = globalThis.fetch;
  let networkCalls = 0;
  globalThis.fetch = async () => { networkCalls++; return new Response('{}', { status: 200 }); };

  try {
    const client = createClient('bw_live_test');
    await assert.rejects(
      () => client.products.getAlerts({ product_id: 123 }),
      (err) => {
        assert.ok(err instanceof BuyWhereError);
        assert.equal(err.errorCode, 'endpoint_not_supported');
        return true;
      },
    );
    assert.equal(networkCalls, 0, 'must not issue HTTP requests for unsupported endpoints');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ---- Adapters: createOpenAITools dispatch ----
test('createOpenAITools returns schemas and execute dispatches resolve_product_query', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url) });
    return new Response(JSON.stringify({
      results: [],
      total: 0,
      agent_results: [],
      query_time_ms: 5,
      cache_hit: false,
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  try {
    const sdk = createClient('bw_live_test');
    const { tools, execute } = createOpenAITools(sdk);
    assert.equal(Array.isArray(tools), true);
    assert.equal(tools.length, 5);
    assert.equal(tools[0].function.name, 'resolve_product_query');

    // args as JSON string (the shape OpenAI returns)
    await execute('resolve_product_query', JSON.stringify({ query: 'wireless headphones', limit: 5 }));
    assert.ok(calls.some(c => c.url.includes('/v2/agents/search')), 'expected agents search URL');

    // dispatch unknown tool -> throws
    await assert.rejects(() => execute('nope', '{}'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('createVercelAITools exposes 5 executable tools', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    results: [], total: 0, agent_results: [], query_time_ms: 1, cache_hit: false,
  }), { status: 200, headers: { 'content-type': 'application/json' } });

  try {
    const sdk = createClient('bw_live_test');
    const tools = createVercelAITools(sdk);
    const names = Object.keys(tools);
    assert.equal(names.length, 5);
    assert.equal(typeof tools.resolve_product_query.execute, 'function');
    assert.ok(tools.resolve_product_query.parameters.properties.query, 'query param present');
    const res = await tools.resolve_product_query.execute({ query: 'mechanical keyboard' });
    assert.equal(typeof res, 'object');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ---- Adapters: createAnthropicTools ----
test('createAnthropicTools returns 5 tools in Anthropic shape with input_schema', () => {
  const sdk = createClient('bw_live_test');
  const tools = createAnthropicTools(sdk);
  assert.equal(tools.length, 5);
  for (const t of tools) {
    assert.ok(typeof t.name === 'string');
    assert.ok(typeof t.description === 'string');
    assert.ok(typeof t.input_schema === 'object');
  }
  assert.ok(tools.some(t => t.name === 'resolve_product_query'));
});

test('executeAnthropicToolUse dispatches resolve_product_query to agents search', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push({ url: String(url) });
    return new Response(JSON.stringify({
      results: [], total: 0, agent_results: [], query_time_ms: 1, cache_hit: false,
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  try {
    const sdk = createClient('bw_live_test');
    await executeAnthropicToolUse(sdk, 'resolve_product_query', { query: 'running shoes' });
    assert.ok(calls.some(c => c.url.includes('/v2/agents/search')), 'expected agents search URL');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// BUY-70604: the API returns search-shaped payloads as `{ data, meta }`.
// Before the fix, `.results` was `undefined` and `getProduct()` returned
// `null` for products that exist. Envelope captured from live prod
// GET /v1/products/search?q=laptop&country=SG on 2026-08-16.
const PROD_SEARCH_ENVELOPE = {
  data: [
    {
      id: '54614597',
      title: '[Laptop] Microsoft Surface Laptop 13-inch',
      price: { amount: 1348.9, currency: 'SGD' },
      merchant: 'shopee',
      url: 'https://shopee.sg/i.142031781.8754682274',
      image_url: null,
      region: 'SG',
      country_code: 'SG',
      updated_at: '2026-08-16T00:00:00Z',
      availability: { in_stock: true, status: 'in_stock' },
    },
  ],
  meta: { total: 3, limit: 2, offset: 0, response_time_ms: 147, cached: false, has_more: true },
};

function stubFetch(payload) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  return () => { globalThis.fetch = originalFetch; };
}

test('BUY-70604: search() normalizes the {data,meta} envelope to .results', async () => {
  const restore = stubFetch(PROD_SEARCH_ENVELOPE);
  try {
    const res = await createClient('bw_live_test').search.search({ query: 'laptop', country: 'SG' });

    assert.ok(Array.isArray(res.results), '.results must be an array, not undefined');
    assert.equal(res.results.length, 1);
    assert.equal(res.results[0].id, '54614597');

    // `data` stays available and identical for callers using the raw field.
    assert.deepEqual(res.data, res.results);

    // Scalars are lifted out of `meta`.
    assert.equal(res.total, 3);
    assert.deepEqual(res.page, { limit: 2, offset: 0 });
    assert.equal(res.cached, false);
    assert.equal(res.meta.has_more, true);
  } finally {
    restore();
  }
});

test('BUY-70604: availability/in_stock survives normalization', async () => {
  const restore = stubFetch(PROD_SEARCH_ENVELOPE);
  try {
    const res = await createClient('bw_live_test').search.search('laptop');
    assert.deepEqual(res.results[0].availability, { in_stock: true, status: 'in_stock' });
  } finally {
    restore();
  }
});

test('BUY-70604: getProduct() returns the product instead of null', async () => {
  const restore = stubFetch(PROD_SEARCH_ENVELOPE);
  try {
    const product = await createClient('bw_live_test').products.getProduct(54614597);
    assert.notEqual(product, null, 'getProduct() must not return null when the API returned a product');
    assert.equal(product.id, '54614597');
  } finally {
    restore();
  }
});

test('BUY-70604: legacy {results,total} payloads still work', async () => {
  const restore = stubFetch({
    results: [{ id: '1', title: 'Legacy' }],
    total: 1,
    page: { limit: 10, offset: 0 },
    response_time_ms: 5,
    cached: true,
  });
  try {
    const res = await createClient('bw_live_test').search.search('laptop');
    assert.equal(res.results.length, 1);
    assert.deepEqual(res.data, res.results);
    assert.equal(res.total, 1);
    assert.equal(res.cached, true);
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// BUY-70872 — phantom route regressions.
// Every path below was verified against production on 2026-08-17: the paths the
// SDK used to call returned 404 while the corrected paths returned 429
// (rate-limited but routed). 404-vs-429 is a valid discriminator because routing
// happens before rate limiting — bogus control paths returned 404.
// ---------------------------------------------------------------------------

function captureFetch(payload = { products: [], meta: {} }) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}

test('BUY-70872: deals() hits /v1/products/deals, never phantom /v1/deals', async () => {
  const { calls, restore } = captureFetch();
  try {
    await createClient('bw_live_test').deals.getDeals({ country: 'SG', limit: 5 });
    const url = new URL(calls[0].url);
    assert.equal(url.pathname, '/v1/products/deals');
    // Guard the exact phantom path that 404'd in production.
    assert.ok(!/\/v1\/deals(\?|$)/.test(calls[0].url), 'must not call /v1/deals');
    // Spec parameter is country_code, not country.
    assert.equal(url.searchParams.get('country_code'), 'SG');
    assert.equal(url.searchParams.get('country'), null);
  } finally {
    restore();
  }
});

test('BUY-70872: getDealsFeed() maps min_discount_pct -> min_discount on the real path', async () => {
  const { calls, restore } = captureFetch();
  try {
    await createClient('bw_live_test').deals.getDealsFeed({ country: 'MY', min_discount_pct: 30 });
    const url = new URL(calls[0].url);
    assert.equal(url.pathname, '/v1/products/deals');
    assert.ok(!calls[0].url.includes('/v1/deals/feed'), 'must not call /v1/deals/feed');
    assert.equal(url.searchParams.get('min_discount'), '30');
    assert.equal(url.searchParams.get('min_discount_pct'), null);
    assert.equal(url.searchParams.get('country_code'), 'MY');
  } finally {
    restore();
  }
});

test('BUY-70872: compare(ids) uses GET ?ids= rather than a POST body', async () => {
  const { calls, restore } = captureFetch();
  try {
    await createClient('bw_live_test').compare.compareProducts(['sku_1', 'sku_2']);
    const url = new URL(calls[0].url);
    assert.equal(url.pathname, '/v1/products/compare');
    assert.equal(url.searchParams.get('ids'), 'sku_1,sku_2');
    assert.notEqual(calls[0].init.method, 'POST');
  } finally {
    restore();
  }
});

test('BUY-70872: compare(category) resolves to /v1/categories/{slug}', async () => {
  const { calls, restore } = captureFetch();
  try {
    await createClient('bw_live_test').compare.compareByCategory('laptops');
    const url = new URL(calls[0].url);
    assert.equal(url.pathname, '/v1/categories/laptops');
    assert.ok(!calls[0].url.includes('/v1/compare/'), 'must not call phantom /v1/compare/*');
  } finally {
    restore();
  }
});

test('BUY-70872: unsupported endpoints fail fast instead of emitting an opaque 404', async () => {
  const { calls, restore } = captureFetch();
  try {
    const client = createClient('bw_live_test');
    const cases = [
      ['getReviewsSummary', () => client.products.getReviewsSummary({ product_id: 1 })],
      ['getAlerts', () => client.products.getAlerts({ product_id: 1 })],
      ['webhooks.list', () => client.webhooks.list()],
      ['webhooks.create', () => client.webhooks.create('https://x.test', ['price'])],
      ['webhooks.delete', () => client.webhooks.delete('wh_1')],
    ];

    for (const [name, invoke] of cases) {
      await assert.rejects(
        invoke,
        (err) => {
          assert.ok(err instanceof BuyWhereError, `${name} should throw BuyWhereError`);
          assert.equal(err.errorCode, 'endpoint_not_supported', `${name} errorCode`);
          assert.equal(err.statusCode, 501, `${name} statusCode`);
          return true;
        },
        `${name} must reject`
      );
    }

    // Critically: no network call should be attempted for unsupported endpoints.
    assert.equal(calls.length, 0, 'unsupported endpoints must not issue HTTP requests');
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// BUY-70915: agents.search() and autocomplete() bypassed the {data,meta}
// normalizer added in BUY-70604, and autocomplete pointed at a phantom route.
// ---------------------------------------------------------------------------

test('BUY-70915: agents.search() normalizes the {data,meta} envelope into .results', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    data: [{ id: '1', name: 'Dell XPS 13', price: 1299, currency: 'SGD' }],
    meta: { total: 1, limit: 20, offset: 0 },
  }), { status: 200, headers: { 'content-type': 'application/json' } });

  try {
    const sdk = createClient('bw_live_test');
    const res = await sdk.agents.search('laptop');
    // The API sends {data,meta}; every documented example reads .results/.total.
    assert.ok(Array.isArray(res.results), 'results must be an array, not undefined');
    assert.equal(res.results.length, 1);
    assert.equal(res.results[0].name, 'Dell XPS 13');
    assert.equal(res.total, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('BUY-70915: agents.search() FTS fallback also normalizes the envelope', async () => {
  const originalFetch = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(String(url));
    // Fail the semantic route until the breaker opens, then serve the envelope.
    if (String(url).includes('/v2/agents/search')) {
      return new Response(JSON.stringify({ error: 'boom' }), { status: 500 });
    }
    return new Response(JSON.stringify({
      data: [{ id: '7', name: 'Fallback Laptop', price: 999, currency: 'SGD' }],
      meta: { total: 1, limit: 20, offset: 0 },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  try {
    const sdk = createClient({
      apiKey: 'bw_live_test',
      retry: { maxRetries: 0 },
      circuitBreaker: { failureThreshold: 1 },
    });
    // First call trips the breaker open.
    await sdk.agents.search('laptop').catch(() => {});
    const res = await sdk.agents.search('laptop');
    assert.ok(urls.some((u) => u.includes('mode=fts')), 'should fall back to FTS');
    assert.ok(Array.isArray(res.results), 'fallback results must be normalized');
    assert.equal(res.results[0].name, 'Fallback Laptop');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('BUY-70915: autocomplete() calls a real API route, not the phantom /api/v1/search', async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = '';
  globalThis.fetch = async (url) => {
    requestedUrl = String(url);
    return new Response(JSON.stringify({
      data: [{ id: '3', name: 'Lapdesk', price: 39, currency: 'SGD' }],
      meta: { total: 1 },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  try {
    const sdk = createClient('bw_live_test');
    const res = await sdk.autocomplete.autocomplete('lap', { limit: 5 });
    // /api/v1/search 404s on production — there is no /api-prefixed search route.
    assert.ok(!requestedUrl.includes('/api/v1/search'), `phantom route used: ${requestedUrl}`);
    assert.ok(requestedUrl.includes('/v1/products/search'), `expected real search route, got ${requestedUrl}`);
    assert.equal(res.items.length, 1, 'items must be populated from the {data,meta} envelope');
    assert.equal(res.items[0].name, 'Lapdesk');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
