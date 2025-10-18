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
  baseURLs?: string[]; // New: array of URLs
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

export interface Config {
  defaultModel: string;
  models: {
    [key: string]: ModelConfig;
  };
  defaultDuration: number;
  browser: BrowserConfig;
  feed: FeedConfig;
  playlist?: PlaylistConfig;
  ff1Devices?: FF1DeviceConfig;
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
}

export interface BuildPlaylistRequirement {
  type: 'build_playlist';
  blockchain: string;
  contractAddress: string;
  tokenIds: string[];
  quantity?: number;
}

export interface QueryAddressRequirement {
  type: 'query_address';
  ownerAddress: string;
  quantity?: number;
}

export interface FetchFeedRequirement {
  type: 'fetch_feed';
  playlistName: string;
  quantity?: number;
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
