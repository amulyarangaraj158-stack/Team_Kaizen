import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDependencyGraph,
  detectLanguage,
  getLanguageCapabilityMatrix,
  runStaticAnalysis,
} from './staticAnalyzer';

test('detectLanguage identifies all 14 target programming languages accurately', () => {
  const cases: Array<[string, string]> = [
    ['app.py', 'python'],
    ['index.js', 'javascript'],
    ['service.ts', 'typescript'],
    ['Main.java', 'java'],
    ['buffer.c', 'c'],
    ['engine.cpp', 'cpp'],
    ['worker.go', 'go'],
    ['lib.rs', 'rust'],
    ['schema.sql', 'sql'],
    ['index.html', 'html'],
    ['styles.css', 'css'],
    ['config.json', 'json'],
    ['router.php', 'php'],
    ['Program.cs', 'csharp'],
  ];
  for (const [filename, expected] of cases) {
    assert.equal(detectLanguage(filename), expected);
  }
  assert.equal(getLanguageCapabilityMatrix().length, 14);
});

test('runStaticAnalysis detects SQL injection, TypeScript syntax errors, and Python mutable defaults', () => {
  const findings = runStaticAnalysis([
    {
      path: 'src/query.ts',
      content: 'export function q(id: string) { return `SELECT * FROM users WHERE id = ${id}`; }',
    },
    {
      path: 'src/broken.ts',
      content: 'export function broken( { return 1; }',
    },
    {
      path: 'etl/worker.py',
      content: 'def collect(item, acc=[]):\n    acc.append(item)\n    return acc\n',
    },
  ]);

  assert.ok(findings.some((f) => f.category === 'sql_injection' && f.filePath === 'src/query.ts'));
  assert.ok(findings.some((f) => f.category === 'syntax' && f.filePath === 'src/broken.ts'));
  assert.ok(findings.some((f) => f.filePath === 'etl/worker.py' && f.title.includes('Mutable Default')));
});

test('buildDependencyGraph maps direct and indirect reverse dependents accurately', () => {
  const { nodes, edges } = buildDependencyGraph([
    { path: 'src/core.ts', content: 'export function coreFn() { return 1; }' },
    { path: 'src/mid.ts', content: "import { coreFn } from './core';\nexport const mid = () => coreFn();" },
    { path: 'src/app.ts', content: "import { mid } from './mid';\nconsole.log(mid());" },
  ]);

  assert.equal(edges.length, 2);
  const coreNode = nodes.find((n) => n.filePath === 'src/core.ts');
  assert.ok(coreNode);
  assert.equal(coreNode.directDependents, 1);
  assert.equal(coreNode.indirectDependents, 1);
  assert.equal(coreNode.impactLevel, 'high');
});
