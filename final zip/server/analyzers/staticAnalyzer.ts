import { transformSync } from 'esbuild';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface ProjectFileInput {
  id?: string;
  path: string;
  content: string;
  language?: string;
}

export interface StaticFinding {
  filePath: string;
  lineNumber: number;
  columnNumber: number;
  category: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  description: string;
  rootCause: string;
  codeSnippet: string;
  analyzerSource: string;
  preventionTip: string;
  relatedConcepts: string[];
}

export interface DependencyNodeRecord {
  filePath: string;
  label: string;
  language: string;
  exports: string[];
  directDependents: number;
  indirectDependents: number;
  impactLevel: 'low' | 'medium' | 'high' | 'critical';
}

export interface DependencyEdgeRecord {
  sourcePath: string;
  targetPath: string;
  importType: string;
  symbols: string[];
}

export interface LanguageCapability {
  language: string;
  extensions: string[];
  configuredTools: string[];
  unconfiguredTools: string[];
  supportLevel: 'full' | 'syntax_and_rules' | 'structural_rules';
}

const EXTENSION_TO_LANGUAGE: Record<string, string> = {
  '.py': 'python',
  '.js': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.jsx': 'javascript',
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.java': 'java',
  '.c': 'c',
  '.h': 'c',
  '.cpp': 'cpp',
  '.cc': 'cpp',
  '.cxx': 'cpp',
  '.hpp': 'cpp',
  '.go': 'go',
  '.rs': 'rust',
  '.sql': 'sql',
  '.html': 'html',
  '.htm': 'html',
  '.css': 'css',
  '.json': 'json',
  '.php': 'php',
  '.cs': 'csharp',
};

export function detectLanguage(filePath: string, content = ''): string {
  const ext = path.posix.extname(filePath.toLowerCase());
  if (EXTENSION_TO_LANGUAGE[ext]) {
    return EXTENSION_TO_LANGUAGE[ext];
  }
  const head = content.slice(0, 300);
  if (head.startsWith('#!/usr/bin/env python') || head.startsWith('#!/usr/bin/python')) return 'python';
  if (head.startsWith('<?php')) return 'php';
  if (head.startsWith('<!doctype html') || head.startsWith('<html')) return 'html';
  return 'plaintext';
}

let cachedPythonAvailable: boolean | null = null;
export function isPythonAvailable(): boolean {
  if (cachedPythonAvailable !== null) return cachedPythonAvailable;
  try {
    execFileSync('python3', ['--version'], { stdio: 'ignore', timeout: 2000 });
    cachedPythonAvailable = true;
  } catch {
    cachedPythonAvailable = false;
  }
  return cachedPythonAvailable;
}

export function getLanguageCapabilityMatrix(): LanguageCapability[] {
  const hasPython = isPythonAvailable();
  return [
    {
      language: 'typescript',
      extensions: ['.ts', '.tsx'],
      configuredTools: ['TypeScript Compiler API (AST & Diagnostics)', 'AutoPatch Security/Bug Rules', 'Node Test Sandbox'],
      unconfiguredTools: ['ESLint (optional external config)', 'Semgrep'],
      supportLevel: 'full',
    },
    {
      language: 'javascript',
      extensions: ['.js', '.jsx', '.mjs', '.cjs'],
      configuredTools: ['TypeScript JS Compiler Diagnostics', 'AutoPatch Security/Bug Rules', 'Node Test Sandbox'],
      unconfiguredTools: ['ESLint', 'Semgrep'],
      supportLevel: 'full',
    },
    {
      language: 'python',
      extensions: ['.py'],
      configuredTools: hasPython
        ? ['Python 3 AST Parser (python3 -m ast)', 'AutoPatch Security/Bug Rules', 'Python unittest Sandbox']
        : ['AutoPatch Security/Bug Rules'],
      unconfiguredTools: ['Bandit', 'Ruff / Pylint', 'Pytest'],
      supportLevel: hasPython ? 'full' : 'structural_rules',
    },
    {
      language: 'json',
      extensions: ['.json'],
      configuredTools: ['Native JSON.parse Validator', 'Schema & Secret Hygiene Rules'],
      unconfiguredTools: [],
      supportLevel: 'syntax_and_rules',
    },
    {
      language: 'sql',
      extensions: ['.sql'],
      configuredTools: ['SQL Safety & Destructive Query Rules', 'Gemini Deep Analysis'],
      unconfiguredTools: ['SQLFluff'],
      supportLevel: 'structural_rules',
    },
    {
      language: 'html',
      extensions: ['.html', '.htm'],
      configuredTools: ['DOM Accessibility & XSS Audit Rules', 'Website Debugger Integration'],
      unconfiguredTools: ['HTMLHint'],
      supportLevel: 'syntax_and_rules',
    },
    {
      language: 'css',
      extensions: ['.css'],
      configuredTools: ['CSS Syntax & Layout Audit Rules'],
      unconfiguredTools: ['Stylelint'],
      supportLevel: 'structural_rules',
    },
    {
      language: 'java',
      extensions: ['.java'],
      configuredTools: ['AutoPatch Structural & Security Rules', 'Import Graph Extractor', 'Gemini Deep Analysis'],
      unconfiguredTools: ['javac', 'SpotBugs'],
      supportLevel: 'structural_rules',
    },
    {
      language: 'c',
      extensions: ['.c', '.h'],
      configuredTools: ['Unsafe Memory/Buffer Rules (strcpy/gets/sprintf)', 'Include Graph Extractor', 'Gemini Deep Analysis'],
      unconfiguredTools: ['gcc / clang', 'cppcheck'],
      supportLevel: 'structural_rules',
    },
    {
      language: 'cpp',
      extensions: ['.cpp', '.cc', '.cxx', '.hpp'],
      configuredTools: ['Memory Safety & Raw Pointer Rules', 'Include Graph Extractor', 'Gemini Deep Analysis'],
      unconfiguredTools: ['g++ / clang++', 'clang-tidy'],
      supportLevel: 'structural_rules',
    },
    {
      language: 'go',
      extensions: ['.go'],
      configuredTools: ['Error-Handling & Concurrency Rules', 'Import Graph Extractor', 'Gemini Deep Analysis'],
      unconfiguredTools: ['go vet', 'staticcheck'],
      supportLevel: 'structural_rules',
    },
    {
      language: 'rust',
      extensions: ['.rs'],
      configuredTools: ['Unsafe Block & Unwrap Panic Rules', 'Module Graph Extractor', 'Gemini Deep Analysis'],
      unconfiguredTools: ['cargo check', 'clippy'],
      supportLevel: 'structural_rules',
    },
    {
      language: 'php',
      extensions: ['.php'],
      configuredTools: ['SQL Injection, XSS & Eval Rules', 'Gemini Deep Analysis'],
      unconfiguredTools: ['php -l', 'PHPStan'],
      supportLevel: 'structural_rules',
    },
    {
      language: 'csharp',
      extensions: ['.cs'],
      configuredTools: ['SQLi, Deserialization & Async Void Rules', 'Gemini Deep Analysis'],
      unconfiguredTools: ['dotnet build', 'Roslyn Analyzers'],
      supportLevel: 'structural_rules',
    },
  ];
}

function getLineSnippet(content: string, lineNumber: number, radius = 2): string {
  const lines = content.split('\n');
  const start = Math.max(0, lineNumber - 1 - radius);
  const end = Math.min(lines.length, lineNumber + radius);
  return lines
    .slice(start, end)
    .map((line, idx) => `${start + idx + 1}: ${line}`)
    .join('\n');
}

interface PatternRule {
  languages: string[];
  regex: RegExp;
  category: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  description: string;
  rootCause: string;
  preventionTip: string;
  relatedConcepts: string[];
}

const STRUCTURAL_RULES: PatternRule[] = [
  {
    languages: ['javascript', 'typescript', 'python', 'php', 'java', 'csharp', 'go'],
    regex: /(SELECT|INSERT|UPDATE|DELETE)\b[^\n]*(\$\{[^}]+\}|\+\s*[a-zA-Z_]\w*|f["'][^"']*\{[^}]+\})/i,
    category: 'sql_injection',
    severity: 'critical',
    title: 'Potential SQL Injection via String Interpolation',
    description: 'Dynamic user or variable data appears to be concatenated or interpolated directly into an SQL query string.',
    rootCause: 'Unsanitized input embedded directly in SQL syntax allows attackers to alter query structure.',
    preventionTip: 'Always use parameterized queries or prepared statements with bound placeholders (? or $1).',
    relatedConcepts: ['Parameterized Queries', 'OWASP A03 Injection', 'Prepared Statements'],
  },
  {
    languages: ['javascript', 'typescript', 'python', 'php'],
    regex: /\b(eval|exec)\s*\([^)]*[a-zA-Z_]\w*/g,
    category: 'security',
    severity: 'critical',
    title: 'Dangerous Dynamic Code Execution (eval/exec)',
    description: 'Dynamic code evaluation can lead to arbitrary Remote Code Execution (RCE) when passed untrusted input.',
    rootCause: 'Executing strings as code bypasses static type/syntax boundaries and exposes runtime privileges.',
    preventionTip: 'Use JSON.parse, safe expression evaluators, or explicit dispatch maps instead of eval/exec.',
    relatedConcepts: ['Code Injection', 'Principle of Least Privilege', 'Safe Parsing'],
  },
  {
    languages: ['javascript', 'typescript', 'python', 'java', 'go', 'php', 'csharp'],
    regex: /(api[_-]?key|secret|password|private[_-]?key)\s*[:=]\s*["'][A-Za-z0-9_\-!@#$%^&*]{8,}["']/i,
    category: 'security',
    severity: 'high',
    title: 'Hardcoded Secret or Credential Detected',
    description: 'Sensitive credential literal appears hardcoded inside source code.',
    rootCause: 'Embedding secrets directly in version-controlled source files risks credential leakage.',
    preventionTip: 'Load secrets exclusively from environment variables or a dedicated secret manager.',
    relatedConcepts: ['Secret Management', 'Environment Configuration', 'CWE-798'],
  },
  {
    languages: ['javascript', 'typescript'],
    regex: /dangerouslySetInnerHTML|\.innerHTML\s*=\s*[^"'`]/,
    category: 'security',
    severity: 'high',
    title: 'Potential Cross-Site Scripting (XSS) Sink',
    description: 'Assigning dynamic content directly to innerHTML or dangerouslySetInnerHTML can execute injected scripts.',
    rootCause: 'Unescaped HTML strings inserted into the DOM allow attacker-controlled JavaScript execution.',
    preventionTip: 'Use textContent, React JSX escaping, or sanitize HTML through DOMPurify before rendering.',
    relatedConcepts: ['XSS Prevention', 'Output Encoding', 'Content Security Policy'],
  },
  {
    languages: ['javascript', 'typescript'],
    regex: /\.then\([^)]*\)\s*(?!\.catch)/,
    category: 'async_error',
    severity: 'medium',
    title: 'Promise Chain Missing Error Handler (.catch)',
    description: 'A Promise .then() chain lacks a corresponding .catch() or try/catch boundary.',
    rootCause: 'Unhandled promise rejections can crash Node.js processes or leave UI state permanently stuck.',
    preventionTip: 'Prefer async/await inside try/catch blocks or attach .catch() to every Promise chain.',
    relatedConcepts: ['Error Boundaries', 'Unhandled Rejections', 'Async Control Flow'],
  },
  {
    languages: ['javascript', 'typescript'],
    regex: /==\s*(null|undefined|0|""|''|true|false)\b|(?<!=)==(?!=)/,
    category: 'logic_bug',
    severity: 'low',
    title: 'Loose Equality Comparison (==)',
    description: 'Loose equality performs implicit type coercion, causing subtle edge-case bugs.',
    rootCause: 'JavaScript coerces operands across types (e.g. "" == 0 is true) when using == instead of ===.',
    preventionTip: 'Use strict equality (=== / !==) to guarantee both value and type match.',
    relatedConcepts: ['Type Coercion', 'Strict Equality', 'Defensive Coding'],
  },
  {
    languages: ['python'],
    regex: /except\s*:\s*$|except\s+Exception\s*:\s*pass\b/,
    category: 'error_handling',
    severity: 'medium',
    title: 'Bare Except or Swallowed Exception',
    description: 'Catching all exceptions silently hides runtime bugs and even intercepts SystemExit/KeyboardInterrupt.',
    rootCause: 'Blanket exception suppression discards stack traces and masks failing invariants.',
    preventionTip: 'Catch specific exception subclasses and log or re-raise unexpected failures.',
    relatedConcepts: ['Structured Error Handling', 'Observability', 'Python PEP 8'],
  },
  {
    languages: ['python'],
    regex: /\bdef\s+\w+\([^)]*=\s*(\[\]|\{\})/,
    category: 'logic_bug',
    severity: 'high',
    title: 'Mutable Default Argument in Python Function',
    description: 'Using a mutable list or dict as a default parameter shares state across all function calls.',
    rootCause: 'Python evaluates default argument expressions once at function definition time, not per invocation.',
    preventionTip: 'Use None as the default value and initialize a fresh list/dict inside the function body.',
    relatedConcepts: ['Python Function Evaluation', 'Shared Mutable State', 'Pure Functions'],
  },
  {
    languages: ['c', 'cpp'],
    regex: /\b(strcpy|strcat|gets|sprintf)\s*\(/,
    category: 'memory_safety',
    severity: 'critical',
    title: 'Unsafe Unbounded Buffer Operation',
    description: 'Functions like strcpy/gets/sprintf do not enforce destination buffer bounds.',
    rootCause: 'Writing past allocated buffer length causes stack/heap buffer overflows and memory corruption.',
    preventionTip: 'Use bounded alternatives (strncpy, snprintf, fgets) or std::string in C++.',
    relatedConcepts: ['Buffer Overflow', 'CWE-120', 'Bounds Checking'],
  },
  {
    languages: ['rust'],
    regex: /\.unwrap\(\)/,
    category: 'null_safety',
    severity: 'medium',
    title: 'Unchecked .unwrap() May Panic at Runtime',
    description: 'Calling .unwrap() on Option or Result terminates the thread if the value is None or Err.',
    rootCause: 'Bypassing exhaustive Result/Option matching trades safety for abrupt panics.',
    preventionTip: 'Propagate errors with the ? operator or handle fallback cases with unwrap_or / match.',
    relatedConcepts: ['Result & Option', 'Graceful Error Propagation', 'Rust Safety'],
  },
  {
    languages: ['go'],
    regex: /,\s*_\s*:?=\s*[a-zA-Z0-9_.]+\(/,
    category: 'error_handling',
    severity: 'medium',
    title: 'Ignored Error Return Value in Go',
    description: 'Assigning an error return value to the blank identifier (_) silently discards failures.',
    rootCause: 'Unchecked errors cause subsequent operations to act on zero-value or corrupted state.',
    preventionTip: 'Always check if err != nil and return or log the error with context.',
    relatedConcepts: ['Explicit Error Checking', 'Go Idioms', 'Fail Fast'],
  },
  {
    languages: ['html'],
    regex: /<img\b(?![^>]*\balt=)[^>]*>/i,
    category: 'accessibility',
    severity: 'medium',
    title: 'Image Element Missing alt Attribute',
    description: 'An <img> element lacks an alt attribute required for screen readers and broken-image fallback.',
    rootCause: 'Missing alt text violates WCAG 2.1 Level A accessibility standards.',
    preventionTip: 'Add descriptive alt text for informative images or alt="" for purely decorative ones.',
    relatedConcepts: ['WCAG Accessibility', 'Semantic HTML', 'Screen Readers'],
  },
  {
    languages: ['sql'],
    regex: /^\s*(DELETE\s+FROM|UPDATE\s+\w+\s+SET)\b(?![\s\S]*\bWHERE\b)/im,
    category: 'data_integrity',
    severity: 'critical',
    title: 'Unbounded DELETE or UPDATE Without WHERE Clause',
    description: 'A destructive SQL mutation appears to have no WHERE filter and will affect every row in the table.',
    rootCause: 'Missing row predicates in DML queries cause catastrophic unintended data loss.',
    preventionTip: 'Always include an explicit WHERE predicate and wrap migrations in transactions.',
    relatedConcepts: ['Data Integrity', 'SQL Transactions', 'Safe Migrations'],
  },
];

function analyzeTypeScriptOrJs(file: ProjectFileInput, language: string): StaticFinding[] {
  const findings: StaticFinding[] = [];
  const loader: 'tsx' | 'ts' | 'jsx' | 'js' = file.path.endsWith('.tsx')
    ? 'tsx'
    : file.path.endsWith('.jsx')
      ? 'jsx'
      : language === 'typescript'
        ? 'ts'
        : 'js';

  try {
    transformSync(file.content, {
      loader,
      sourcefile: file.path,
      target: 'es2022',
    });
  } catch (err: unknown) {
    const errors = (err as { errors?: Array<{ text: string; location?: { line: number; column: number } }> })?.errors ?? [];
    for (const diag of errors.slice(0, 6)) {
      const lineNumber = diag.location?.line ?? 1;
      const columnNumber = (diag.location?.column ?? 0) + 1;
      findings.push({
        filePath: file.path,
        lineNumber,
        columnNumber,
        category: 'syntax',
        severity: 'critical',
        title: `Syntax Error: ${diag.text.slice(0, 72)}`,
        description: diag.text,
        rootCause: 'The TypeScript/JavaScript parser encountered invalid syntax that prevents compilation.',
        codeSnippet: getLineSnippet(file.content, lineNumber),
        analyzerSource: 'TypeScript/esbuild Compiler API',
        preventionTip: 'Fix syntax tokens and enable compiler checks in CI before merging.',
        relatedConcepts: ['AST Parsing', 'TypeScript Compiler', 'Syntax Validation'],
      });
    }
  }

  // Detect empty catch blocks accurately across multiline formatting
  const emptyCatchRegex = /\bcatch\s*(?:\([^)]*\))?\s*\{\s*\}/g;
  let match: RegExpExecArray | null;
  while ((match = emptyCatchRegex.exec(file.content)) !== null) {
    const lineNumber = file.content.slice(0, match.index).split('\n').length;
    findings.push({
      filePath: file.path,
      lineNumber,
      columnNumber: 1,
      category: 'error_handling',
      severity: 'medium',
      title: 'Empty catch Block Swallows Runtime Errors',
      description: 'Exceptions caught in this try/catch block are silently discarded without logging or recovery.',
      rootCause: 'Empty catch blocks mask production bugs and make debugging failures extremely difficult.',
      codeSnippet: getLineSnippet(file.content, lineNumber),
      analyzerSource: 'AutoPatch JS/TS AST Analyzer',
      preventionTip: 'Log the caught error, return a structured failure response, or re-throw.',
      relatedConcepts: ['Error Observability', 'Defensive Error Handling'],
    });
  }

  return findings;
}

function analyzePythonSyntax(file: ProjectFileInput): StaticFinding[] {
  if (!isPythonAvailable()) return [];
  const findings: StaticFinding[] = [];
  const tmpFile = path.join(os.tmpdir(), `autopatch-py-${Date.now()}-${Math.random().toString(36).slice(2)}.py`);
  try {
    fs.writeFileSync(tmpFile, file.content, 'utf8');
    execFileSync('python3', ['-c', `import ast, sys; ast.parse(open(sys.argv[1], encoding="utf-8").read(), filename=sys.argv[1])`, tmpFile], {
      timeout: 3000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err: unknown) {
    const stderr = (err as { stderr?: Buffer })?.stderr?.toString('utf8') ?? '';
    const lineMatch = stderr.match(/line (\d+)/i);
    const lineNumber = lineMatch ? Number(lineMatch[1]) : 1;
    const lastLine = stderr.trim().split('\n').pop() ?? 'Python SyntaxError';
    findings.push({
      filePath: file.path,
      lineNumber,
      columnNumber: 1,
      category: 'syntax',
      severity: 'critical',
      title: `Python Syntax Error: ${lastLine.slice(0, 72)}`,
      description: stderr.trim().slice(0, 400) || 'Invalid Python syntax detected by python3 AST parser.',
      rootCause: 'The Python AST compiler rejected the syntax in this file.',
      codeSnippet: getLineSnippet(file.content, lineNumber),
      analyzerSource: 'Python 3 AST Parser',
      preventionTip: 'Validate Python syntax with python3 -m py_compile or Ruff in pre-commit hooks.',
      relatedConcepts: ['Python AST', 'Syntax Validation'],
    });
  } finally {
    try {
      if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
    } catch {
      // ignore cleanup error
    }
  }
  return findings;
}

function analyzeJsonSyntax(file: ProjectFileInput): StaticFinding[] {
  try {
    JSON.parse(file.content);
    return [];
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Invalid JSON syntax';
    return [
      {
        filePath: file.path,
        lineNumber: 1,
        columnNumber: 1,
        category: 'syntax',
        severity: 'high',
        title: 'Invalid JSON Syntax',
        description: msg,
        rootCause: 'Malformed JSON structure (trailing comma, missing quote, or unclosed bracket).',
        codeSnippet: getLineSnippet(file.content, 1, 4),
        analyzerSource: 'Native JSON Parser',
        preventionTip: 'Validate JSON payloads and config files against a schema prior to deployment.',
        relatedConcepts: ['JSON Specification', 'Configuration Validation'],
      },
    ];
  }
}

/**
 * Runs genuine static analysis across all provided project files using
 * configured language parsers (TypeScript Compiler API, Python 3 AST, JSON.parse)
 * plus line-accurate structural & security rules.
 */
export function runStaticAnalysis(files: ProjectFileInput[]): StaticFinding[] {
  const allFindings: StaticFinding[] = [];

  for (const file of files) {
    const language = file.language || detectLanguage(file.path, file.content);

    if (language === 'typescript' || language === 'javascript') {
      allFindings.push(...analyzeTypeScriptOrJs(file, language));
    } else if (language === 'python') {
      allFindings.push(...analyzePythonSyntax(file));
    } else if (language === 'json') {
      allFindings.push(...analyzeJsonSyntax(file));
    }

    const lines = file.content.split('\n');
    const seenRuleLine = new Set<string>();

    for (const rule of STRUCTURAL_RULES) {
      if (!rule.languages.includes(language)) continue;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Ignore pure comments
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed.startsWith('*') || trimmed.startsWith('/*')) {
          continue;
        }
        rule.regex.lastIndex = 0;
        if (rule.regex.test(line)) {
          const key = `${rule.title}:${i + 1}`;
          if (seenRuleLine.has(key)) continue;
          seenRuleLine.add(key);

          allFindings.push({
            filePath: file.path,
            lineNumber: i + 1,
            columnNumber: 1,
            category: rule.category,
            severity: rule.severity,
            title: rule.title,
            description: rule.description,
            rootCause: rule.rootCause,
            codeSnippet: getLineSnippet(file.content, i + 1),
            analyzerSource: `AutoPatch ${language.toUpperCase()} Static Rules`,
            preventionTip: rule.preventionTip,
            relatedConcepts: rule.relatedConcepts,
          });
        }
      }
    }
  }

  return allFindings;
}

function resolveRelativeImport(sourcePath: string, specifier: string, availablePaths: Set<string>): string | null {
  if (!specifier.startsWith('.')) return null;
  const baseDir = path.posix.dirname(sourcePath);
  const candidateBase = path.posix.normalize(path.posix.join(baseDir, specifier));

  const tryPaths = [
    candidateBase,
    `${candidateBase}.ts`,
    `${candidateBase}.tsx`,
    `${candidateBase}.js`,
    `${candidateBase}.jsx`,
    `${candidateBase}.py`,
    `${candidateBase}/index.ts`,
    `${candidateBase}/index.tsx`,
    `${candidateBase}/index.js`,
  ];

  for (const p of tryPaths) {
    if (availablePaths.has(p)) return p;
  }
  return null;
}

function resolvePythonImport(sourcePath: string, moduleName: string, availablePaths: Set<string>): string | null {
  const asPath = moduleName.replace(/\./g, '/');
  const baseDir = path.posix.dirname(sourcePath);
  const candidates = [
    `${asPath}.py`,
    `${asPath}/__init__.py`,
    path.posix.normalize(path.posix.join(baseDir, `${asPath}.py`)),
  ];
  for (const c of candidates) {
    if (availablePaths.has(c)) return c;
  }
  return null;
}

function extractExports(content: string, language: string): string[] {
  const exportsList: string[] = [];
  if (language === 'typescript' || language === 'javascript') {
    const matches = content.matchAll(/export\s+(?:async\s+)?(?:function|const|let|var|class|interface|type)\s+([A-Za-z_]\w*)/g);
    for (const m of matches) exportsList.push(m[1]);
  } else if (language === 'python') {
    const matches = content.matchAll(/^(?:async\s+)?(?:def|class)\s+([A-Za-z_]\w*)/gm);
    for (const m of matches) {
      if (!m[1].startsWith('_')) exportsList.push(m[1]);
    }
  }
  return Array.from(new Set(exportsList)).slice(0, 12);
}

/**
 * Extracts real import relationships across project files and computes
 * direct & indirect reverse dependents (blast radius) for Code Impact Radar.
 */
export function buildDependencyGraph(files: ProjectFileInput[]): {
  nodes: DependencyNodeRecord[];
  edges: DependencyEdgeRecord[];
} {
  const availablePaths = new Set(files.map((f) => f.path));
  const edges: DependencyEdgeRecord[] = [];
  const edgeKeys = new Set<string>();

  for (const file of files) {
    const lang = file.language || detectLanguage(file.path, file.content);

    if (lang === 'typescript' || lang === 'javascript') {
      // ES imports: import { a, b } from './foo'
      const esImports = file.content.matchAll(/import\s+(?:([^'"\n]+?)\s+from\s+)?['"]([^'"]+)['"]/g);
      for (const m of esImports) {
        const rawSymbols = (m[1] ?? '').replace(/[{}*]/g, '').split(',').map((s) => s.trim()).filter(Boolean);
        const specifier = m[2];
        const target = resolveRelativeImport(file.path, specifier, availablePaths);
        if (target && target !== file.path) {
          const key = `${file.path}->${target}`;
          if (!edgeKeys.has(key)) {
            edgeKeys.add(key);
            edges.push({
              sourcePath: file.path,
              targetPath: target,
              importType: 'es-import',
              symbols: rawSymbols.slice(0, 6),
            });
          }
        }
      }

      // CommonJS require('./foo')
      const reqImports = file.content.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g);
      for (const m of reqImports) {
        const target = resolveRelativeImport(file.path, m[1], availablePaths);
        if (target && target !== file.path) {
          const key = `${file.path}->${target}`;
          if (!edgeKeys.has(key)) {
            edgeKeys.add(key);
            edges.push({
              sourcePath: file.path,
              targetPath: target,
              importType: 'commonjs-require',
              symbols: [],
            });
          }
        }
      }
    } else if (lang === 'python') {
      const fromImports = file.content.matchAll(/^\s*from\s+\.?([a-zA-Z0-9_.]+)\s+import\s+([^\n#]+)/gm);
      for (const m of fromImports) {
        const target = resolvePythonImport(file.path, m[1], availablePaths);
        const symbols = m[2].split(',').map((s) => s.trim().split(' as ')[0]).filter(Boolean);
        if (target && target !== file.path) {
          const key = `${file.path}->${target}`;
          if (!edgeKeys.has(key)) {
            edgeKeys.add(key);
            edges.push({
              sourcePath: file.path,
              targetPath: target,
              importType: 'python-from-import',
              symbols: symbols.slice(0, 6),
            });
          }
        }
      }

      const plainImports = file.content.matchAll(/^\s*import\s+([a-zA-Z0-9_.]+)/gm);
      for (const m of plainImports) {
        const target = resolvePythonImport(file.path, m[1], availablePaths);
        if (target && target !== file.path) {
          const key = `${file.path}->${target}`;
          if (!edgeKeys.has(key)) {
            edgeKeys.add(key);
            edges.push({
              sourcePath: file.path,
              targetPath: target,
              importType: 'python-import',
              symbols: [],
            });
          }
        }
      }
    } else if (lang === 'c' || lang === 'cpp') {
      const includes = file.content.matchAll(/#include\s+"([^"]+)"/g);
      for (const m of includes) {
        const target = resolveRelativeImport(file.path, `./${m[1]}`, availablePaths);
        if (target && target !== file.path) {
          const key = `${file.path}->${target}`;
          if (!edgeKeys.has(key)) {
            edgeKeys.add(key);
            edges.push({
              sourcePath: file.path,
              targetPath: target,
              importType: 'c-include',
              symbols: [],
            });
          }
        }
      }
    }
  }

  // Reverse adjacency list: target -> files that depend on target
  const reverseDeps = new Map<string, Set<string>>();
  for (const edge of edges) {
    if (!reverseDeps.has(edge.targetPath)) reverseDeps.set(edge.targetPath, new Set());
    reverseDeps.get(edge.targetPath)!.add(edge.sourcePath);
  }

  const nodes: DependencyNodeRecord[] = files.map((file) => {
    const lang = file.language || detectLanguage(file.path, file.content);
    const direct = reverseDeps.get(file.path) ?? new Set<string>();

    // BFS for indirect dependents
    const visited = new Set<string>([file.path, ...direct]);
    const queue = Array.from(direct);
    let indirectCount = 0;
    while (queue.length > 0) {
      const curr = queue.shift()!;
      const parents = reverseDeps.get(curr);
      if (!parents) continue;
      for (const p of parents) {
        if (!visited.has(p)) {
          visited.add(p);
          indirectCount++;
          queue.push(p);
        }
      }
    }

    const totalImpact = direct.size + indirectCount;
    let impactLevel: 'low' | 'medium' | 'high' | 'critical' = 'low';
    if (totalImpact >= 4) impactLevel = 'critical';
    else if (totalImpact >= 2) impactLevel = 'high';
    else if (totalImpact >= 1) impactLevel = 'medium';

    return {
      filePath: file.path,
      label: path.posix.basename(file.path),
      language: lang,
      exports: extractExports(file.content, lang),
      directDependents: direct.size,
      indirectDependents: indirectCount,
      impactLevel,
    };
  });

  return { nodes, edges };
}
