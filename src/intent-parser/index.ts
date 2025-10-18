/**
 * Intent Parser
 * Parses user intent and breaks down into structured requirements.
 * Each requirement specifies: blockchain, contract address, token ID, source (media URL).
 */

import OpenAI from 'openai';
import chalk from 'chalk';
import { getConfig, getModelConfig, getFF1DeviceConfig } from '../config';
import { applyConstraints } from './utils';
import type { Stream } from 'openai/streaming';
import type { ChatCompletionChunk } from 'openai/resources/chat/completions';

// Cache for AI clients
const clientCache = new Map<string, OpenAI>();

interface ConversationContext {
  messages: OpenAI.Chat.ChatCompletionMessageParam[];
}

interface IntentParserOptions {
  modelName?: string;
  conversationContext?: ConversationContext;
}

interface IntentParserResult {
  approved: boolean;
  params?: Record<string, unknown>;
  needsMoreInfo: boolean;
  question?: string;
  messages?: OpenAI.Chat.ChatCompletionMessageParam[];
}

/**
 * Create AI client for intent parser
 *
 * @param {string} [modelName] - Model name
 * @returns {OpenAI} OpenAI client
 */
function createIntentParserClient(modelName?: string): OpenAI {
  const config = getConfig();
  const selectedModel = modelName || config.defaultModel;

  if (clientCache.has(selectedModel)) {
    return clientCache.get(selectedModel)!;
  }

  const modelConfig = getModelConfig(selectedModel);
  const client = new OpenAI({
    apiKey: modelConfig.apiKey,
    baseURL: modelConfig.baseURL,
    timeout: modelConfig.timeout,
    maxRetries: modelConfig.maxRetries,
  });

  clientCache.set(selectedModel, client);
  return client;
}

/**
 * Build intent parser system prompt
 *
 * @returns {string} System prompt for intent parser
 */
function buildIntentParserSystemPrompt(): string {
  const deviceConfig = getFF1DeviceConfig();
  const hasDevices = deviceConfig.devices && deviceConfig.devices.length > 0;

  let deviceInfo = '';
  if (hasDevices) {
    const deviceList = deviceConfig.devices
      .map((d, i) => `  ${i + 1}. ${d.name || d.host}`)
      .filter((line) => !line.includes('undefined'))
      .join('\n');

    if (deviceList) {
      deviceInfo = `\n\nAVAILABLE FF1 DEVICES:\n${deviceList}`;
    }
  }

  return `SYSTEM: FF1 Intent Parser

ROLE
- Turn user text into deterministic parameters for non‑AI execution. Keep public output minimal and structured.

REASONING (private scratchpad)
- Use Plan→Check→Act→Reflect for each step.
- Default to a single deterministic path.
- Only branch in two cases:
  1) Multiple plausible feed candidates after search.
  2) Verification failure requiring targeted repair.
- When branching, keep BEAM_WIDTH=2, DEPTH_LIMIT=2.
- Score candidates by: correctness, coverage, determinism, freshness, cost.
- Keep reasoning hidden; publicly print one status sentence before each tool call.

OUTPUT CONTRACT
- BUILD → call parse_requirements with { requirements: Requirement[], playlistSettings?: { title?: string | null, slug?: string | null, durationPerItem?: number, preserveOrder?: boolean, deviceName?: string } }
- SEND → call confirm_send_playlist with { filePath: string, deviceName?: string }
- QUESTION → answer briefly (no tool call)
- Use correct types; never truncate addresses/tokenIds; tokenIds are strings; quantity is a number.

REQUIREMENT TYPES (BUILD)
- build_playlist: { type, blockchain: "ethereum"|"tezos", contractAddress, tokenIds: string[], quantity?: number, source?: string }
- query_address: { type, ownerAddress: 0x…|tz…|domain.eth|domain.tez, quantity?: number }
  • Domains (.eth/.tez) are OWNER DOMAINS. Do not ask for tokenIds. Do not treat as contracts.
  • A raw 0x…/tz… without tokenIds is an OWNER ADDRESS (query_address), not a contract.
- fetch_feed: { type, playlistName: string, quantity?: number (default 5) }

PLAYLIST SETTINGS EXTRACTION
- durationPerItem: parse phrases (e.g., "6 seconds each" → 6)
- preserveOrder: default true; "shuffle" → false
- title/slug: optional; include only if provided by the user
- deviceName: from phrases like "send to", "display on", "play on"${hasDevices ? '\n- available devices:\n' + deviceInfo.replace('\n\nAVAILABLE FF1 DEVICES:\n', '') : ''}

MISSING INFO POLICY (ASK AT MOST ONE QUESTION)
- build_playlist: ask for blockchain/contract/tokenIds if unclear
- fetch_feed: ask for playlistName if unclear
- query_address: ask for owner/domain if unclear
- send: ask for device name only if user insists on a specific device and it’s ambiguous; otherwise default to first device

FREE‑FORM COLLECTION NAMES
- Treat as fetch_feed; do not guess contracts. If user says "some", default quantity = 5.

SEND INTENT
- Triggers: display/push/send/cast/send to device/play on FF1
- Always call confirm_send_playlist with filePath (default "./playlist.json") and optional deviceName
- Device selection: exact match → case‑insensitive → if multiple/none → ask user to choose

COMMUNICATION STYLE
- Acknowledge briefly: "Got it." or "Understood." (one line).
- Do not repeat the user's request; do not paraphrase it.
- Bullet the extracted facts using friendly labels (no camelCase):
  • What we're building (sources/collections/addresses)
  • Settings (duration per item, keep order or shuffle, device, title/slug if provided)
- Prefer human units and plain words (e.g., "2 minutes per item", "device: Living Room").
- Use clear, direct language; no filler or corporate jargon; neutral, warm tone.
- Immediately call the function when ready. No extra narration.`;
}

/**
 * Intent parser function schemas
 */
const intentParserFunctionSchemas: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'parse_requirements',
      description:
        'Parse validated and complete requirements. Only call this when you have all required information for each requirement: blockchain, contract address, token IDs, and source.',
      parameters: {
        type: 'object',
        properties: {
          requirements: {
            type: 'array',
            description:
              'Array of parsed requirements. Each can be either build_playlist (specific NFTs), fetch_feed (feed playlist), or query_address (all NFTs from address)',
            items: {
              type: 'object',
              properties: {
                type: {
                  type: 'string',
                  enum: ['build_playlist', 'fetch_feed', 'query_address'],
                  description:
                    'Type of requirement: build_playlist (specific NFTs), fetch_feed (feed playlist), or query_address (all NFTs from address)',
                },
                blockchain: {
                  type: 'string',
                  description:
                    'Blockchain network (ethereum, tezos) - only for build_playlist type',
                },
                contractAddress: {
                  type: 'string',
                  description: 'NFT contract address - only for build_playlist type',
                },
                tokenIds: {
                  type: 'array',
                  description: 'Array of token IDs to fetch - only for build_playlist type',
                  items: {
                    type: 'string',
                  },
                },
                ownerAddress: {
                  type: 'string',
                  description:
                    'Owner wallet address (0x... for Ethereum, tz... for Tezos) - only for query_address type',
                },
                source: {
                  type: 'string',
                  description: 'Media URL or source identifier - optional for build_playlist type',
                },
                playlistName: {
                  type: 'string',
                  description:
                    'Playlist name in the feed (can be any playlist name) - only for fetch_feed type',
                },
                quantity: {
                  type: 'number',
                  description:
                    'Number of items to fetch (default: 5 for fetch_feed, all for query_address unless specified)',
                },
              },
              required: ['type'],
            },
          },
          playlistSettings: {
            type: 'object',
            description: 'Playlist configuration settings',
            properties: {
              title: {
                type: 'string',
                description: 'Playlist title (null for auto-generation)',
              },
              slug: {
                type: 'string',
                description: 'Playlist slug (null for auto-generation)',
              },
              durationPerItem: {
                type: 'number',
                description: 'Duration per item in seconds (e.g., 5 for "5 seconds each")',
              },
              totalDuration: {
                type: 'number',
                description: 'Total playlist duration in seconds (optional)',
              },
              preserveOrder: {
                type: 'boolean',
                description: 'Whether to preserve source order (true) or randomize (false)',
              },
              deviceName: {
                type: 'string',
                description:
                  'Device name to display on (null for first device, omit if no display requested)',
              },
            },
          },
        },
        required: ['requirements'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'confirm_send_playlist',
      description:
        'Confirm the playlist file path and device name for sending. This function is called after the user mentions "send" or similar phrases.',
      parameters: {
        type: 'object',
        properties: {
          filePath: {
            type: 'string',
            description: 'Path to the playlist file (default: "./playlist.json")',
          },
          deviceName: {
            type: 'string',
            description:
              'Name of the device to send to (omit or leave empty if no specific device)',
          },
        },
        required: ['filePath'],
      },
    },
  },
];

/**
 * Format markdown text for terminal display
 *
 * @param {string} text - Markdown text
 * @returns {string} Formatted text with styling
 */
function formatMarkdown(text: string): string {
  if (!text) {
    return '';
  }

  let formatted = text;

  // Headings: # text, ## text, ### text, etc.
  formatted = formatted.replace(/^(#{1,6})\s+(.+)$/gm, (_, hashes, content) => {
    const level = hashes.length;
    if (level === 1) {
      return chalk.bold.underline(content);
    } else if (level === 2) {
      return chalk.bold(content);
    } else {
      return chalk.bold(content);
    }
  });

  // Bold: **text** or __text__
  formatted = formatted.replace(/\*\*(.+?)\*\*/g, (_, p1) => chalk.bold(p1));
  formatted = formatted.replace(/__(.+?)__/g, (_, p1) => chalk.bold(p1));

  // Italic: *text* or _text_
  formatted = formatted.replace(/\*([^*]+)\*/g, (_, p1) => chalk.italic(p1));
  formatted = formatted.replace(/(?<!\w)_([^_]+)_(?!\w)/g, (_, p1) => chalk.italic(p1));

  // Inline code: `code` - light grey color
  formatted = formatted.replace(/`([^`]+)`/g, (_, p1) => chalk.grey(p1));

  // Links: [text](url) - show text in blue
  formatted = formatted.replace(/\[([^\]]+)\]\([^)]+\)/g, (_, p1) => chalk.blue(p1));

  return formatted;
}

/**
 * Process streaming response from AI
 *
 * @param {AsyncIterator} stream - OpenAI streaming response
 * @returns {Promise<Object>} Collected message with content and tool calls
 */
async function processStreamingResponse(
  stream: Stream<ChatCompletionChunk>
): Promise<{ message: OpenAI.Chat.ChatCompletionMessage }> {
  let contentBuffer = '';
  let toolCalls: OpenAI.Chat.ChatCompletionMessageToolCall[] = [];
  const toolCallsMap: Record<
    number,
    {
      id: string;
      type: 'function';
      function: { name: string; arguments: string };
    }
  > = {};
  let role = 'assistant';
  let printedUpTo = 0;

  try {
    for await (const chunk of stream) {
      if (process.env.DEBUG_STREAMING) {
        console.log('\n[DEBUG] Chunk:', JSON.stringify(chunk, null, 2));
      }

      const delta = chunk.choices[0]?.delta;

      if (!delta) {
        continue;
      }

      if (delta.role) {
        role = delta.role;
      }

      // Collect content and print line by line
      if (delta.content) {
        contentBuffer += delta.content;

        const lastNewlineIndex = contentBuffer.lastIndexOf('\n', contentBuffer.length - 1);

        if (lastNewlineIndex >= printedUpTo) {
          const textToPrint = contentBuffer.substring(printedUpTo, lastNewlineIndex + 1);
          const lines = textToPrint.split('\n');
          for (const line of lines) {
            if (line.trim()) {
              const formatted = formatMarkdown(line);
              console.log(formatted);
            } else if (line === '') {
              console.log();
            }
          }
          printedUpTo = lastNewlineIndex + 1;
        }
      }

      // Collect tool calls
      if (delta.tool_calls) {
        for (const toolCallDelta of delta.tool_calls) {
          const index = toolCallDelta.index;

          if (!toolCallsMap[index]) {
            toolCallsMap[index] = {
              id: '',
              type: 'function',
              function: {
                name: '',
                arguments: '',
              },
            };
          }

          if (toolCallDelta.id) {
            toolCallsMap[index].id = toolCallDelta.id;
          }

          if (toolCallDelta.function) {
            if (toolCallDelta.function.name) {
              toolCallsMap[index].function.name += toolCallDelta.function.name;
            }
            if (toolCallDelta.function.arguments) {
              toolCallsMap[index].function.arguments += toolCallDelta.function.arguments;
            }
          }
        }
      }
    }
  } catch (error) {
    // Log streaming error but continue with what we have
    if (process.env.DEBUG) {
      console.error(chalk.red('\n[Streaming Error]'), (error as Error).message);
    }
  }

  // Print remaining content
  if (printedUpTo < contentBuffer.length) {
    const remainingText = contentBuffer.substring(printedUpTo);
    if (remainingText.trim()) {
      const formatted = formatMarkdown(remainingText);
      console.log(formatted);
    }
  }

  if (contentBuffer.length > 0) {
    console.log(); // Extra newline after AI response
  }

  // Convert toolCallsMap to array
  toolCalls = Object.values(toolCallsMap).filter(
    (tc) => tc.id
  ) as OpenAI.Chat.ChatCompletionMessageToolCall[];

  const message: OpenAI.Chat.ChatCompletionMessage = {
    role: role as 'assistant',
    content: contentBuffer.trim() || null,
    refusal: null,
  };

  if (toolCalls.length > 0) {
    message.tool_calls = toolCalls;
  }

  return { message };
}

/**
 * Process intent parser conversation
 *
 * @param {string} userRequest - User's natural language request
 * @param {Object} options - Options
 * @param {string} [options.modelName] - Model to use
 * @param {Object} [options.conversationContext] - Previous conversation context
 * @returns {Promise<Object>} Intent parser result
 */
export async function processIntentParserRequest(
  userRequest: string,
  options: IntentParserOptions = {}
): Promise<IntentParserResult> {
  const { modelName, conversationContext } = options;
  const client = createIntentParserClient(modelName);
  const modelConfig = getModelConfig(modelName);
  const config = getConfig();

  const systemMessage = buildIntentParserSystemPrompt();
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemMessage },
  ];

  // Add conversation context if continuing
  if (conversationContext && conversationContext.messages) {
    messages.push(...conversationContext.messages);
  }

  messages.push({ role: 'user', content: userRequest });

  try {
    const requestParams: OpenAI.Chat.ChatCompletionCreateParamsStreaming = {
      model: modelConfig.model,
      messages,
      tools: intentParserFunctionSchemas,
      tool_choice: 'auto',
      stream: true,
    };

    // Set temperature based on model
    if (modelConfig.temperature !== undefined && modelConfig.temperature !== 1) {
      requestParams.temperature = modelConfig.temperature;
    } else if (modelConfig.temperature === 1) {
      requestParams.temperature = 1;
    }

    if (modelConfig.model.startsWith('gpt-')) {
      (requestParams as unknown as Record<string, unknown>).max_completion_tokens = 2000;
    } else {
      (requestParams as unknown as Record<string, unknown>).max_tokens = 2000;
    }

    const stream = await client.chat.completions.create(requestParams);
    const { message } = await processStreamingResponse(stream);

    // Check if AI wants to pass parsed requirements
    if (message.tool_calls && message.tool_calls.length > 0) {
      const toolCall = message.tool_calls[0];
      if (toolCall.function.name === 'parse_requirements') {
        const params = JSON.parse(toolCall.function.arguments);

        // Apply constraints and defaults
        const validatedParams = applyConstraints(params, config);

        return {
          approved: true,
          params: validatedParams as unknown as Record<string, unknown>,
          needsMoreInfo: false,
        };
      } else if (toolCall.function.name === 'confirm_send_playlist') {
        const args = JSON.parse(toolCall.function.arguments);
        const { confirmPlaylistForSending } = await import('../utilities/playlist-send');

        // Validate and confirm the playlist
        const confirmation = await confirmPlaylistForSending(args.filePath, args.deviceName);

        if (!confirmation.success) {
          // Check if this is a device selection needed case
          if (confirmation.needsDeviceSelection) {
            // Multiple devices available - ask user to choose
            console.log();
            return {
              approved: false,
              needsMoreInfo: true,
              question: confirmation.message || 'Please choose a device',
              messages: [...messages, message],
            };
          }

          // File not found or playlist invalid - ask user for more info
          console.log();
          return {
            approved: false,
            needsMoreInfo: true,
            question: confirmation.message || `Failed to send playlist: ${confirmation.error}`,
            messages: [...messages, message],
          };
        }

        // Playlist is valid - return as approved with send_playlist action
        return {
          approved: true,
          params: {
            action: 'send_playlist',
            filePath: confirmation.filePath,
            deviceName: confirmation.deviceName,
            playlist: confirmation.playlist,
            message: confirmation.message,
          } as unknown as Record<string, unknown>,
          needsMoreInfo: false,
        };
      }
    }

    // AI is asking for more information
    return {
      approved: false,
      needsMoreInfo: true,
      question: message.content || undefined,
      messages: [...messages, message],
    };
  } catch (error) {
    throw new Error(`Intent parser failed: ${(error as Error).message}`);
  }
}

export { buildIntentParserSystemPrompt, intentParserFunctionSchemas };
