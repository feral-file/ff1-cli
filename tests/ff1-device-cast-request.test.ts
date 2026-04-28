import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildDisplayPlaylistCastRequestBody } from '../src/utilities/ff1-device';

const minimalPlaylist = {
  version: '1.0.0',
  title: 'T',
  items: [],
};

describe('buildDisplayPlaylistCastRequestBody', () => {
  it('embeds dp1_call when no playlistUrl', () => {
    const body = buildDisplayPlaylistCastRequestBody(minimalPlaylist as never);
    assert.equal(body.command, 'displayPlaylist');
    assert.ok('dp1_call' in body.request);
    assert.equal(body.request.dp1_call, minimalPlaylist);
    assert.deepEqual(body.request.intent, { action: 'now_display' });
  });

  it('uses playlistUrl for http(s) sources', () => {
    const url = 'https://cdn.example.com/p.json';
    const body = buildDisplayPlaylistCastRequestBody(minimalPlaylist as never, url);
    assert.equal(body.command, 'displayPlaylist');
    assert.ok('playlistUrl' in body.request);
    assert.equal(body.request.playlistUrl, url);
    assert.deepEqual(body.request.intent, { action: 'now_display' });
  });

  it('trims playlistUrl', () => {
    const body = buildDisplayPlaylistCastRequestBody(
      minimalPlaylist as never,
      '  https://cdn.example.com/p.json  '
    );
    assert.ok('playlistUrl' in body.request);
    assert.equal(body.request.playlistUrl, 'https://cdn.example.com/p.json');
  });

  it('throws for non-http playlistUrl', () => {
    assert.throws(
      () => buildDisplayPlaylistCastRequestBody(minimalPlaylist as never, 'file:///tmp/x.json'),
      /playlistUrl must be an http\(s\) URL/
    );
  });
});
