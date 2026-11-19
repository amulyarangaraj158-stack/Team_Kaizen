import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { sanitizeProjectFilePath } from '../utils/security';

const execFileAsync = promisify(execFile);

export interface SandboxFile {
  path: string;
  content: string;
  language?: string;
}

export interface SingleTestRunResult {
  executed: boolean;
  runner: 'node:test' | 'python:unittest' | 'none';
  status: 'passed' | 'failed' | 'skipped';
  totalTests: number;
  passedTests: number;
  failedTests: number;
  failedTestNames: string[];
  outputLog: string;
  durationMs: number;
}

export interface RegressionComparisonReport {
  baseline: SingleTestRunResult;
  patched: SingleTestRunResult;
  newlyFailedTests: string[];
  resolvedTests: string[];
  regressionDetected: boolean;
  summary: string;
}

function writeFilesToSandbox(sandboxDir: string, files: SandboxFile[]): void {
  for (const file of files) {
    const safeRel = sanitizeProjectFilePath(file.path);
    const fullPath = path.join(sandboxDir, safeRel);
    // Double-check containment inside sandboxDir
    const resolved = path.resolve(fullPath);
    if (!resolved.startsWith(path.resolve(sandboxDir) + path.sep)) {
      throw new Error(`Sandbox path escape blocked: ${file.path}`);
    }
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, file.content, 'utf8');
  }
}

function parseNodeTestOutput(output: string): {
  total: number;
  passed: number;
  failed: number;
  failedNames: string[];
} {
  const failedNames: string[] = [];
  const lines = output.split('\n');
  for (const line of lines) {
    const notOkMatch = line.match(/^not ok \d+\s*-\s*(.+)$/);
    if (notOkMatch) {
      failedNames.push(notOkMatch[1].trim());
    }
  }
  const testsMatch = output.match(/# tests\s+(\d+)/);
  const passMatch = output.match(/# pass\s+(\d+)/);
  const failMatch = output.match(/# fail\s+(\d+)/);

  if (testsMatch) {
    return {
      total: Number(testsMatch[1]),
      passed: passMatch ? Number(passMatch[1]) : 0,
      failed: failMatch ? Number(failMatch[1]) : failedNames.length,
      failedNames,
    };
  }
  const okCount = lines.filter((l) => /^ok \d+/.test(l)).length;
  const notOkCount = failedNames.length;
  return {
    total: okCount + notOkCount,
    passed: okCount,
    failed: notOkCount,
    failedNames,
  };
}

function parsePythonUnittestOutput(output: string): {
  total: number;
  passed: number;
  failed: number;
  failedNames: string[];
} {
  const ranMatch = output.match(/Ran (\d+) tests?/);
  const total = ranMatch ? Number(ranMatch[1]) : 0;
  const failedNames: string[] = [];
  const failHeaders = output.matchAll(/^(?:FAIL|ERROR):\s+([^\n]+)/gm);
  for (const m of failHeaders) {
    failedNames.push(m[1].trim());
  }
  const failed = failedNames.length;
  const passed = Math.max(0, total - failed);
  return { total, passed, failed, failedNames };
}

/**
 * Runs project tests inside an isolated temporary directory with strict
 * timeouts, stripped environment variables, and guaranteed directory cleanup.
 * Untrusted project code is never executed against the live app directory.
 */
export async function runTestsInIsolatedSandbox(files: SandboxFile[]): Promise<SingleTestRunResult> {
  const sandboxId = crypto.randomUUID();
  const sandboxDir = path.join(os.tmpdir(), `autopatch-sandbox-${sandboxId}`);
  const start = Date.now();

  try {
    fs.mkdirSync(sandboxDir, { recursive: true });
    writeFilesToSandbox(sandboxDir, files);

    const jsTestFiles = files
      .map((f) => sanitizeProjectFilePath(f.path))
      .filter((p) => /\.(test|spec)\.(mjs|cjs|js)$/.test(p));

    const pyTestFiles = files
      .map((f) => sanitizeProjectFilePath(f.path))
      .filter((p) => /(^|\/)test_.*\.py$|_test\.py$/.test(p));

    // Restricted environment: no secrets (GEMINI_API_KEY, JWT_SECRET) passed to sandbox!
    const restrictedEnv: NodeJS.ProcessEnv = {
      PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
      NODE_ENV: 'test',
      HOME: sandboxDir,
      TMPDIR: sandboxDir,
    };

    if (jsTestFiles.length > 0) {
      const absTests = jsTestFiles.map((rel) => path.join(sandboxDir, rel));
      try {
        const { stdout, stderr } = await execFileAsync(
          process.execPath,
          ['--test', '--test-reporter=tap', ...absTests],
          {
            cwd: sandboxDir,
            env: restrictedEnv,
            timeout: 8000,
            maxBuffer: 512 * 1024,
          }
        );
        const combined = `${stdout}\n${stderr}`.trim();
        const parsed = parseNodeTestOutput(combined);
        return {
          executed: true,
          runner: 'node:test',
          status: parsed.failed === 0 ? 'passed' : 'failed',
          totalTests: parsed.total,
          passedTests: parsed.passed,
          failedTests: parsed.failed,
          failedTestNames: parsed.failedNames,
          outputLog: combined.slice(0, 6000),
          durationMs: Date.now() - start,
        };
      } catch (err: unknown) {
        const execErr = err as { stdout?: string; stderr?: string; message?: string };
        const combined = `${execErr.stdout ?? ''}\n${execErr.stderr ?? ''}\n${execErr.message ?? ''}`.trim();
        const parsed = parseNodeTestOutput(combined);
        return {
          executed: true,
          runner: 'node:test',
          status: 'failed',
          totalTests: Math.max(parsed.total, 1),
          passedTests: parsed.passed,
          failedTests: Math.max(parsed.failed, 1),
          failedTestNames: parsed.failedNames.length > 0 ? parsed.failedNames : ['Test execution error'],
          outputLog: combined.slice(0, 6000),
          durationMs: Date.now() - start,
        };
      }
    }

    if (pyTestFiles.length > 0) {
      try {
        const { stdout, stderr } = await execFileAsync(
          'python3',
          ['-m', 'unittest', 'discover', '-s', sandboxDir, '-v'],
          {
            cwd: sandboxDir,
            env: restrictedEnv,
            timeout: 8000,
            maxBuffer: 512 * 1024,
          }
        );
        const combined = `${stdout}\n${stderr}`.trim();
        const parsed = parsePythonUnittestOutput(combined);
        return {
          executed: true,
          runner: 'python:unittest',
          status: parsed.failed === 0 ? 'passed' : 'failed',
          totalTests: parsed.total,
          passedTests: parsed.passed,
          failedTests: parsed.failed,
          failedTestNames: parsed.failedNames,
          outputLog: combined.slice(0, 6000),
          durationMs: Date.now() - start,
        };
      } catch (err: unknown) {
        const execErr = err as { stdout?: string; stderr?: string; message?: string };
        const combined = `${execErr.stdout ?? ''}\n${execErr.stderr ?? ''}\n${execErr.message ?? ''}`.trim();
        const parsed = parsePythonUnittestOutput(combined);
        return {
          executed: true,
          runner: 'python:unittest',
          status: 'failed',
          totalTests: Math.max(parsed.total, 1),
          passedTests: parsed.passed,
          failedTests: Math.max(parsed.failed, 1),
          failedTestNames: parsed.failedNames.length > 0 ? parsed.failedNames : ['Python unittest failure'],
          outputLog: combined.slice(0, 6000),
          durationMs: Date.now() - start,
        };
      }
    }

    return {
      executed: false,
      runner: 'none',
      status: 'skipped',
      totalTests: 0,
      passedTests: 0,
      failedTests: 0,
      failedTestNames: [],
      outputLog:
        'No runnable test files (*.test.js, *.test.mjs, test_*.py) were detected in this project. Upload a test file to enable automated Regression Guardian execution.',
      durationMs: Date.now() - start,
    };
  } finally {
    try {
      fs.rmSync(sandboxDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup error
    }
  }
}

/**
 * Regression Guardian workflow:
 * 1. Run baseline tests on original project files in isolated sandbox
 * 2. Apply proposed patch in a fresh isolated working copy
 * 3. Re-run exact same test suite
 * 4. Diff failures to detect newly introduced regressions
 */
export async function runRegressionGuardian(
  projectFiles: SandboxFile[],
  targetFilePath: string,
  proposedContent: string
): Promise<RegressionComparisonReport> {
  const baseline = await runTestsInIsolatedSandbox(projectFiles);

  const patchedFiles = projectFiles.map((f) =>
    f.path === targetFilePath ? { ...f, content: proposedContent } : f
  );
  const patched = await runTestsInIsolatedSandbox(patchedFiles);

  const baselineFailedSet = new Set(baseline.failedTestNames);
  const patchedFailedSet = new Set(patched.failedTestNames);

  const newlyFailedTests = patched.failedTestNames.filter((name) => !baselineFailedSet.has(name));
  const resolvedTests = baseline.failedTestNames.filter((name) => !patchedFailedSet.has(name));

  const regressionDetected =
    newlyFailedTests.length > 0 || (baseline.status === 'passed' && patched.status === 'failed');

  let summary: string;
  if (!baseline.executed && !patched.executed) {
    summary = 'No automated test suite found in project; manual code review required before applying patch.';
  } else if (regressionDetected) {
    summary = `Regression detected: ${newlyFailedTests.length} newly failing test(s) introduced by the proposed patch.`;
  } else if (resolvedTests.length > 0 && patched.failedTests === 0) {
    summary = `Patch verified: all ${patched.totalTests} tests pass and ${resolvedTests.length} previously failing test(s) are now resolved.`;
  } else if (patched.failedTests === 0) {
    summary = `Zero regressions: all ${patched.totalTests} baseline tests continue to pass after applying patch in sandbox.`;
  } else {
    summary = `No new regressions introduced, though ${patched.failedTests} pre-existing test failure(s) remain.`;
  }

  return {
    baseline,
    patched,
    newlyFailedTests,
    resolvedTests,
    regressionDetected,
    summary,
  };
}
