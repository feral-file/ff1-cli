import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const utilities = require('../src/utilities');
const nftIndexer = require('../src/utilities/nft-indexer');

interface IndexerToken {
  contract_address: string;
  token_id: string;
}

interface MockCall {
  address: string;
  limit: number;
  offset: number;
}

let ownerCalls: MockCall[] = [];
let contractCalls: Array<{ address: string; limit: number }> = [];

const originalQueryTokensByOwner = nftIndexer.queryTokensByOwner;
const originalQueryTokensByContract = nftIndexer.queryTokensByContract;
const originalMapIndexerDataToStandardFormat = nftIndexer.mapIndexerDataToStandardFormat;
const originalConvertToDP1Item = nftIndexer.convertToDP1Item;

/**
 * Build a deterministic DP1 item from minimal token input.
 *
 * @param {IndexerToken} token - Minimal token row from indexer
 * @returns {object} DP1 item used by tests
 */
function toItem(token: IndexerToken): object {
  return {
    id: `item-${token.token_id}`,
    title: `Token ${token.token_id}`,
    source: `https://example.com/${token.token_id}.mp4`,
    duration: 10,
    license: 'cc0',
  };
}

beforeEach(() => {
  ownerCalls = [];
  contractCalls = [];

  nftIndexer.queryTokensByOwner = async (address: string, limit: number, offset = 0) => {
    ownerCalls.push({ address, limit, offset });
    return {
      success: true,
      tokens: [],
    };
  };

  nftIndexer.queryTokensByContract = async (address: string, limit: number) => {
    contractCalls.push({ address, limit });
    return {
      success: true,
      tokens: [
        {
          contract_address: address,
          token_id: '101',
        },
      ],
    };
  };

  nftIndexer.mapIndexerDataToStandardFormat = (token: IndexerToken) => ({
    success: true,
    token,
  });

  nftIndexer.convertToDP1Item = (mapped: { token: IndexerToken }) => ({
    success: true,
    item: toItem(mapped.token),
  });
});

afterEach(() => {
  nftIndexer.queryTokensByOwner = originalQueryTokensByOwner;
  nftIndexer.queryTokensByContract = originalQueryTokensByContract;
  nftIndexer.mapIndexerDataToStandardFormat = originalMapIndexerDataToStandardFormat;
  nftIndexer.convertToDP1Item = originalConvertToDP1Item;
});

describe('queryRequirement owner-to-contract fallback', () => {
  test('falls back to contract lookup for EVM addresses with no owned tokens', async () => {
    const address = '0xaeE022552B539dB18297D7481b6D547C622488B3';

    const items = await utilities.queryRequirement(
      {
        type: 'query_address',
        ownerAddress: address,
        quantity: 10,
      },
      10
    );

    assert.equal(ownerCalls.length, 1);
    assert.equal(ownerCalls[0].address, address);
    assert.equal(contractCalls.length, 1);
    assert.equal(contractCalls[0].address, address);
    assert.equal(items.length, 1);
    assert.equal(items[0].id, 'item-101');
  });

  test('does not run contract fallback for non-EVM addresses', async () => {
    const items = await utilities.queryRequirement(
      {
        type: 'query_address',
        ownerAddress: 'tz1VSUr8wwNhLAzempoch5d6hLRiTh8Cjcjb',
        quantity: 10,
      },
      10
    );

    assert.equal(ownerCalls.length, 1);
    assert.equal(contractCalls.length, 0);
    assert.deepEqual(items, []);
  });
});
