import { spawn } from 'node:child_process';
import esbuild from 'esbuild';
import path from 'node:path';
import type { GeneratedTestCaseAI } from './gemini.ts';

export interface ExecutedTestCaseResult {
  id: string;
  name: string;
  category: 'normal' | 'invalid' | 'boundary';
  description: string;
  inputSummary: string;
  expectedSummary: string;
  passed: boolean;
  actual: string;
  expected: string;
  error?: string;
  durationMs: number;
}

export interface TestSuiteRunResult {
  executionMode: 'isolated_vm' | 'static_validation';
  totalTests: number;
  passedTests: number;
  failedTests: number;
  validationStatus: 'passed' | 'failed' | 'static_verified' | 'error';
  summary: string;
  cases: ExecutedTestCaseResult[];
}

function transpileToCjs(code: string, filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const loader =
    ext === '.ts' ? 'ts' : ext === '.tsx' ? 'tsx' : ext === '.jsx' ? 'jsx' : 'js';
  const result = esbuild.transformSync(code, {
    loader,
    format: 'cjs',
    target: 'es2022',
  });
  return result.code;
}

/**
 * Isolated JS/TS test runner:
 * - Spawns a separate Node.js child process with empty environment variables (no secrets, no host API keys).
 * - Evaluates transpiled project modules strictly inside a locked-down node:vm context with zero filesystem/network require access.
 * - Enforces hard execution timeouts (3500ms total process timeout, 1000ms per VM script).
 */
export async function executeIsolatedJsTests(params: {
  targetFilePath: string;
  targetCode: string;
  projectFiles: Array<{ filePath: string; content: string }>;
  testCases: GeneratedTestCaseAI[];
}): Promise<TestSuiteRunResult> {
  const compiledModules: Record<string, string> = {};

  try {
    for (const f of params.projectFiles) {
      const ext = path.extname(f.filePath).toLowerCase();
      if (['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'].includes(ext)) {
        const source = f.filePath === params.targetFilePath ? params.targetCode : f.content;
        compiledModules[f.filePath] = transpileToCjs(source, f.filePath);
      }
    }
    if (!compiledModules[params.targetFilePath]) {
      compiledModules[params.targetFilePath] = transpileToCjs(params.targetCode, params.targetFilePath);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      executionMode: 'isolated_vm',
      totalTests: params.testCases.length,
      passedTests: 0,
      failedTests: params.testCases.length,
      validationStatus: 'error',
      summary: `Syntax/compilation error prevented execution: ${message}`,
      cases: params.testCases.map((tc) => ({
        id: tc.id,
        name: tc.name,
        category: tc.category,
        description: tc.description,
        inputSummary: tc.inputSummary,
        expectedSummary: tc.expectedSummary,
        passed: false,
        actual: `Compile error: ${message}`,
        expected: tc.expectedSummary,
        error: message,
        durationMs: 0,
      })),
    };
  }

  const runnerScript = `
const vm = require('node:vm');
const path = require('node:path');

let rawInput = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { rawInput += chunk; });
process.stdin.on('end', async () => {
  try {
    const payload = JSON.parse(rawInput);
    const { compiledModules, targetFilePath, testCases } = payload;
    const moduleCache = Object.create(null);

    function resolveModulePath(fromFile, reqPath) {
      if (!reqPath.startsWith('.')) {
        throw new Error('External module "' + reqPath + '" is blocked inside the isolated test sandbox.');
      }
      const dir = path.posix.dirname(fromFile);
      const base = path.posix.normalize(path.posix.join(dir, reqPath));
      const candidates = [base, base + '.js', base + '.ts', base + '.jsx', base + '.tsx', base + '/index.js', base + '/index.ts'];
      for (const c of candidates) {
        if (Object.prototype.hasOwnProperty.call(compiledModules, c)) return c;
      }
      throw new Error('Local module "' + reqPath + '" not found in project files.');
    }

    function loadInSandbox(filePath) {
      if (moduleCache[filePath]) return moduleCache[filePath].exports;
      const mod = { exports: {} };
      moduleCache[filePath] = mod;

      const sandboxRequire = (reqPath) => {
        const resolved = resolveModulePath(filePath, reqPath);
        return loadInSandbox(resolved);
      };

      const sandbox = vm.createContext({
        module: mod,
        exports: mod.exports,
        require: sandboxRequire,
        console: { log: () => {}, warn: () => {}, error: () => {} },
        Math, Date, JSON, Array, Object, Number, String, Boolean, RegExp, Map, Set,
        Error, TypeError, RangeError, SyntaxError, parseInt, parseFloat, isNaN, isFinite,
        Promise,
      });

      const wrapped = '(function(exports, require, module) {\\n' + compiledModules[filePath] + '\\n})(exports, require, module);';
      vm.runInContext(wrapped, sandbox, { timeout: 1000, filename: filePath });
      return mod.exports;
    }

    const results = [];
    for (const tc of testCases) {
      const start = Date.now();
      try {
        // Fresh module load per test case to avoid cross-test mutation
        for (const k of Object.keys(moduleCache)) delete moduleCache[k];
        const targetMod = loadInSandbox(targetFilePath);
        const testContext = vm.createContext({
          mod: targetMod,
          Math, Date, JSON, Array, Object, Number, String, Boolean, RegExp, Map, Set,
          Error, TypeError, RangeError, SyntaxError, parseInt, parseFloat, isNaN, isFinite,
          Promise,
        });
        const fnCode = '(async function(mod) {\\n' + tc.jsTestBody + '\\n})(mod)';
        const outcome = await vm.runInContext(fnCode, testContext, { timeout: 1000 });
        const passed = Boolean(outcome && outcome.passed === true);
        results.push({
          id: tc.id,
          name: tc.name,
          category: tc.category,
          description: tc.description,
          inputSummary: tc.inputSummary,
          expectedSummary: tc.expectedSummary,
          passed,
          actual: outcome && outcome.actual !== undefined ? String(outcome.actual) : (passed ? 'Passed' : 'Failed'),
          expected: outcome && outcome.expected !== undefined ? String(outcome.expected) : tc.expectedSummary,
          durationMs: Date.now() - start,
        });
      } catch (err) {
        results.push({
          id: tc.id,
          name: tc.name,
          category: tc.category,
          description: tc.description,
          inputSummary: tc.inputSummary,
          expectedSummary: tc.expectedSummary,
          passed: false,
          actual: 'Threw ' + (err && err.name ? err.name : 'Error') + ': ' + (err && err.message ? err.message : String(err)),
          expected: tc.expectedSummary,
          error: err && err.message ? err.message : String(err),
          durationMs: Date.now() - start,
        });
      }
    }

    process.stdout.write(JSON.stringify({ ok: true, results }));
  } catch (err) {
    process.stdout.write(JSON.stringify({ ok: false, error: err && err.message ? err.message : String(err) }));
  }
});
`;

  return new Promise<TestSuiteRunResult>((resolve) => {
    const child = spawn(process.execPath, ['-e', runnerScript], {
      env: {}, // Completely stripped environment — no API keys or host variables
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const killTimer = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill('SIGKILL');
        resolve({
          executionMode: 'isolated_vm',
          totalTests: params.testCases.length,
          passedTests: 0,
          failedTests: params.testCases.length,
          validationStatus: 'error',
          summary: 'Isolated sandbox execution timed out after 3.5s (possible infinite loop).',
          cases: params.testCases.map((tc) => ({
            id: tc.id,
            name: tc.name,
            category: tc.category,
            description: tc.description,
            inputSummary: tc.inputSummary,
            expectedSummary: tc.expectedSummary,
            passed: false,
            actual: 'Timed out in isolated sandbox',
            expected: tc.expectedSummary,
            error: 'Execution timeout',
            durationMs: 3500,
          })),
        });
      }
    }, 3500);

    child.stdout.on('data', (d) => {
      stdout += d.toString();
    });
    child.stderr.on('data', (d) => {
      stderr += d.toString();
    });

    child.on('close', () => {
      if (settled) return;
      settled = true;
      clearTimeout(killTimer);

      try {
        const parsed = JSON.parse(stdout) as { ok: boolean; results?: ExecutedTestCaseResult[]; error?: string };
        if (!parsed.ok || !parsed.results) {
          throw new Error(parsed.error || stderr || 'Sandbox returned invalid payload');
        }
        const passedTests = parsed.results.filter((r) => r.passed).length;
        const failedTests = parsed.results.length - passedTests;
        resolve({
          executionMode: 'isolated_vm',
          totalTests: parsed.results.length,
          passedTests,
          failedTests,
          validationStatus: failedTests === 0 && parsed.results.length > 0 ? 'passed' : 'failed',
          summary:
            failedTests === 0
              ? `All ${passedTests} isolated sandbox tests passed.`
              : `${passedTests}/${parsed.results.length} tests passed; ${failedTests} failed in isolated sandbox.`,
          cases: parsed.results,
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        resolve({
          executionMode: 'isolated_vm',
          totalTests: params.testCases.length,
          passedTests: 0,
          failedTests: params.testCases.length,
          validationStatus: 'error',
          summary: `Isolated sandbox encountered an error: ${msg}`,
          cases: params.testCases.map((tc) => ({
            id: tc.id,
            name: tc.name,
            category: tc.category,
            description: tc.description,
            inputSummary: tc.inputSummary,
            expectedSummary: tc.expectedSummary,
            passed: false,
            actual: `Sandbox error: ${msg}`,
            expected: tc.expectedSummary,
            error: msg,
            durationMs: 0,
          })),
        });
      }
    });

    child.stdin.write(
      JSON.stringify({
        compiledModules,
        targetFilePath: params.targetFilePath,
        testCases: params.testCases,
      })
    );
    child.stdin.end();
  });
}

/**
 * Safe static validation for non-JS/TS languages (Python, Java, C, C++, HTML, CSS, etc.)
 * Never claims runtime execution; explicitly reports static structural & invariant checks.
 */
export function runStaticValidation(params: {
  language: string;
  code: string;
  testCases: GeneratedTestCaseAI[];
}): TestSuiteRunResult {
  const start = Date.now();
  const cases: ExecutedTestCaseResult[] = params.testCases.map((tc) => {
    const checks: string[] = [];
    let passed = true;

    if (tc.staticExpectPresent && tc.staticExpectPresent.trim()) {
      const needle = tc.staticExpectPresent.trim();
      const hasNeedle = params.code.includes(needle);
      if (!hasNeedle) {
        passed = false;
        checks.push(`Expected safe guard pattern "${needle}" not found`);
      } else {
        checks.push(`Verified presence of safe pattern "${needle}"`);
      }
    }

    if (tc.staticExpectAbsent && tc.staticExpectAbsent.trim()) {
      const forbidden = tc.staticExpectAbsent.trim();
      const stillPresent = params.code.includes(forbidden);
      if (stillPresent) {
        passed = false;
        checks.push(`Defective pattern "${forbidden}" still present in source`);
      } else {
        checks.push(`Confirmed removal of defective pattern "${forbidden}"`);
      }
    }

    if (checks.length === 0) {
      // Check balanced brackets/parens as basic structural integrity fallback
      const openParens = (params.code.match(/\(/g) || []).length;
      const closeParens = (params.code.match(/\)/g) || []).length;
      passed = openParens === closeParens && params.code.trim().length > 0;
      checks.push(
        passed
          ? 'Static structural syntax check passed (balanced delimiters, non-empty source)'
          : `Unbalanced parentheses detected (${openParens} open vs ${closeParens} close)`
      );
    }

    return {
      id: tc.id,
      name: tc.name,
      category: tc.category,
      description: tc.description,
      inputSummary: tc.inputSummary,
      expectedSummary: tc.expectedSummary,
      passed,
      actual: `[Static Analysis — Not Executed] ${checks.join('; ')}`,
      expected: tc.expectedSummary,
      durationMs: Math.max(1, Date.now() - start),
    };
  });

  const passedTests = cases.filter((c) => c.passed).length;
  const failedTests = cases.length - passedTests;

  return {
    executionMode: 'static_validation',
    totalTests: cases.length,
    passedTests,
    failedTests,
    validationStatus: failedTests === 0 && cases.length > 0 ? 'static_verified' : 'failed',
    summary:
      failedTests === 0
        ? `Static validation passed (${passedTests}/${cases.length} checks). Note: ${params.language} code was verified statically without host execution.`
        : `Static validation found ${failedTests} failing invariant(s) out of ${cases.length} checks (${params.language} is not executed on the host).`,
    cases,
  };
}
