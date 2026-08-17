import { BuyWhereClient } from './client';

export interface AutocompleteSuggestion {
  id: number;
  name: string;
  price: number | null;
  currency: string;
  source: string;
  brand: string | null;
  image_url: string | null;
}

export interface AutocompleteResult {
  items: AutocompleteSuggestion[];
  query: string;
}

export interface AutocompleteOptions {
  limit?: number;
  country?: string;
  region?: string;
  currency?: string;
}

export class AutocompleteClient {
  private debounceTimeout: ReturnType<typeof setTimeout> | null = null;
  private abortController: AbortController | null = null;

  constructor(private client: BuyWhereClient) {}

  async autocomplete(
    query: string,
    options: AutocompleteOptions = {}
  ): Promise<AutocompleteResult> {
    if (!query.trim()) {
      return { items: [], query };
    }

    this.cancelPendingRequest();

    const limit = options.limit ?? 8;
    const params = new URLSearchParams();
    params.set('q', query);
    params.set('limit', String(limit));

    if (options.country) {
      params.set('country', options.country);
    }

    if (options.region) {
      params.set('region', options.region);
    }

    if (options.currency) {
      params.set('currency', options.currency);
    }

    // BUY-70915: there is no autocomplete endpoint on the API, and the old
    // `/api/v1/search` path 404s on production (no route is mounted under the
    // `/api` prefix except /api/mcp and /api/v1/compare). Typeahead is served
    // by the canonical bounded search route, which returns a `{ data, meta }`
    // envelope — not `{ items }`.
    const response = this.client.normalizeSearchResponse(
      await this.client.request<{ results?: AutocompleteSuggestion[] }>(
        `/v1/products/search?${params.toString()}`
      )
    );

    return {
      items: response.results ?? [],
      query,
    };
  }

  debouncedAutocomplete(
    query: string,
    delay: number,
    options: AutocompleteOptions = {}
  ): Promise<AutocompleteResult> {
    return new Promise((resolve, reject) => {
      if (this.debounceTimeout) {
        clearTimeout(this.debounceTimeout);
      }

      this.debounceTimeout = setTimeout(async () => {
        try {
          const result = await this.autocomplete(query, options);
          resolve(result);
        } catch (error) {
          reject(error);
        }
      }, delay);
    });
  }

  cancelPendingRequest(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    if (this.debounceTimeout) {
      clearTimeout(this.debounceTimeout);
      this.debounceTimeout = null;
    }
  }

  destroy(): void {
    this.cancelPendingRequest();
  }
}