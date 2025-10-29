/**
 * Orchestrator - Function Calling Declarations
 * Contains function schemas and orchestration logic for AI-driven playlist building
 */

const chalk = require('chalk');

/**
 * Function schemas for playlist building
 */
const functionSchemas = [
  {
    type: 'function',
    function: {
      name: 'query_requirement',
      description:
        'Query data for a requirement. Supports build_playlist (blockchain NFTs), query_address (all NFTs from address), and fetch_feed (feed playlists) types.',
      parameters: {
        type: 'object',
        properties: {
          requirement: {
            type: 'object',
            description:
              'The COMPLETE requirement object from params. Pass ALL fields from the original requirement without modification, truncation, or omission.',
            properties: {
              type: {
                type: 'string',
                enum: ['build_playlist', 'fetch_feed', 'query_address'],
                description: 'Type of requirement',
              },
              blockchain: {
                type: 'string',
                description: 'Blockchain network (REQUIRED for build_playlist)',
              },
              contractAddress: {
                type: 'string',
                description:
                  'FULL NFT contract address without truncation (REQUIRED for build_playlist)',
              },
              tokenIds: {
                type: 'array',
                description:
                  'COMPLETE array of ALL token IDs without truncation (REQUIRED for build_playlist)',
                items: {
                  type: 'string',
                },
              },
              ownerAddress: {
                type: 'string',
                description:
                  'Owner wallet address (0x... for Ethereum, tz... for Tezos) - REQUIRED for query_address',
              },
              playlistName: {
                type: 'string',
                description: 'Feed playlist name (REQUIRED for fetch_feed)',
              },
              quantity: {
                type: 'number',
                description:
                  'Maximum number of items to fetch (optional for all types, enables random selection for query_address)',
              },
            },
            required: ['type'],
          },
          duration: {
            type: 'number',
            description: 'Display duration per item in seconds',
          },
        },
        required: ['requirement', 'duration'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_feed_playlist',
      description:
        'Search for playlists across ALL configured feeds by name. Uses fuzzy matching to automatically find and return the BEST matching playlist name.',
      parameters: {
        type: 'object',
        properties: {
          playlistName: {
            type: 'string',
            description: 'Playlist name to search for',
          },
        },
        required: ['playlistName'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'fetch_feed_playlist_items',
      description:
        'Fetch items from a specific feed playlist by NAME (not ID). Pass the exact playlist name you selected. Items will be shuffled and randomly selected based on quantity.',
      parameters: {
        type: 'object',
        properties: {
          playlistName: {
            type: 'string',
            description: 'Exact playlist name (title) selected from search results',
          },
          quantity: {
            type: 'number',
            description: 'Number of random items to fetch (will be shuffled)',
          },
          duration: {
            type: 'number',
            description: 'Duration per item in seconds',
          },
        },
        required: ['playlistName', 'quantity', 'duration'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'build_playlist',
      description:
        'Build a DP1 v1.0.0 compliant playlist from collected NFT items. You MUST pass the items array containing all collected NFT items from query_requirement calls.',
      parameters: {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            description:
              'Array of ALL DP1 playlist items collected from query_requirement calls. CRITICAL: You MUST include this parameter with all collected items.',
            items: {
              type: 'object',
            },
          },
          title: {
            type: ['string', 'null'],
            description:
              'Playlist title. Pass null (not the string "null") for auto-generation. If user did not provide a title in settings, pass null.',
          },
          slug: {
            type: ['string', 'null'],
            description:
              'Playlist slug. Pass null (not the string "null") for auto-generation. If user did not provide a slug in settings, pass null.',
          },
          shuffle: {
            type: 'boolean',
            description: 'Whether to shuffle the items before building playlist',
          },
        },
        required: ['items'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'send_to_device',
      description:
        'Send completed playlist to an FF1 device for display. Pass the EXACT playlist object that was verified.',
      parameters: {
        type: 'object',
        properties: {
          playlist: {
            type: 'object',
            description:
              'Complete DP1 playlist object (must be the EXACT object that was verified)',
          },
          deviceName: {
            type: ['string', 'null'],
            description: 'Device name (pass null for first device)',
          },
        },
        required: ['playlist'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'resolve_domains',
      description:
        'Resolve blockchain domain names to their wallet addresses. Supports ENS (.eth) and TNS (.tez) domains. Processes domains in batch for efficiency.',
      parameters: {
        type: 'object',
        properties: {
          domains: {
            type: 'array',
            description: 'Array of domain names to resolve (e.g., ["vitalik.eth", "alice.tez"])',
            items: {
              type: 'string',
            },
          },
          displayResults: {
            type: 'boolean',
            description: 'Whether to display resolution results to user (default: true)',
          },
        },
        required: ['domains'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'verify_playlist',
      description:
        'Verify a playlist against the DP-1 specification before sending it to a device. Pass the EXACT playlist object returned from build_playlist. This function MUST be called before send_to_device to ensure the playlist is valid. Returns validation errors if the playlist does not conform to DP-1 standards.',
      parameters: {
        type: 'object',
        properties: {
          playlist: {
            type: 'object',
            description:
              'Complete DP1 playlist object to verify (must be the EXACT object returned from build_playlist)',
          },
        },
        required: ['playlist'],
      },
    },
  },
];

// Store playlistMap across function calls
let globalPlaylistMap = {};

/**
 * Execute a function call
 *
 * @param {string} functionName - Function name
 * @param {Object} args - Function arguments
 * @returns {Promise<any>} Function result
 */
async function executeFunction(functionName, args) {
  const utilities = require('../utilities');

  switch (functionName) {
    case 'query_requirement':
      return await utilities.queryRequirement(args.requirement, args.duration);

    case 'search_feed_playlist': {
      const result = await utilities.feedFetcher.searchFeedPlaylists(args.playlistName);
      // Store playlistMap for later lookup
      if (result.playlistMap) {
        globalPlaylistMap = result.playlistMap;
      }
      // Return best match found by fuzzy matching
      return {
        success: result.success,
        bestMatch: result.bestMatch,
        searchTerm: result.searchTerm,
        error: result.error,
        message: result.bestMatch
          ? `Found best matching playlist: "${result.bestMatch}"`
          : undefined,
      };
    }

    case 'fetch_feed_playlist_items':
      return await utilities.feedFetcher.fetchPlaylistItems(
        args.playlistName,
        args.quantity,
        args.duration,
        globalPlaylistMap
      );

    case 'build_playlist': {
      let items = args.items;
      // Shuffle items if requested
      if (args.shuffle) {
        items = utilities.shuffleArray([...items]);
      }
      // Handle string "null" and convert to actual null for auto-generation
      const title = args.title === 'null' || args.title === null ? null : args.title;
      const slug = args.slug === 'null' || args.slug === null ? null : args.slug;
      return await utilities.buildDP1Playlist(items, title, slug);
    }

    case 'send_to_device':
      return await utilities.sendToDevice(args.playlist, args.deviceName);

    case 'resolve_domains':
      return await utilities.resolveDomains(args);

    case 'verify_playlist': {
      const { verifyPlaylist } = require('../utilities/functions');
      return await verifyPlaylist(args);
    }

    default:
      throw new Error(`Unknown function: ${functionName}`);
  }
}

/**
 * Build system prompt for AI orchestrator
 *
 * @param {Object} params - Validated parameters from intent parser
 * @returns {string} System prompt
 */
function buildOrchestratorSystemPrompt(params) {
  const { requirements, playlistSettings } = params;

  const requirementsText = requirements
    .map((req, i) => {
      if (req.type === 'fetch_feed') {
        return `${i + 1}. Fetch ${req.quantity || 5} items from playlist "${req.playlistName}"`;
      } else if (req.type === 'query_address') {
        return `${i + 1}. Query ${req.quantity ? req.quantity + ' random ' : 'all '}tokens from address ${req.ownerAddress}`;
      } else {
        return (
          `${i + 1}. ${req.blockchain} - ${req.tokenIds?.length || 0} tokens` +
          (req.contractAddress ? ` from ${req.contractAddress.substring(0, 10)}...` : '')
        );
      }
    })
    .join('\n');

  const hasDevice = playlistSettings.deviceName !== undefined;
  const sendStep = hasDevice
    ? `6) If verification passed → you MUST call send_to_device({ playlist: <the_playlist_object>, deviceName: "${playlistSettings.deviceName || 'first-device'}" }) before finishing.
   CRITICAL: Pass the playlist object, not empty {}.`
    : `6) Verification passed → you're done. Do not send to device.`;

  return `SYSTEM: FF1 Orchestrator (Function-Calling)

ROLE
- Execute parsed requirements deterministically and build a DP‑1 playlist. Keep outputs concise and operational.

REQUIREMENTS
${requirementsText}

PLAYLIST SETTINGS
- durationPerItem: ${playlistSettings.durationPerItem || 10}
- title: ${playlistSettings.title || 'auto'}
- slug: ${playlistSettings.slug || 'auto'}
- preserveOrder: ${playlistSettings.preserveOrder !== false ? 'true' : 'false'}
${hasDevice ? `- deviceName: ${playlistSettings.deviceName || 'first-device'}` : ''}

REASONING (private scratchpad)
- Use Plan→Check→Act→Reflect for each step.
- Default to a single deterministic path.
- Only branch in two cases:
  1) Multiple plausible feed candidates after search.
  2) Verification failure requiring targeted repair.
- When branching, keep BEAM_WIDTH=2, DEPTH_LIMIT=2.
- Score candidates by: correctness, coverage, determinism, freshness, cost.
- Keep reasoning hidden; publicly print one status sentence before each tool call.

KEY RULES
- Domains: ".eth" and ".tez" are OWNER DOMAINS. Resolve to addresses before querying ownership.
- Do not fabricate or truncate contract addresses or tokenIds.
- Title/slug: when calling build_playlist, pass actual null (not string "null"):
  • If title provided in settings → pass settings.title as-is
  • If title NOT provided → pass null (NOT the string "null")
  • If slug provided in settings → pass settings.slug as-is
  • If slug NOT provided → pass null (NOT the string "null")
- Shuffle: set shuffle = ${playlistSettings.preserveOrder === false ? 'true' : 'false'}.
- Build → Verify${hasDevice ? ' → Send' : ''} (MANDATORY to verify before${hasDevice ? ' sending' : ' finishing'}).

DECISION LOOP
1) For each requirement in order:
   - build_playlist: call query_requirement(requirement, duration=${playlistSettings.durationPerItem || 10}).
   - query_address:
     • if ownerAddress endsWith .eth/.tez → resolve_domains([domain]); if resolved → use returned address; if not → mark failed and continue.
     • if ownerAddress is 0x…/tz… → call query_requirement(requirement, duration=${playlistSettings.durationPerItem || 10}).
   - fetch_feed: search_feed_playlist(name) → take bestMatch → fetch_feed_playlist_items(bestMatch, quantity, duration=${playlistSettings.durationPerItem || 10}).
   - Collect items across steps in an array (let's call it collectedItems).
2) If zero items → explain briefly and finish.
3) If some requirements failed and interactive mode → ask user; otherwise proceed with available items.
4) Call build_playlist({ items: collectedItems, title: settings.title || null, slug: settings.slug || null, shuffle }).
   CRITICAL: 
   - You MUST pass the items parameter with ALL collected items
   - Pass actual null values for title/slug, NOT the string "null"
   - If title/slug not in settings, pass null
   Store the returned playlist object in a variable.
5) Call verify_playlist({ playlist: <the_playlist_object_from_step_4> }).
   CRITICAL: You MUST pass the playlist object. Don't pass empty object {}.
   If invalid ≤3 attempts, rebuild only what errors require; otherwise stop with clear error.
${sendStep}

OUTPUT RULES
- Before each function call, print exactly one sentence: "→ I'm …" describing the action.
- Then call exactly one function with JSON arguments.
- No chain‑of‑thought or extra narration; keep public output minimal.

STOPPING CONDITIONS
- Finish only after: (items built → playlist built → verified${hasDevice ? ' → sent' : ''}) or after explaining why no progress is possible.`;
}

/**
 * Build playlist using AI orchestration (natural language path)
 *
 * @param {Object} params - Validated parameters from intent parser
 * @param {Object} options - Build options
 * @param {boolean} options.interactive - Whether in interactive mode (can ask user)
 * @returns {Promise<Object>} Result with playlist
 */
async function buildPlaylistWithAI(params, options = {}) {
  const {
    modelName,
    verbose = false,
    outputPath = 'playlist.json',
    interactive = false,
    conversationContext = null,
  } = options;

  const OpenAI = require('openai');
  const { getModelConfig } = require('../config');

  const modelConfig = getModelConfig(modelName);

  const client = new OpenAI({
    apiKey: modelConfig.apiKey,
    baseURL: modelConfig.baseURL,
    timeout: modelConfig.timeout,
    maxRetries: modelConfig.maxRetries,
  });

  let messages;

  if (conversationContext && conversationContext.messages) {
    // Continue from existing conversation
    messages = [...conversationContext.messages];
    messages.push({
      role: 'user',
      content: conversationContext.userResponse,
    });
  } else {
    // Start new conversation
    const systemPrompt = buildOrchestratorSystemPrompt(params);
    const interactiveNote = interactive
      ? '\n\nYou are in INTERACTIVE MODE. You can ask the user for confirmation when some requirements fail.'
      : '\n\nYou are in NON-INTERACTIVE MODE. If some requirements fail, automatically proceed with available items without asking.';

    // Build detailed user message with the actual requirements
    const requirementsDetail = params.requirements
      .map((req, i) => {
        if (req.type === 'fetch_feed') {
          return `${i + 1}. Fetch ${req.quantity || 5} items from playlist "${req.playlistName}"`;
        } else if (req.type === 'query_address') {
          return `${i + 1}. Query tokens from address:\n   - ownerAddress: "${req.ownerAddress}"${req.quantity ? `\n   - quantity: ${req.quantity} (random selection)` : '\n   - quantity: all tokens'}`;
        } else {
          return `${i + 1}. Query tokens:\n   - blockchain: "${req.blockchain}"\n   - contractAddress: "${req.contractAddress}"\n   - tokenIds: ${JSON.stringify(req.tokenIds)}\n   - quantity: ${req.quantity}`;
        }
      })
      .join('\n');

    messages = [
      { role: 'system', content: systemPrompt + interactiveNote },
      {
        role: 'user',
        content: `Execute these requirements now. Use the EXACT values provided - do not modify or make up different values:\n\n${requirementsDetail}\n\nStart by calling query_requirement for each requirement with these EXACT values.`,
      },
    ];
  }

  let finalPlaylist = null;
  let iterationCount = 0;
  let collectedItems = [];
  let verificationFailures = 0;
  let sentToDevice = false;
  const maxIterations = 20;
  const maxVerificationRetries = 3;

  while (iterationCount < maxIterations) {
    iterationCount++;

    const requestParams = {
      model: modelConfig.model,
      messages,
      tools: functionSchemas,
      tool_choice: 'auto',
      stream: false,
    };

    if (modelConfig.temperature !== undefined) {
      requestParams.temperature = modelConfig.temperature;
    }

    if (modelConfig.model.startsWith('gpt-')) {
      requestParams.max_completion_tokens = 4000;
    } else {
      requestParams.max_tokens = 4000;
    }

    const response = await client.chat.completions.create(requestParams);
    const message = response.choices[0].message;

    // Gemini workaround: If AI finished without calling build_playlist despite having items
    // This handles cases where:
    // - finish_reason is 'stop' but no content/tool_calls
    // - finish_reason includes 'MALFORMED_FUNCTION_CALL' (Gemini tried but failed)
    // - Any other case where we have items but no playlist
    if (verbose) {
      console.log(chalk.gray(`→ finish_reason: ${response.choices[0].finish_reason}`));
      console.log(chalk.gray(`→ has content: ${!!message.content}`));
      console.log(chalk.gray(`→ has tool_calls: ${!!message.tool_calls}`));
      console.log(
        chalk.gray(`→ collectedItems: ${collectedItems.length}, finalPlaylist: ${!!finalPlaylist}`)
      );
    }

    if (!message.tool_calls && collectedItems.length > 0 && !finalPlaylist) {
      const finishReason = response.choices[0].finish_reason || '';

      // If Gemini keeps failing with MALFORMED_FUNCTION_CALL, call build_playlist directly
      if (finishReason.includes('MALFORMED_FUNCTION_CALL') || finishReason.includes('filter')) {
        if (verbose) {
          console.log(
            chalk.yellow(`⚠️  AI's function call is malformed - calling build_playlist directly...`)
          );
        }

        // Call build_playlist directly with the collected items
        try {
          const utilities = require('../utilities');
          const result = await utilities.buildDP1Playlist(
            collectedItems,
            params.playlistSettings?.title || null,
            params.playlistSettings?.slug || null
          );

          if (result.dpVersion) {
            finalPlaylist = result;
            const { savePlaylist } = require('../utils');
            await savePlaylist(result, outputPath);

            if (verbose) {
              console.log(chalk.green(`✓ Successfully built playlist directly`));
            }
            break; // Exit the loop
          }
        } catch (error) {
          if (verbose) {
            console.log(chalk.red(`✗ Failed to build playlist directly: ${error.message}`));
          }
        }
      } else if (iterationCount < maxIterations - 1) {
        // Try one more time with a system message
        if (verbose) {
          console.log(
            chalk.yellow(
              `⚠️  AI stopped without calling build_playlist (reason: ${finishReason}) - forcing it to continue...`
            )
          );
        }
        messages.push({
          role: 'system',
          content: `CRITICAL: You have collected ${collectedItems.length} items but have NOT called build_playlist yet. You MUST call the build_playlist function NOW with these items.`,
        });
        continue; // Go to next iteration
      }
    }

    messages.push(message);

    // Always print AI content when present
    if (message.content) {
      console.log(chalk.cyan(message.content));
    }

    if (verbose) {
      console.log(chalk.gray(`\nIteration ${iterationCount}:`));
    }

    // Execute function calls if any
    if (message.tool_calls && message.tool_calls.length > 0) {
      if (verbose) {
        console.log(chalk.gray(`→ Executing ${message.tool_calls.length} function(s)...`));
      }

      for (const toolCall of message.tool_calls) {
        const functionName = toolCall.function.name;
        const args = JSON.parse(toolCall.function.arguments);

        if (verbose) {
          console.log(chalk.gray(`\n  • Function: ${chalk.bold(functionName)}`));
          console.log(
            chalk.gray(`    Input: ${JSON.stringify(args, null, 2).split('\n').join('\n    ')}`)
          );
        }

        try {
          const result = await executeFunction(functionName, args);

          if (verbose) {
            console.log(
              chalk.gray(
                `    Output: ${JSON.stringify(result, null, 2).split('\n').join('\n    ')}`
              )
            );
          }

          // Track collected items from query_requirement
          if (functionName === 'query_requirement' && Array.isArray(result)) {
            collectedItems = collectedItems.concat(result);
            if (verbose) {
              console.log(
                chalk.green(
                  `    ✓ Collected ${result.length} items (total: ${collectedItems.length})`
                )
              );
            }
          }

          // Track final playlist
          if (functionName === 'build_playlist' && result.dpVersion) {
            finalPlaylist = result;

            // Save playlist
            const { savePlaylist } = require('../utils');
            await savePlaylist(result, outputPath);
          }

          // Track device sending
          if (functionName === 'send_to_device') {
            if (result && result.success) {
              sentToDevice = true;
              if (verbose) {
                console.log(chalk.green(`✓ Playlist sent to device`));
              }
            }
          }

          // Handle verification results
          if (functionName === 'verify_playlist') {
            if (result.valid) {
              if (verbose) {
                console.log(chalk.green(`✓ Playlist verification passed`));
              }
              // Check if verification passed - don't break yet, let AI continue (may need to call send_to_device)
              // The loop will naturally end when AI has no more tool calls or we hit iteration limit
              // if (verificationPassed) {
              //   break;
              // }
            } else {
              verificationFailures++;
              if (verbose) {
                console.log(
                  chalk.yellow(
                    `⚠️  Playlist verification failed (attempt ${verificationFailures}/${maxVerificationRetries})`
                  )
                );
              }
              // Check if we've exceeded max retries
              if (verificationFailures >= maxVerificationRetries) {
                if (verbose) {
                  console.log(
                    chalk.red(
                      `✗ Playlist validation failed after ${maxVerificationRetries} retries`
                    )
                  );
                }
                return {
                  success: false,
                  error: `Playlist validation failed: ${result.error}`,
                  details: result.details,
                  playlist: null,
                };
              }
              // Add verification error to messages so AI can fix it
              messages.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                content: JSON.stringify({
                  valid: false,
                  error: result.error,
                  details: result.details,
                  message: `Playlist validation failed. Please fix the issues and rebuild the playlist.\n\nErrors: ${JSON.stringify(result.details, null, 2)}`,
                }),
              });
              // Ask AI to fix and rebuild
              const fixPrompt = `The playlist validation failed with these errors:\n\n${result.error}\n\nDetails:\n${result.details ? result.details.map((d) => `- ${d.path}: ${d.message}`).join('\n') : 'N/A'}\n\nPlease fix these issues and rebuild the playlist. You can rebuild it by calling build_playlist again with corrected data.`;
              messages.push({
                role: 'user',
                content: fixPrompt,
              });
              continue; // Don't finish, let AI try again
            }
          }

          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify(result),
          });
        } catch (error) {
          if (verbose) {
            console.log(chalk.red(`    Error: ${error.message}`));
          }
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify({ error: error.message, success: false }),
          });
        }
      }
      // Check if verification passed - don't break yet, let AI continue (may need to call send_to_device)
      // The loop will naturally end when AI has no more tool calls or we hit iteration limit
      // if (verificationPassed) {
      //   break;
      // }
    } else {
      // AI has finished
      if (verbose) {
        console.log(chalk.gray('\n→ AI has finished (no more tool calls)'));
        if (!message.content) {
          console.log(chalk.red('→ AI sent NO content and NO tool calls!'));
        }
      }
      if (finalPlaylist) {
        // Deterministic fallback: if user requested device sending but AI forgot,
        // send here before returning (only if NOT already sent by AI)
        try {
          const deviceNameRequested =
            params.playlistSettings && params.playlistSettings.deviceName !== undefined;
          if (deviceNameRequested && !sentToDevice) {
            console.log(chalk.cyan('\n→ Sending to device...'));
            const utilities = require('../utilities');
            const sendResult = await utilities.sendToDevice(
              finalPlaylist,
              params.playlistSettings.deviceName || null
            );
            if (sendResult && sendResult.success) {
              sentToDevice = true;
              console.log(chalk.green(`✓ Sent to device: ${sendResult.deviceName}`));
            } else {
              // Device sending failed - this is a failure condition
              return {
                success: false,
                error: `Failed to send playlist to device: ${sendResult?.error || 'Unknown error'}`,
                playlist: finalPlaylist,
                sentToDevice: false,
              };
            }
          }
        } catch (error) {
          return {
            success: false,
            error: `Failed to send to device: ${error && error.message ? error.message : error}`,
            playlist: finalPlaylist,
            sentToDevice: false,
          };
        }

        // Publish to feed server if requested
        let publishResult = null;
        if (params.playlistSettings && params.playlistSettings.feedServer) {
          console.log(chalk.cyan('\n→ Publishing to feed server...'));
          try {
            const { publishPlaylist } = require('../utilities/playlist-publisher');
            publishResult = await publishPlaylist(
              outputPath,
              params.playlistSettings.feedServer.baseUrl,
              params.playlistSettings.feedServer.apiKey
            );

            if (publishResult.success) {
              console.log(chalk.green(`✓ Published to feed server`));
              if (publishResult.playlistId) {
                console.log(chalk.gray(`   Playlist ID: ${publishResult.playlistId}`));
              }
              if (publishResult.feedServer) {
                console.log(chalk.gray(`   Server: ${publishResult.feedServer}`));
              }
            } else {
              console.error(chalk.red(`✗ Failed to publish: ${publishResult.error}`));
              if (publishResult.message) {
                console.error(chalk.gray(`   ${publishResult.message}`));
              }
            }
          } catch (error) {
            console.error(chalk.red(`✗ Failed to publish: ${error.message}`));
            if (verbose) {
              console.error(chalk.gray(error.stack));
            }
          }
        }

        return {
          playlist: finalPlaylist,
          sentToDevice,
          published: publishResult?.success || false,
          publishResult,
        };
      }
      // AI finished without building a playlist - check if it provided an explanation
      if (message.content) {
        // Check if AI is asking for confirmation (interactive mode)
        const isAskingConfirmation =
          interactive &&
          message.content.toLowerCase().includes('would you like') &&
          (message.content.toLowerCase().includes('proceed') ||
            message.content.toLowerCase().includes('build') ||
            message.content.toLowerCase().includes('cancel'));

        if (isAskingConfirmation) {
          // Return with needsConfirmation flag
          return {
            needsConfirmation: true,
            question: message.content,
            messages: messages,
            params: params,
          };
        }

        // AI has explained why no playlist was built (e.g., no matching items found)
        // Content already printed above, just return the result
        return {
          success: false,
          message: message.content,
          playlist: null,
        };
      }
      break;
    }
  }

  if (!finalPlaylist) {
    throw new Error(
      'Failed to build playlist - No items found or AI did not complete the task. Check if the requirements match any available data.'
    );
  }

  return { playlist: finalPlaylist, sentToDevice };
}

module.exports = {
  functionSchemas,
  executeFunction,
  buildOrchestratorSystemPrompt,
  buildPlaylistWithAI,
};
