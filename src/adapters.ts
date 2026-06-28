import type { BuyWhereSDK } from './index';
import { OPENAI_TOOL_SCHEMAS } from './schemas';
import { BuyWhereError } from './client';

/**
 * Argument objects for each BuyWhere tool, keyed by tool name.
 * These mirror the JSON schemas in OPENAI_TOOL_SCHEMAS.
 */
export interface BuyWhereToolArgs {
  resolve_product_query: {
    query: string;
    country?: string;
    region?: 'us' | 'sea';
    limit?: number;
    price_min?: number;
    price_max?: number;
    include_out_of_stock?: boolean;
  };
  find_best_price: {
    product_name: string;
    category?: string;
    country?: string;
    region?: 'us' | 'sea';
  };
  compare_products: {
    product_ids?: number[];
    category?: string;
    country?: string;
    limit?: number;
  };
  get_product_details: {
    product_id: number;
    country?: string;
    include_reviews?: boolean;
    include_price_history?: boolean;
  };
  get_purchase_options: {
    product_id: number;
    country?: string;
    filter_merchant?: string;
    filter_price_min?: number;
    filter_price_max?: number;
    sort_by?: 'price_asc' | 'price_desc' | 'reliability' | 'rating';
  };
}

export type BuyWhereToolName = keyof BuyWhereToolArgs;

/**
 * Dispatch a BuyWhere tool call to the matching SDK method.
 *
 * @param sdk - A BuyWhere SDK instance (from `createClient`).
 * @param name - One of the tool names exported in OPENAI_TOOL_SCHEMAS.
 * @param args - The arguments object produced by the model.
 * @returns The raw SDK response for that tool.
 */
export async function dispatchToolCall<T extends BuyWhereToolName>(
  sdk: BuyWhereSDK,
  name: T,
  args: BuyWhereToolArgs[T],
): Promise<unknown> {
  const a = (args ?? {}) as Record<string, unknown>;

  switch (name) {
    case 'resolve_product_query': {
      const { query, limit, price_min, price_max, include_out_of_stock } = a as BuyWhereToolArgs['resolve_product_query'];
      return sdk.agents.search({
        q: query,
        ...(limit ? { limit } : {}),
        ...(price_min ? { price_min } : {}),
        ...(price_max ? { price_max } : {}),
        ...(include_out_of_stock ? { availability: true } : {}),
      });
    }

    case 'find_best_price': {
      const { product_name, category, country, region } = a as BuyWhereToolArgs['find_best_price'];
      return sdk.search.search({
        query: product_name,
        ...(category ? { platform: category } : {}),
        ...(country ? { country: country as 'SG' | 'MY' | 'TH' | 'PH' | 'VN' | 'ID' | 'US' } : {}),
        ...(region ? { region } : {}),
        limit: 10,
      });
    }

    case 'compare_products': {
      const { product_ids, category } = a as BuyWhereToolArgs['compare_products'];
      if (category) {
        return sdk.compare.compareByCategory(category);
      }
      return sdk.compare.compareProducts((product_ids ?? []) as number[]);
    }

    case 'get_product_details': {
      const { product_id, country, include_price_history } = a as BuyWhereToolArgs['get_product_details'];
      const detail = await sdk.products.getProduct(product_id);
      if (include_price_history) {
        const history = await sdk.priceHistory(product_id, country ? { country: country as 'SG' | 'MY' | 'TH' | 'PH' | 'VN' | 'ID' | 'US' } : {});
        return { product: detail, price_history: history };
      }
      return detail;
    }

    case 'get_purchase_options': {
      const { product_id } = a as BuyWhereToolArgs['get_purchase_options'];
      return sdk.compare([product_id]);
    }

    default: {
      const exhaustive: never = name;
      throw new BuyWhereError(
        `Unknown BuyWhere tool: ${exhaustive as string}`,
        400,
        undefined,
        'VALIDATION_ERROR',
      );
    }
  }
}

/**
 * OpenAI tools integration.
 *
 * Usage with the Chat Completions / Responses API:
 *
 * ```ts
 * import { createClient, createOpenAITools } from '@buywhere/sdk';
 *
 * const sdk = createClient(process.env.BUYWHERE_API_KEY);
 * const { tools, execute } = createOpenAITools(sdk);
 *
 * // 1. Pass `tools` to openai.chat.completions.create({ tools, ... })
 * // 2. When the model returns a tool_call, run:
 * const result = await execute(toolCall.function.name, toolCall.function.arguments);
 * ```
 */
export interface OpenAIToolsIntegration {
  /** JSON schemas to pass as the `tools` parameter to the OpenAI API. */
  tools: typeof OPENAI_TOOL_SCHEMAS.tools;
  /** Execute a single tool call. `args` may be a JSON string or a parsed object. */
  execute: (name: string, args: string | Record<string, unknown>) => Promise<unknown>;
}

export function createOpenAITools(sdk: BuyWhereSDK): OpenAIToolsIntegration {
  return {
    tools: OPENAI_TOOL_SCHEMAS.tools,
    async execute(name, args) {
      const parsed = typeof args === 'string' ? JSON.parse(args) : args;
      return dispatchToolCall(
        sdk,
        name as BuyWhereToolName,
        parsed as BuyWhereToolArgs[BuyWhereToolName],
      );
    },
  };
}

/**
 * Vercel AI SDK integration.
 *
 * Returns a set of tools in the shape consumed by the AI SDK `generateText` /
 * `streamText` `tools` option. Each tool exposes `description`, `parameters`
 * (JSON Schema), and an `execute` function.
 *
 * ```ts
 * import { generateText } from 'ai';
 * import { openai } from '@ai-sdk/openai';
 * import { createClient, createVercelAITools } from '@buywhere/sdk';
 *
 * const sdk = createClient(process.env.BUYWHERE_API_KEY);
 * const tools = createVercelAITools(sdk);
 *
 * const { text } = await generateText({ model: openai('gpt-4o'), tools, prompt: '...' });
 * ```
 */
export interface VercelAITool {
  description: string;
  parameters: Record<string, unknown>;
  execute: (args: Record<string, unknown>) => Promise<unknown>;
}

export function createVercelAITools(sdk: BuyWhereSDK): Record<BuyWhereToolName, VercelAITool> {
  const build = (def: (typeof OPENAI_TOOL_SCHEMAS.tools)[number]): VercelAITool => ({
    description: def.function.description,
    parameters: def.function.parameters as Record<string, unknown>,
    async execute(args) {
      return dispatchToolCall(
        sdk,
        def.function.name as BuyWhereToolName,
        args as BuyWhereToolArgs[BuyWhereToolName],
      );
    },
  });

  const tools: Partial<Record<BuyWhereToolName, VercelAITool>> = {};
  for (const def of OPENAI_TOOL_SCHEMAS.tools) {
    tools[def.function.name as BuyWhereToolName] = build(def);
  }
  return tools as Record<BuyWhereToolName, VercelAITool>;
}

/**
 * Anthropic Claude SDK integration.
 *
 * Returns tools in the shape consumed by the Anthropic Messages API `tools`
 * parameter. Each tool has `name`, `description`, and `input_schema` (the
 * JSON Schema the model uses to fill arguments).
 *
 * ```ts
 * import Anthropic from '@anthropic-ai/sdk';
 * import { createClient, createAnthropicTools } from '@buywhere/sdk';
 *
 * const sdk = createClient(process.env.BUYWHERE_API_KEY);
 * const anthropic = new Anthropic();
 * const tools = createAnthropicTools(sdk);
 *
 * const message = await anthropic.messages.create({
 *   model: 'claude-sonnet-4-5',
 *   tools,
 *   messages: [{ role: 'user', content: 'Find the best price for wireless headphones' }],
 * });
 *
 * for (const block of message.content) {
 *   if (block.type === 'tool_use') {
 *     const result = await dispatchToolCall(sdk, block.name, block.input as any);
 *   }
 * }
 * ```
 */
export interface AnthropicTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export function createAnthropicTools(sdk: BuyWhereSDK): AnthropicTool[] {
  return OPENAI_TOOL_SCHEMAS.tools.map((def) => ({
    name: def.function.name,
    description: def.function.description ?? '',
    input_schema: def.function.parameters as Record<string, unknown>,
  }));
}

/**
 * Execute an Anthropic tool_use block against the SDK.
 *
 * Convenience wrapper around `dispatchToolCall` for callers wiring the
 * Anthropic Messages API.
 */
export async function executeAnthropicToolUse(
  sdk: BuyWhereSDK,
  name: string,
  input: Record<string, unknown>,
): Promise<unknown> {
  return dispatchToolCall(sdk, name as BuyWhereToolName, input as BuyWhereToolArgs[BuyWhereToolName]);
}
