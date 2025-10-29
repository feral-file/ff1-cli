import fs from 'fs';
import path from 'path';
import type {
  Config,
  ModelConfig,
  BrowserConfig,
  PlaylistConfig,
  FeedConfig,
  FF1DeviceConfig,
  ValidationResult,
} from './types';

/**
 * Load configuration from config.json or environment variables
 * Priority: config.json > .env > defaults
 *
 * @returns {Object} Configuration object with model settings
 * @returns {string} returns.defaultModel - Name of the default model to use
 * @returns {Object} returns.models - Available models configuration
 * @returns {number} returns.defaultDuration - Default duration per item in seconds
 */
function loadConfig(): Config {
  const configPath = path.join(process.cwd(), 'config.json');

  // Default configuration supporting Grok as default
  const defaultConfig: Config = {
    defaultModel: process.env.DEFAULT_MODEL || 'grok',
    models: {
      grok: {
        apiKey: process.env.GROK_API_KEY || '',
        baseURL: process.env.GROK_API_BASE_URL || 'https://api.x.ai/v1',
        model: process.env.GROK_MODEL || 'grok-beta',
        availableModels: ['grok-beta', 'grok-2-1212', 'grok-2-vision-1212'],
        timeout: parseInt(process.env.TIMEOUT || '30000', 10),
        maxRetries: parseInt(process.env.MAX_RETRIES || '3', 10),
        temperature: parseFloat(process.env.TEMPERATURE || '0.3'),
        maxTokens: parseInt(process.env.MAX_TOKENS || '4000', 10),
        supportsFunctionCalling: true,
      },
      chatgpt: {
        apiKey: process.env.OPENAI_API_KEY || '',
        baseURL: 'https://api.openai.com/v1',
        model: 'gpt-4o',
        availableModels: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'],
        timeout: 30000,
        maxRetries: 3,
        temperature: 0.3,
        maxTokens: 4000,
        supportsFunctionCalling: true,
      },
      gemini: {
        apiKey: process.env.GEMINI_API_KEY || '',
        baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
        model: 'gemini-2.0-flash-exp',
        availableModels: ['gemini-2.0-flash-exp', 'gemini-1.5-pro', 'gemini-1.5-flash'],
        timeout: 30000,
        maxRetries: 3,
        temperature: 0.3,
        maxTokens: 4000,
        supportsFunctionCalling: true,
      },
    },
    defaultDuration: parseInt(process.env.DEFAULT_DURATION || '10', 10),
    browser: {
      timeout: parseInt(process.env.BROWSER_TIMEOUT || '90000', 10),
      sanitizationLevel: process.env.SANITIZATION_LEVEL || 'medium',
    },
    feed: {
      baseURLs: process.env.FEED_BASE_URLS
        ? process.env.FEED_BASE_URLS.split(',')
        : ['https://feed.feralfile.com/api/v1'],
    },
  };

  // Try to load config.json if it exists
  if (fs.existsSync(configPath)) {
    try {
      const fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as Partial<Config>;

      // Deep merge models configuration
      const mergedModels = { ...defaultConfig.models };
      if (fileConfig.models) {
        Object.keys(fileConfig.models).forEach((modelName) => {
          mergedModels[modelName] = {
            ...(defaultConfig.models[modelName] || {}),
            ...fileConfig.models![modelName],
          };
        });
      }

      // Merge with defaults, file config takes precedence
      return {
        ...defaultConfig,
        ...fileConfig,
        models: mergedModels,
      };
    } catch (_error) {
      console.warn('Warning: Failed to parse config.json, using defaults');
      return defaultConfig;
    }
  }

  // Return default config if no file exists
  return defaultConfig;
}

/**
 * Get current configuration
 *
 * @returns {Object} Current configuration
 */
export function getConfig(): Config {
  return loadConfig();
}

/**
 * Convert sanitization level string to numeric value
 *
 * @param {string|number} level - Sanitization level ('none', 'low', 'medium', 'high') or number (0-3)
 * @returns {number} Numeric level (0 = none, 1 = low, 2 = medium, 3 = high)
 */
export function sanitizationLevelToNumber(level: string | number): number {
  if (typeof level === 'number') {
    return level;
  }

  const levelMap: Record<string, number> = {
    none: 0,
    low: 1,
    medium: 2,
    high: 3,
  };

  return levelMap[level] !== undefined ? levelMap[level] : 2; // Default to medium (2)
}

/**
 * Get browser configuration
 *
 * @returns {Object} Browser configuration
 * @returns {number} returns.timeout - Browser timeout in milliseconds
 * @returns {number} returns.sanitizationLevel - Numeric sanitization level (0-3)
 */
export function getBrowserConfig(): { timeout: number; sanitizationLevel: number } {
  const config = getConfig();
  const browserConfig: BrowserConfig = config.browser || {
    timeout: 90000,
    sanitizationLevel: 'medium',
  };

  return {
    timeout: browserConfig.timeout,
    sanitizationLevel: sanitizationLevelToNumber(browserConfig.sanitizationLevel),
  };
}

/**
 * Get playlist configuration including private key for signing
 *
 * @returns {Object} Playlist configuration
 * @returns {string|null} returns.privateKey - Ed25519 private key in base64 format (null if not configured)
 */
export function getPlaylistConfig(): PlaylistConfig {
  const config = getConfig();
  const playlistConfig: Partial<PlaylistConfig> = config.playlist || {};

  return {
    privateKey: playlistConfig.privateKey || process.env.PLAYLIST_PRIVATE_KEY || null,
  };
}

/**
 * Get feed configuration for DP1 feed API
 *
 * Supports both legacy (feed.baseURLs/apiKey) and new (feedServers array) formats.
 *
 * @returns {Object} Feed configuration
 * @returns {string[]} returns.baseURLs - Array of base URLs for feed APIs
 * @returns {string} [returns.apiKey] - Optional API key for authentication (legacy)
 * @returns {Array<Object>} [returns.servers] - Array of feed servers with individual API keys (new)
 */
export function getFeedConfig(): {
  baseURLs: string[];
  apiKey?: string;
  servers?: Array<{ baseUrl: string; apiKey?: string }>;
} {
  const config = getConfig();

  // Check for new feedServers format first
  if (config.feedServers && Array.isArray(config.feedServers) && config.feedServers.length > 0) {
    const baseURLs = config.feedServers.map((server) => server.baseUrl);
    return {
      baseURLs,
      servers: config.feedServers,
    };
  }

  // Fall back to legacy feed format
  const feedConfig: FeedConfig = config.feed || {};

  // Support both legacy baseURL and new baseURLs
  let urls: string[] = [];
  if (feedConfig.baseURLs && Array.isArray(feedConfig.baseURLs)) {
    urls = feedConfig.baseURLs;
  } else if (feedConfig.baseURL) {
    urls = [feedConfig.baseURL];
  } else {
    // Default feed URL
    urls = ['https://feed.feralfile.com/api/v1'];
  }

  return {
    baseURLs: urls,
    apiKey: feedConfig.apiKey,
  };
}

/**
 * Get FF1 device configuration for casting playlists
 *
 * @returns {Object} FF1 device configuration
 * @returns {Array<Object>} returns.devices - Array of configured FF1 devices
 * @returns {string} returns.devices[].host - Device host URL
 * @returns {string} [returns.devices[].apiKey] - Optional device API key
 * @returns {string} [returns.devices[].topicID] - Optional device topic ID
 * @returns {string} [returns.devices[].name] - Optional device name
 */
export function getFF1DeviceConfig(): FF1DeviceConfig {
  const config = getConfig();
  const ff1Devices = config.ff1Devices || { devices: [] };

  return {
    devices: ff1Devices.devices || [],
  };
}

/**
 * Get configuration for a specific model
 *
 * @param {string} [modelName] - Name of the model (defaults to defaultModel from config)
 * @returns {Object} Model configuration
 * @returns {string} returns.apiKey - API key for the model
 * @returns {string} returns.baseURL - Base URL for the API
 * @returns {string} returns.model - Model name/identifier
 * @returns {number} returns.timeout - Request timeout in milliseconds
 * @returns {number} returns.maxRetries - Maximum number of retries
 * @returns {number} returns.temperature - Temperature for generation
 * @returns {number} returns.maxTokens - Maximum tokens for generation
 * @returns {boolean} returns.supportsFunctionCalling - Whether model supports function calling
 * @throws {Error} If model is not configured or doesn't support function calling
 */
export function getModelConfig(modelName?: string): ModelConfig {
  const config = getConfig();
  const selectedModel = modelName || config.defaultModel;

  if (!config.models[selectedModel]) {
    throw new Error(
      `Model "${selectedModel}" is not configured. Available models: ${Object.keys(config.models).join(', ')}`
    );
  }

  const modelConfig = config.models[selectedModel];

  if (!modelConfig.supportsFunctionCalling) {
    throw new Error(`Model "${selectedModel}" does not support function calling`);
  }

  return {
    ...modelConfig,
    defaultDuration: config.defaultDuration,
  };
}

/**
 * Validate configuration for a specific model
 *
 * @param {string} [modelName] - Name of the model to validate
 * @returns {Object} Validation result
 * @returns {boolean} returns.valid - Whether the configuration is valid
 * @returns {Array<string>} returns.errors - List of validation errors
 */
export function validateConfig(modelName?: string): ValidationResult {
  const errors: string[] = [];

  try {
    const config = getConfig();
    const selectedModel = modelName || config.defaultModel;

    if (!config.models[selectedModel]) {
      errors.push(
        `Model "${selectedModel}" is not configured. Available: ${Object.keys(config.models).join(', ')}`
      );
      return { valid: false, errors };
    }

    const modelConfig = config.models[selectedModel];

    if (!modelConfig.apiKey || modelConfig.apiKey === 'your_api_key_here') {
      errors.push(`API key for "${selectedModel}" is missing or not configured`);
    }

    if (!modelConfig.baseURL) {
      errors.push(`Base URL for "${selectedModel}" is missing`);
    }

    if (!modelConfig.model) {
      errors.push(`Model identifier for "${selectedModel}" is not set`);
    }

    if (!modelConfig.supportsFunctionCalling) {
      errors.push(`Model "${selectedModel}" does not support function calling (required)`);
    }

    // Validate browser configuration
    if (config.browser) {
      if (config.browser.timeout && typeof config.browser.timeout !== 'number') {
        errors.push('Browser timeout must be a number');
      }

      const validLevels = ['none', 'low', 'medium', 'high'];
      if (
        config.browser.sanitizationLevel &&
        !validLevels.includes(config.browser.sanitizationLevel as string) &&
        typeof config.browser.sanitizationLevel !== 'number'
      ) {
        errors.push(
          `Invalid browser.sanitizationLevel: "${config.browser.sanitizationLevel}". Must be one of: ${validLevels.join(', ')} or 0-3`
        );
      }
    }

    // Validate playlist configuration (optional, but warn if configured incorrectly)
    if (config.playlist && config.playlist.privateKey) {
      const key = config.playlist.privateKey;
      if (
        key !== 'your_ed25519_private_key_base64_here' &&
        typeof key === 'string' &&
        key.length > 0
      ) {
        // Check if it looks like valid base64
        const base64Regex = /^[A-Za-z0-9+/]+=*$/;
        if (!base64Regex.test(key)) {
          errors.push('playlist.privateKey must be a valid base64-encoded ed25519 private key');
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  } catch (error) {
    errors.push((error as Error).message);
    return { valid: false, errors };
  }
}

/**
 * Create a sample config.json file from config.json.example
 *
 * @returns {Promise<string>} Path to the created config file
 * @throws {Error} If config.json already exists or example file is missing
 */
export async function createSampleConfig(): Promise<string> {
  const configPath = path.join(process.cwd(), 'config.json');
  const examplePath = path.join(process.cwd(), 'config.json.example');

  if (fs.existsSync(configPath)) {
    throw new Error('config.json already exists');
  }

  if (!fs.existsSync(examplePath)) {
    throw new Error('config.json.example not found');
  }

  const exampleConfig = fs.readFileSync(examplePath, 'utf-8');
  fs.writeFileSync(configPath, exampleConfig, 'utf-8');

  return configPath;
}

/**
 * List all available models
 *
 * @returns {Array<string>} List of available model names
 */
export function listAvailableModels(): string[] {
  const config = getConfig();
  return Object.keys(config.models);
}
