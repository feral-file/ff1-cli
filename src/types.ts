/**
 * Type definitions for FF1-CLI
 */

export interface ModelConfig {
  apiKey: string;
  baseURL: string;
  model: string;
  availableModels?: string[];
  timeout: number;
  maxRetries: number;
  temperature: number;
  maxTokens: number;
  supportsFunctionCalling: boolean;
  defaultDuration?: number;
}

export interface BrowserConfig {
  timeout: number;
  sanitizationLevel: string | number;
}

export interface PlaylistConfig {
  privateKey: string | null;
}

export interface FeedConfig {
  baseURL?: string; // Legacy: single URL
  baseURLs?: string[]; // Legacy: array of URLs
  apiKey?: string; // Legacy: single API key for all servers
}

export interface FeedServer {
  baseUrl: string; // Feed server base URL
  apiKey?: string; // Optional API key for this server
}

export interface FF1Device {
  host: string;
  apiKey?: string;
  topicID?: string;
  name?: string;
}

export interface FF1DeviceConfig {
  devices: FF1Device[];
}

export interface IndexerConfig {
  endpoint: string;
  apiKey?: string;
}

export interface Config {
  defaultModel: string;
  models: {
    [key: string]: ModelConfig;
  };
  defaultDuration: number;
  browser: BrowserConfig;
  feed?: FeedConfig; // Legacy
  feedServers?: FeedServer[]; // New: array of feed servers with individual API keys
  playlist?: PlaylistConfig;
  ff1Devices?: FF1DeviceConfig;
  indexer?: IndexerConfig;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export interface PlaylistItem {
  blockchain: string;
  tokenID: string;
  duration?: number;
  [key: string]: unknown;
}

export interface Playlist {
  version: string;
  title: string;
  description?: string;
  slug?: string;
  items: PlaylistItem[];
  [key: string]: unknown;
}

export interface PlaylistSettings {
  title: string | null;
  slug: string | null;
  durationPerItem: number;
  preserveOrder: boolean;
  deviceName?: string;
  feedServer?: { baseUrl: string; apiKey?: string };
}

export interface BuildPlaylistRequirement {
  type: 'build_playlist';
  blockchain: string;
  contractAddress: string;
  tokenIds: string[];
  quantity?: number | string;
}

export interface QueryAddressRequirement {
  type: 'query_address';
  ownerAddress: string;
  quantity?: number | string;
}

export interface FetchFeedRequirement {
  type: 'fetch_feed';
  playlistName: string;
  quantity?: number | string;
}

export type Requirement = BuildPlaylistRequirement | QueryAddressRequirement | FetchFeedRequirement;

export interface BuildPlaylistParams {
  requirements: Requirement[];
  playlistSettings?: Partial<PlaylistSettings>;
}

export interface BuildPlaylistOptions {
  verbose?: boolean;
  outputPath?: string;
  modelName?: string;
  interactive?: boolean;
}

export interface BuildPlaylistResult {
  success: boolean;
  playlist?: Playlist;
  error?: string;
  [key: string]: unknown;
}

export interface WorkflowStatus {
  workflow_id: string;
  run_id: string;
  status: string;
  start_time?: string;
  close_time?: string;
  execution_time_ms?: number;
}

export interface PollingResult {
  success: boolean;
  completed?: boolean;
  timedOut?: boolean;
  status?: string;
  error?: string;
}
