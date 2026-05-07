/**
 * Ensures nft-indexer media and mapping logic matches ff-indexer-v2 GraphQL:
 * `display` + unified `media_assets`, and job-based status.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const nftIndexer = require('../src/utilities/nft-indexer');

/**
 * Minimal `Response` stub for tests. `nft-indexer` only reads `ok`, `status`, and `json()`.
 */
function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as Response;
}

test('getBestMediaUrl: display.animation_url takes precedence', () => {
  const { getBestMediaUrl } = nftIndexer;
  const media = getBestMediaUrl(
    {
      animation_url: 'https://example.com/animation.mp4',
      image_url: 'https://example.com/image.png',
    },
    [{ source_url: 'https://cdn.example/fallback.mp4', variants: {} }]
  );
  assert.equal(media.url, 'https://example.com/animation.mp4');
  assert.equal(media.thumbnail, 'https://example.com/image.png');
});

test('getBestMediaUrl: falls back to media asset source_url when no animation_url', () => {
  const { getBestMediaUrl } = nftIndexer;
  const media = getBestMediaUrl({ animation_url: '', image_url: 'https://example.com/image.png' }, [
    { source_url: 'https://cdn.example/file.mp4', variants: {} },
  ]);
  assert.equal(media.url, 'https://cdn.example/file.mp4');
});

test('getBestMediaUrl: uses variant URLs from media_assets', () => {
  const { getBestMediaUrl } = nftIndexer;
  const media = getBestMediaUrl({ animation_url: '', image_url: '' }, [
    {
      source_url: '',
      variants: { l: 'https://cdn.example/transcoded.mp4' },
    },
  ]);
  assert.equal(media.url, 'https://cdn.example/transcoded.mp4');
});

test('getBestMediaUrl: falls back to display.image_url when no media assets', () => {
  const { getBestMediaUrl } = nftIndexer;
  const media = getBestMediaUrl(
    { animation_url: '', image_url: 'https://example.com/image.png' },
    []
  );
  assert.equal(media.url, 'https://example.com/image.png');
  assert.equal(media.thumbnail, 'https://example.com/image.png');
});

test('getBestMediaUrl: handles null/empty display and media_assets', () => {
  const { getBestMediaUrl } = nftIndexer;
  const media = getBestMediaUrl({}, []);
  assert.equal(media.url, '');
  assert.equal(media.thumbnail, '');
});

test('getBestMediaUrl: skips data URIs', () => {
  const { getBestMediaUrl } = nftIndexer;
  const media = getBestMediaUrl(
    {
      animation_url: 'data:image/png;base64,abc123',
      image_url: 'https://example.com/fallback.png',
    },
    []
  );
  assert.equal(media.url, 'https://example.com/fallback.png');
});

test('getBestMediaUrl: skips URLs longer than 1024 chars', () => {
  const { getBestMediaUrl } = nftIndexer;
  const longUrl = 'https://example.com/' + 'x'.repeat(1100);
  const media = getBestMediaUrl(
    { animation_url: longUrl, image_url: 'https://example.com/fallback.png' },
    []
  );
  assert.equal(media.url, 'https://example.com/fallback.png');
});

test('mapIndexerDataToStandardFormat: reads display fields', () => {
  const { mapIndexerDataToStandardFormat } = nftIndexer;
  const out = mapIndexerDataToStandardFormat(
    {
      token_number: '1',
      contract_address: '0xabc',
      current_owner: '0xowner',
      burned: false,
      display: {
        name: 'Test Token',
        description: 'Test description',
        mime_type: 'video/mp4',
        image_url: 'https://example.com/image.png',
        animation_url: 'https://example.com/video.mp4',
        artists: [{ name: 'Artist Name' }],
      },
      media_assets: [],
    },
    'ethereum'
  );
  assert.equal(out.success, true);
  if (!('token' in out) || !out.token) {
    assert.fail('expected token on success');
  }
  assert.equal(out.token.name, 'Test Token');
  assert.equal(out.token.description, 'Test description');
  assert.equal(out.token.animation_url, 'https://example.com/video.mp4');
  assert.equal(out.token.metadata.artistName, 'Artist Name');
});

test('mapIndexerDataToStandardFormat: uses media_assets for image URL', () => {
  const { mapIndexerDataToStandardFormat } = nftIndexer;
  const out = mapIndexerDataToStandardFormat(
    {
      token_number: '1',
      contract_address: '0xabc',
      current_owner: '0xowner',
      burned: false,
      display: { name: 'Test', mime_type: 'video/mp4' },
      media_assets: [{ source_url: 'https://cdn.example/file.mp4', variants: {} }],
    },
    'ethereum'
  );
  assert.equal(out.success, true);
  if (!('token' in out) || !out.token) {
    assert.fail('expected token on success');
  }
  assert.equal(out.token.image.url, 'https://cdn.example/file.mp4');
});

test('mapIndexerDataToStandardFormat: handles missing display gracefully', () => {
  const { mapIndexerDataToStandardFormat } = nftIndexer;
  const out = mapIndexerDataToStandardFormat(
    {
      token_number: '123',
      contract_address: '0xabc',
      current_owner: '0xowner',
      burned: false,
      media_assets: [],
    },
    'ethereum'
  );
  assert.equal(out.success, true);
  if (!('token' in out) || !out.token) {
    assert.fail('expected token on success');
  }
  assert.equal(out.token.name, 'Token #123');
  assert.equal(out.token.metadata.artistName, '');
});

test('mapIndexerDataToStandardFormat: returns error for null indexerData', () => {
  const { mapIndexerDataToStandardFormat } = nftIndexer;
  const out = mapIndexerDataToStandardFormat(null, 'ethereum');
  assert.equal(out.success, false);
  assert.equal(out.error, 'Token not found in indexer');
});

// Job polling tests using global.fetch stubbing

test('queryJobStatus: returns status and lastError on success', async () => {
  const { queryJobStatus } = nftIndexer;
  const originalFetch = global.fetch;

  global.fetch = async () =>
    jsonResponse({
      data: {
        jobStatus: {
          status: 'running',
          last_error: null,
        },
      },
    });

  try {
    const result = await queryJobStatus(123);
    assert.equal(result.success, true);
    assert.equal(result.status, 'running');
    assert.equal(result.lastError, null);
  } finally {
    global.fetch = originalFetch;
  }
});

test('queryJobStatus: handles HTTP errors', async () => {
  const { queryJobStatus } = nftIndexer;
  const originalFetch = global.fetch;

  global.fetch = async () => jsonResponse(null, false, 500);

  try {
    const result = await queryJobStatus(123);
    assert.equal(result.success, false);
    assert.ok(result.error?.includes('HTTP error'));
  } finally {
    global.fetch = originalFetch;
  }
});

test('queryJobStatus: handles GraphQL errors', async () => {
  const { queryJobStatus } = nftIndexer;
  const originalFetch = global.fetch;

  global.fetch = async () =>
    jsonResponse({
      errors: [{ message: 'Job not found' }],
    });

  try {
    const result = await queryJobStatus(123);
    assert.equal(result.success, false);
    assert.ok(result.error?.includes('GraphQL errors'));
  } finally {
    global.fetch = originalFetch;
  }
});

test('queryJobStatus: rejects invalid job_id', async () => {
  const { queryJobStatus } = nftIndexer;
  const result = await queryJobStatus('invalid');
  assert.equal(result.success, false);
  assert.equal(result.error, 'Invalid job_id');
});

test('pollForJobCompletion: completes on "completed" status', async () => {
  const { pollForJobCompletion } = nftIndexer;
  const originalFetch = global.fetch;

  global.fetch = async () =>
    jsonResponse({
      data: {
        jobStatus: {
          status: 'completed',
          last_error: null,
        },
      },
    });

  try {
    const result = await pollForJobCompletion(123);
    assert.equal(result.success, true);
    assert.equal(result.completed, true);
    assert.equal(result.timedOut, false);
  } finally {
    global.fetch = originalFetch;
  }
});

test('pollForJobCompletion: fails on "failed" status with lastError', async () => {
  const { pollForJobCompletion } = nftIndexer;
  const originalFetch = global.fetch;

  global.fetch = async () =>
    jsonResponse({
      data: {
        jobStatus: {
          status: 'failed',
          last_error: 'Token not found',
        },
      },
    });

  try {
    const result = await pollForJobCompletion(123);
    assert.equal(result.success, false);
    assert.equal(result.completed, false);
    assert.ok(result.error?.includes('Token not found'));
  } finally {
    global.fetch = originalFetch;
  }
});

test('triggerIndexingAsync: parses job_id from response', async () => {
  const { triggerIndexingAsync } = nftIndexer;
  const originalFetch = global.fetch;

  global.fetch = async () =>
    jsonResponse({
      data: {
        triggerTokenIndexing: {
          job_id: 456,
        },
      },
    });

  try {
    const result = await triggerIndexingAsync('ethereum', '0xabc', '123');
    assert.equal(result.success, true);
    assert.equal(result.job_id, 456);
    assert.equal(result.workflow_id, undefined);
    assert.equal(result.run_id, undefined);
  } finally {
    global.fetch = originalFetch;
  }
});

test('triggerIndexingAsync: returns error when no job_id in response', async () => {
  const { triggerIndexingAsync } = nftIndexer;
  const originalFetch = global.fetch;

  global.fetch = async () =>
    jsonResponse({
      data: {
        triggerTokenIndexing: {},
      },
    });

  try {
    const result = await triggerIndexingAsync('ethereum', '0xabc', '123');
    assert.equal(result.success, false);
    assert.ok(result.error?.includes('No job_id'));
  } finally {
    global.fetch = originalFetch;
  }
});
