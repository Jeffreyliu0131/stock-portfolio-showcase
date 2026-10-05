import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('../../', import.meta.url));
const braces = require('braces');
const nested = (depth, open = '{', close = '}') => open.repeat(depth) + 'a,b' + close.repeat(depth);
const depthError = /(?:Input|AST) depth .*exceeds max depth/;

test('micromatch resolves the maintained copy and no registry braces copy remains locked', () => {
  const expected = realpathSync(join(root, 'vendor/braces/index.js'));
  const fromMicromatch = createRequire(require.resolve('micromatch'));
  assert.equal(realpathSync(require.resolve('braces')), expected);
  assert.equal(realpathSync(fromMicromatch.resolve('braces')), expected);
  const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
  const copies = Object.entries(lock.packages).filter(([name]) => /(?:^|\/)node_modules\/braces$/.test(name));
  assert.equal(copies.length, 1);
  assert.equal(copies[0][1].resolved, 'vendor/braces');
  assert.equal(copies[0][1].link, true);
  assert.equal(lock.packages[''].devDependencies.braces, 'file:vendor/braces');
  assert.equal(lock.packages['vendor/braces'].dev, true);
});

for (const api of ['parse', 'compile', 'expand', 'stringify']) {
  test(`${api} accepts depth 100 and rejects excessive braces, parentheses and mixed nesting`, () => {
    for (const [open, close] of [['{', '}'], ['(', ')']]) {
      assert.doesNotThrow(() => braces[api](nested(100, open, close)));
      for (const depth of [101, 1000, 4998]) {
        assert.throws(() => braces[api](nested(depth, open, close)), depthError);
      }
    }
    assert.throws(() => braces[api]('{('.repeat(51) + 'a,b' + ')}'.repeat(51)), depthError);
  });

  test(`${api} cannot bypass the cap and respects lower/fractional limits`, () => {
    for (const maxDepth of [101, 100000, Infinity, NaN, false]) {
      assert.throws(() => braces[api](nested(101), { maxDepth }), depthError);
    }
    assert.doesNotThrow(() => braces[api]('{a,b}', { maxDepth: 1.5 }));
    assert.throws(() => braces[api]('{{a,b},c}', { maxDepth: 1.5 }), depthError);
    assert.throws(() => braces[api]('(a)', { maxDepth: 0 }), depthError);
    // Quoted/escaped delimiters are literals, not structural nesting.
    assert.doesNotThrow(() => braces[api]('"' + nested(101) + '"'));
    assert.doesNotThrow(() => braces[api]('\\{'.repeat(101) + 'x' + '\\}'.repeat(101)));
  });
}

for (const api of ['compile', 'expand', 'stringify']) {
  test(`${api} also bounds direct AST input`, () => {
    let node = { type: 'text', value: 'x' };
    for (let i = 0; i < 10000; i++) node = { type: 'brace', nodes: [node] };
    assert.throws(() => braces[api]({ type: 'root', nodes: [node] }), depthError);
  });
}

test('expansion rejects parent cycles instead of hanging', () => {
  for (const multiNode of [false, true]) {
    const ast = { type: 'paren', nodes: [{ type: 'text', value: 'x' }] };
    const parent = multiNode ? { type: 'paren', parent: ast } : ast;
    ast.parent = parent;
    assert.throws(
      () => vm.runInNewContext('expand(ast)', { expand: braces.expand, ast }, { timeout: 1000 }),
      /AST parent chain contains a cycle/,
    );
  }
});

test('normal ranges, nested alternatives and stringify escaping retain their behavior', () => {
  assert.deepEqual(braces.expand('src/{a,{b,c}}-{01..03}.js'), [
    'src/a-01.js', 'src/a-02.js', 'src/a-03.js',
    'src/b-01.js', 'src/b-02.js', 'src/b-03.js',
    'src/c-01.js', 'src/c-02.js', 'src/c-03.js',
  ]);
  assert.deepEqual(braces.expand('foo/({a,b})'), ['foo/(a)', 'foo/(b)']);
  for (const pattern of ['{{a}}', '{a,{b}}', '{{x}y}', '{a,{b,{c}}', '{}{a}', '{1..8}']) {
    assert.equal(braces.stringify(braces.parse(pattern), { escapeInvalid: true }), pattern);
  }
  for (let i = 0; i < 500; i++) {
    assert.equal(braces.compile(`lib/{a${i},b${i}}.js`), `lib/(a${i}|b${i}).js`);
    assert.deepEqual(braces.expand(`lib/{a${i},b${i}}.js`), [`lib/a${i}.js`, `lib/b${i}.js`]);
  }
});

test('micromatch and fast-glob retain normal file matching and reject hostile expansion', () => {
  const micromatch = require('micromatch');
  const glob = require('fast-glob');
  assert.deepEqual(micromatch(['src/a.js', 'src/b.ts', 'src/a.test.ts'], ['src/*.{js,ts}', '!**/*.test.*']), ['src/a.js', 'src/b.ts']);
  assert.throws(() => micromatch.braceExpand(nested(1000)), depthError);
  const cwd = mkdtempSync(join(tmpdir(), 'dependency-glob-'));
  try {
    mkdirSync(join(cwd, 'src'));
    for (const file of ['a.js', 'b.ts', 'a.test.ts']) writeFileSync(join(cwd, 'src', file), '');
    assert.deepEqual(glob.sync(['src/*.{js,ts}', '!**/*.test.*'], { cwd }).sort(), ['src/a.js', 'src/b.ts']);
    assert.throws(() => glob.sync(nested(1000), { cwd }), depthError);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('the actual dynamic-import build plugin still expands module candidates', async () => {
  const { globFiles } = await import('vite-plugin-dynamic-import');
  const cwd = mkdtempSync(join(tmpdir(), 'dependency-import-'));
  try {
    mkdirSync(join(cwd, 'messages'));
    for (const file of ['en.js', 'fr.js', 'notes.txt']) writeFileSync(join(cwd, 'messages', file), '');
    const result = await globFiles({
      importeeNode: {
        type: 'TemplateLiteral',
        quasis: [{ value: { raw: './messages/' } }, { value: { raw: '.js' } }],
        expressions: [{ type: 'Identifier', name: 'language' }],
      },
      importExpression: 'import(`./messages/${language}.js`)',
      importer: join(cwd, 'index.js'),
      resolve: { tryResolve: async () => undefined },
      extensions: ['.js'],
      loose: false,
    });
    assert.deepEqual(result.files.sort(), ['./messages/en.js', './messages/fr.js']);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
