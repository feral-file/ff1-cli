import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { generateKeyPairSync } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(__dirname, '..');
const tsxCli = resolve(projectRoot, 'node_modules/tsx/dist/cli.mjs');
const cliEntry = resolve(projectRoot, 'index.ts');
const defaultDp1Js = process.env.DP1_JS || 'file:/Users/nguyenphuocsang/Bitmark/dp1-js-private';
const fixturesDir = join(projectRoot, 'tests/fixtures/playlists');
const examplesDir = join(projectRoot, 'examples');

type RunResult = { status: number | null; stdout: string; stderr: string };

const playlistFixtures = {
  validSignedV10: 'valid-signed-v10.json',
  validSignedV11: 'valid-signed-v11.json',
  validUnsignedOpenV11: 'valid-unsigned-open-v11.json',
  invalidMissingTitleV10: 'invalid-missing-title-v10.json',
  invalidDisplayAndSourceV10: 'invalid-display-and-source-v10.json',
  invalidMissingItems: 'invalid-playlist-missing-items.json',
  invalidJson: 'invalid-json.json',
} as const;

function runCli(
  cwd: string,
  args: string[],
  extraEnv: Record<string, string | undefined> = {}
): RunResult {
  ensureDp1JsReady(defaultDp1Js);
  const result = spawnSync(process.execPath, [tsxCli, cliEntry, ...args], {
    cwd,
    env: {
      ...process.env,
      DP1_JS: defaultDp1Js,
      XDG_CONFIG_HOME: join(cwd, '.xdg'),
      ...extraEnv,
    },
    encoding: 'utf-8',
  });

  return {
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

function ensureDp1JsReady(spec: string): void {
  if (!spec.startsWith('file:')) {
    return;
  }

  const repoDir = fileURLToPath(spec);
  const packageJson = join(repoDir, 'package.json');
  const builtEntry = join(repoDir, 'dist', 'index.js');

  if (!existsSync(packageJson)) {
    throw new Error(`DP1_JS points at a missing repo: ${repoDir}`);
  }

  if (existsSync(builtEntry)) {
    return;
  }

  const build = spawnSync('npm', ['run', 'build'], {
    cwd: repoDir,
    encoding: 'utf-8',
  });

  if (existsSync(builtEntry)) {
    return;
  }

  assert.equal(
    build.status,
    0,
    `Failed to build local dp1-js repo at ${repoDir}\n${build.stdout || ''}${build.stderr || ''}`
  );
}

function makeWorkspace(): string {
  return mkdtempSync(join(tmpdir(), 'ff1-cli-integration-'));
}

function writeSigningConfig(dir: string): void {
  const { privateKey } = generateKeyPairSync('ed25519');
  const privateKeyBase64 = privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64');
  writeFileSync(
    join(dir, 'config.json'),
    JSON.stringify({ playlist: { privateKey: privateKeyBase64, role: 'agent' } }, null, 2),
    'utf-8'
  );
}

function copyFixture(
  dir: string,
  fixtureName: keyof typeof playlistFixtures,
  targetName = 'playlist.json'
): string {
  const target = join(dir, targetName);
  copyFileSync(join(fixturesDir, playlistFixtures[fixtureName]), target);
  return target;
}

function copyExample(dir: string, exampleName: string, targetName = 'playlist.json'): string {
  const target = join(dir, targetName);
  copyFileSync(join(examplesDir, exampleName), target);
  return target;
}

function cleanup(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

function expectOk(result: RunResult, context: string): void {
  assert.equal(result.status, 0, `${context}: ${result.stdout}${result.stderr}`);
}

function expectFail(result: RunResult, pattern: RegExp, context: string): void {
  assert.notEqual(result.status, 0, `${context}: expected non-zero exit`);
  assert.match(result.stdout + result.stderr, pattern, context);
}

describe('ff1 verify/validate/sign CLI integration', () => {
  test('verify and validate accept the v1.1.0 sample playlist example', () => {
    const dir = makeWorkspace();
    try {
      writeSigningConfig(dir);
      const sampleV11 = copyExample(dir, 'sample-playlist-v11.json', 'sample-v11.json');
      const signedV11 = join(dir, 'sample-v11-signed.json');
      const sign = runCli(dir, ['sign', sampleV11, '-o', signedV11]);
      expectOk(sign, 'sign sample v1.1.0 example');

      const verify = runCli(dir, ['verify', signedV11]);
      expectOk(verify, 'verify sample v1.1.0 example');
      assert.match(verify.stdout, /Playlist is valid/i);
      assert.match(verify.stdout, /DP Version: 1\.1\.0/i);

      const validate = runCli(dir, ['validate', signedV11]);
      expectOk(validate, 'validate sample v1.1.0 example');
      assert.match(validate.stdout, /Playlist is valid/i);
      assert.match(validate.stdout, /DP Version: 1\.1\.0/i);
    } finally {
      cleanup(dir);
    }
  });

  test('verify and validate accept the documented valid playlist fixtures', () => {
    const dir = makeWorkspace();
    try {
      writeSigningConfig(dir);
      const unsignedV11 = copyExample(dir, 'sample-playlist-v11.json', 'unsigned-v11.json');
      const signedV11 = join(dir, 'signed-v11.json');
      const signV11 = runCli(dir, ['sign', unsignedV11, '-o', signedV11]);
      expectOk(signV11, 'sign sample v1.1.0 example');

      const verifySignedV11 = runCli(dir, ['verify', signedV11]);
      expectOk(verifySignedV11, 'verify signed v1.1.0');
      assert.match(verifySignedV11.stdout, /Playlist is valid/i);

      const validateSignedV11 = runCli(dir, ['validate', signedV11]);
      expectOk(validateSignedV11, 'validate signed v1.1.0');
      assert.match(validateSignedV11.stdout, /Playlist is valid/i);

      const tampered = JSON.parse(readFileSync(signedV11, 'utf-8')) as {
        signatures?: Array<{ sig?: string }>;
      };
      assert.ok(Array.isArray(tampered.signatures) && tampered.signatures.length > 0);
      tampered.signatures![0].sig = 'AAAA';
      writeFileSync(signedV11, JSON.stringify(tampered, null, 2), 'utf-8');

      const verifyTampered = runCli(dir, ['verify', signedV11]);
      expectFail(
        verifyTampered,
        /signature verification failed|invalid/i,
        'verify tampered v1.1.0'
      );
    } finally {
      cleanup(dir);
    }
  });

  test('verify accepts unsigned open playlists and sign can promote them into envelopes', () => {
    const dir = makeWorkspace();
    try {
      const unsigned = copyFixture(dir, 'validUnsignedOpenV11', 'unsigned.json');

      const verify = runCli(dir, ['verify', unsigned]);
      expectOk(verify, 'verify unsigned open');
      assert.match(verify.stdout, /Playlist is valid/i);

      writeSigningConfig(dir);
      const output = join(dir, 'signed.json');
      const sign = runCli(dir, ['sign', unsigned, '-o', output]);
      expectOk(sign, 'sign unsigned open playlist');

      const signed = JSON.parse(readFileSync(output, 'utf-8')) as { signatures?: unknown[] };
      assert.ok(Array.isArray(signed.signatures), 'sign must write signatures[]');
      assert.ok((signed.signatures ?? []).length > 0, 'signatures[] must not be empty');
    } finally {
      cleanup(dir);
    }
  });

  const verifyFailureCases = [
    {
      name: 'missing file',
      fixture: undefined,
      path: 'missing.json',
      pattern: /not found/i,
    },
    {
      name: 'invalid json',
      fixture: 'invalidJson' as const,
      path: 'invalid-json.json',
      pattern: /Expected property name|invalid json|Input must be a valid JSON object/i,
    },
    {
      name: 'missing title',
      fixture: 'invalidMissingTitleV10' as const,
      path: 'invalid-missing-title-v10.json',
      pattern: /title: Required|invalid|validation failed/i,
    },
    {
      name: 'missing items',
      fixture: 'invalidMissingItems' as const,
      path: 'invalid-playlist-missing-items.json',
      pattern: /items|Required|validation failed/i,
    },
  ] as const;

  for (const testCase of verifyFailureCases) {
    test(`verify and validate reject ${testCase.name}`, () => {
      const dir = makeWorkspace();
      try {
        const playlistPath = testCase.fixture
          ? copyFixture(dir, testCase.fixture, testCase.path)
          : join(dir, testCase.path);
        if (!testCase.fixture) {
          // no-op, path intentionally missing
        }

        const verify = runCli(dir, ['verify', playlistPath]);
        expectFail(verify, testCase.pattern, `verify ${testCase.name}`);

        const validate = runCli(dir, ['validate', playlistPath]);
        expectFail(validate, testCase.pattern, `validate ${testCase.name}`);
      } finally {
        cleanup(dir);
      }
    });
  }

  test('sign writes a signatures envelope and the result still verifies', () => {
    const dir = makeWorkspace();
    try {
      writeSigningConfig(dir);
      const input = copyExample(dir, 'sample-playlist-v11.json', 'input.json');
      const output = join(dir, 'signed.json');

      const sign = runCli(dir, ['sign', input, '-o', output]);
      expectOk(sign, 'sign valid playlist');
      assert.match(sign.stdout, /Playlist signed/i);

      const signed = JSON.parse(readFileSync(output, 'utf-8')) as {
        signatures?: unknown[];
        signature?: unknown;
      };
      assert.ok(Array.isArray(signed.signatures), 'sign must write signatures[]');
      assert.equal(signed.signature, undefined, 'sign must not emit legacy signature field');
      assert.ok((signed.signatures ?? []).length > 0, 'signatures[] must not be empty');

      const verifySigned = runCli(dir, ['verify', output]);
      expectOk(verifySigned, 'verify signed output');
      assert.match(verifySigned.stdout, /Playlist is valid/i);
    } finally {
      cleanup(dir);
    }
  });

  const signFailureCases = [
    {
      name: 'missing file',
      setup: (_dir: string) => undefined,
      input: 'missing.json',
      expect: /not found/i,
    },
    {
      name: 'invalid json',
      setup: (dir: string) => copyFixture(dir, 'invalidJson', 'invalid-json.json'),
      input: 'invalid-json.json',
      expect: /Expected property name|invalid json|Input must be a valid JSON object/i,
    },
    {
      name: 'invalid playlist',
      setup: (dir: string) => copyFixture(dir, 'invalidMissingTitleV10', 'invalid.json'),
      input: 'invalid.json',
      expect: /Playlist validation failed|validation failed|invalid|title|required/i,
    },
    {
      name: 'missing signing key',
      setup: (dir: string) => copyExample(dir, 'sample-playlist-v11.json', 'unsigned.json'),
      input: 'unsigned.json',
      env: { PLAYLIST_PRIVATE_KEY: '' },
      expect: /private key/i,
    },
  ] as const;

  for (const testCase of signFailureCases) {
    test(`sign rejects ${testCase.name}`, () => {
      const dir = makeWorkspace();
      try {
        writeSigningConfig(dir);
        const inputPath = join(dir, testCase.input);
        testCase.setup(dir);

        if (testCase.name === 'missing signing key') {
          rmSync(join(dir, 'config.json'), { force: true });
        }

        const sign = runCli(
          dir,
          ['sign', inputPath, '-o', join(dir, 'signed.json')],
          testCase.env ?? {}
        );
        expectFail(sign, testCase.expect, `sign ${testCase.name}`);
      } finally {
        cleanup(dir);
      }
    });
  }

  test('verify fails early when DP1_JS points at an unusable dependency', () => {
    const dir = makeWorkspace();
    try {
      const unsigned = copyFixture(dir, 'validUnsignedOpenV11', 'unsigned.json');
      const result = runCli(dir, ['verify', unsigned], {
        DP1_JS: 'file:/definitely/not/a/real/path',
      });

      expectFail(result, /cannot find|MODULE_NOT_FOUND|failed/i, 'verify unusable dp1-js');
    } finally {
      cleanup(dir);
    }
  });
});
