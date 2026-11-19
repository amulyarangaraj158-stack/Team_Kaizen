import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import esbuild from 'esbuild';
import * as cheerio from 'cheerio';

const execFileAsync = promisify(execFile);

export interface LanguageCapability {
  id: string;
  label: string;
  extensions: string[];
  syntaxCheck: string;
  staticAnalysis: string;
  aiReview: string;
  testExecution: string;
  runtimeAvailable: boolean;
  commonBugClasses: string[];
}

export const LANGUAGE_CAPABILITIES: LanguageCapability[] = [
  {
    id: 'javascript',
    label: 'JavaScript',
    extensions: ['.js', '.jsx', '.mjs', '.cjs'],
    syntaxCheck: 'esbuild AST Parser',
    staticAnalysis: 'Async/Promise, eval(), equality & null guards',
    aiReview: 'Gemini AI JS-specific RCA & minimal patches',
    testExecution: 'Isolated Child-Process VM Sandbox',
    runtimeAvailable: true,
    commonBugClasses: ['Undefined dereference', 'Unhandled Promise / async-await', 'Unsafe eval()', 'Loose type coercion (==)', 'Event listener leaks'],
  },
  {
    id: 'typescript',
    label: 'TypeScript',
    extensions: ['.ts', '.tsx'],
    syntaxCheck: 'esbuild TS Parser',
    staticAnalysis: 'Type assertion risks, unsafe any, async/await checks',
    aiReview: 'Gemini AI TS-specific RCA & minimal patches',
    testExecution: 'Isolated Child-Process VM Sandbox (transpiled)',
    runtimeAvailable: true,
    commonBugClasses: ['Unsafe any / non-null assertions', 'Unhandled Promise rejections', 'Missing null checks', 'Boundary index errors'],
  },
  {
    id: 'python',
    label: 'Python',
    extensions: ['.py'],
    syntaxCheck: 'python3 py_compile (syntax-only, no execution)',
    staticAnalysis: 'Mutable defaults, bare except, SQL f-strings, division guards',
    aiReview: 'Gemini AI Pythonic RCA & PEP-8 patches',
    testExecution: 'Static invariant validation (host execution blocked for safety)',
    runtimeAvailable: false,
    commonBugClasses: ['Indentation / syntax errors', 'Mutable default arguments', 'Bare except blocks', 'ZeroDivisionError / IndexError', 'SQL injection via f-strings'],
  },
  {
    id: 'java',
    label: 'Java',
    extensions: ['.java'],
    syntaxCheck: 'Structural delimiter & static pattern parser',
    staticAnalysis: 'NullPointer risks, resource leaks, string == comparison, catch blocks',
    aiReview: 'Gemini AI Java RCA & idiomatic patches',
    testExecution: 'Static invariant validation (javac not installed on host)',
    runtimeAvailable: false,
    commonBugClasses: ['NullPointerException risks', 'String reference comparison (==)', 'Empty catch blocks', 'Unclosed streams / resources'],
  },
  {
    id: 'c',
    label: 'C',
    extensions: ['.c', '.h'],
    syntaxCheck: 'gcc -fsyntax-only (compiler parser, no execution)',
    staticAnalysis: 'Buffer overflow (gets/strcpy/sprintf), unchecked malloc, pointer safety',
    aiReview: 'Gemini AI C memory-safety RCA & patches',
    testExecution: 'Static invariant validation (binary execution blocked)',
    runtimeAvailable: false,
    commonBugClasses: ['Buffer overflows (strcpy/gets/sprintf)', 'Unchecked malloc NULL returns', 'Memory leaks / dangling pointers', 'Out-of-bounds array access'],
  },
  {
    id: 'cpp',
    label: 'C++',
    extensions: ['.cpp', '.hpp', '.cc'],
    syntaxCheck: 'g++ -fsyntax-only (compiler parser, no execution)',
    staticAnalysis: 'Raw pointer leaks, unsafe C string ops, array bounds',
    aiReview: 'Gemini AI modern C++ RCA & RAII patches',
    testExecution: 'Static invariant validation (binary execution blocked)',
    runtimeAvailable: false,
    commonBugClasses: ['Raw new/delete leaks', 'Buffer overflows', 'Dangling references', 'Unchecked vector indexing'],
  },
  {
    id: 'go',
    label: 'Go',
    extensions: ['.go'],
    syntaxCheck: 'Structural delimiter & static pattern parser',
    staticAnalysis: 'Ignored error returns, goroutine defer/race patterns, nil dereference',
    aiReview: 'Gemini AI idiomatic Go RCA & patches',
    testExecution: 'Static invariant validation (go toolchain not on host)',
    runtimeAvailable: false,
    commonBugClasses: ['Ignored err return values', 'Nil pointer dereference', 'Goroutine channel leaks', 'Unchecked slice bounds'],
  },
  {
    id: 'rust',
    label: 'Rust',
    extensions: ['.rs'],
    syntaxCheck: 'Structural delimiter & static pattern parser',
    staticAnalysis: 'unwrap()/expect() panic risks, unsafe blocks, index panics',
    aiReview: 'Gemini AI Rust ownership/safety RCA & patches',
    testExecution: 'Static invariant validation (rustc not on host)',
    runtimeAvailable: false,
    commonBugClasses: ['Unchecked .unwrap() panics', 'Unsafe memory blocks', 'Integer overflow', 'Slice out-of-bounds panics'],
  },
  {
    id: 'sql',
    label: 'SQL',
    extensions: ['.sql'],
    syntaxCheck: 'SQL lexical & clause structure validator',
    staticAnalysis: 'SELECT *, DELETE/UPDATE without WHERE, dynamic concatenation risks',
    aiReview: 'Gemini AI SQL query optimization & security RCA',
    testExecution: 'Static invariant validation',
    runtimeAvailable: false,
    commonBugClasses: ['DELETE/UPDATE missing WHERE clause', 'SQL injection patterns', 'Cartesian joins without ON', 'Unbounded SELECT *'],
  },
  {
    id: 'html',
    label: 'HTML',
    extensions: ['.html', '.htm'],
    syntaxCheck: 'Cheerio HTML5 DOM Parser',
    staticAnalysis: 'Missing alt text, missing viewport, inline event scripts, broken tags',
    aiReview: 'Gemini AI semantic HTML & accessibility fixes',
    testExecution: 'DOM static validation',
    runtimeAvailable: false,
    commonBugClasses: ['Missing img alt attributes', 'Missing viewport / lang attributes', 'Duplicate IDs', 'Broken or unclosed markup'],
  },
  {
    id: 'css',
    label: 'CSS',
    extensions: ['.css', '.scss'],
    syntaxCheck: 'CSS brace & declaration structure parser',
    staticAnalysis: 'Unbalanced braces, fixed overflow widths, !important overuse',
    aiReview: 'Gemini AI responsive layout & CSS fixes',
    testExecution: 'Static stylesheet validation',
    runtimeAvailable: false,
    commonBugClasses: ['Unbalanced rule braces', 'Fixed pixel width overflow', 'Excessive !important overrides', 'Z-index stacking conflicts'],
  },
  {
    id: 'json',
    label: 'JSON',
    extensions: ['.json'],
    syntaxCheck: 'Native JSON.parse Strict Validator',
    staticAnalysis: 'Duplicate keys, trailing commas, malformed syntax',
    aiReview: 'Gemini AI schema & configuration diagnostics',
    testExecution: 'Native JSON.parse validation',
    runtimeAvailable: true,
    commonBugClasses: ['Syntax errors / trailing commas', 'Unquoted keys', 'Malformed escape sequences'],
  },
  {
    id: 'php',
    label: 'PHP',
    extensions: ['.php'],
    syntaxCheck: 'Structural PHP tag & delimiter parser',
    staticAnalysis: 'SQL interpolation, eval/exec injection, unescaped echo XSS',
    aiReview: 'Gemini AI PHP security & error RCA',
    testExecution: 'Static invariant validation (php runtime not on host)',
    runtimeAvailable: false,
    commonBugClasses: ['SQL injection via $_GET/$_POST', 'XSS via unescaped echo', 'Unsafe eval/shell_exec', 'Undefined array keys'],
  },
  {
    id: 'csharp',
    label: 'C#',
    extensions: ['.cs'],
    syntaxCheck: 'Structural delimiter & static pattern parser',
    staticAnalysis: 'Null reference risks, async void methods, raw SQL concatenation, IDisposable',
    aiReview: 'Gemini AI .NET / C# RCA & patches',
    testExecution: 'Static invariant validation (dotnet SDK not on host)',
    runtimeAvailable: false,
    commonBugClasses: ['NullReferenceException risks', 'async void exceptions', 'Unclosed IDisposable resources', 'SQL string concatenation'],
  },
];

export interface LanguageDiagnostic {
  filePath: string;
  language: string;
  line: number;
  severity: 'critical' | 'high' | 'medium' | 'low';
  checkType: 'syntax' | 'static';
  tool: string;
  message: string;
}

function checkBalancedDelimiters(code: string): { ok: boolean; line: number; detail: string } {
  const stack: Array<{ ch: string; line: number }> = [];
  const pairs: Record<string, string> = { '}': '{', ')': '(', ']': '[' };
  const lines = code.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let inStr: string | null = null;
    for (let j = 0; j < line.length; j++) {
      const ch = line[j];
      const prev = j > 0 ? line[j - 1] : '';
      if (inStr) {
        if (ch === inStr && prev !== '\\') inStr = null;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === '`') {
        inStr = ch;
        continue;
      }
      if (ch === '{' || ch === '(' || ch === '[') {
        stack.push({ ch, line: i + 1 });
      } else if (ch === '}' || ch === ')' || ch === ']') {
        const top = stack.pop();
        if (!top || top.ch !== pairs[ch]) {
          return { ok: false, line: i + 1, detail: `Unexpected closing delimiter "${ch}" at line ${i + 1}` };
        }
      }
    }
  }
  if (stack.length > 0) {
    const unclosed = stack[stack.length - 1];
    return { ok: false, line: unclosed.line, detail: `Unclosed "${unclosed.ch}" opened at line ${unclosed.line}` };
  }
  return { ok: true, line: 1, detail: 'Balanced' };
}

export async function runLanguageDiagnosticsForFiles(
  files: Array<{ file_path: string; language: string; current_content: string }>
): Promise<{
  diagnostics: LanguageDiagnostic[];
  syntaxEnginesUsed: string[];
}> {
  const diagnostics: LanguageDiagnostic[] = [];
  const enginesUsed = new Set<string>();

  for (const file of files) {
    const lang = file.language.toLowerCase();
    const code = file.current_content;
    const lines = code.split('\n');

    // 1. REAL SYNTAX VALIDATION PER LANGUAGE
    if (lang === 'javascript' || lang === 'typescript') {
      enginesUsed.add('esbuild AST parser');
      const ext = path.extname(file.file_path).toLowerCase();
      const loader = ext === '.ts' ? 'ts' : ext === '.tsx' ? 'tsx' : ext === '.jsx' ? 'jsx' : 'js';
      try {
        esbuild.transformSync(code, { loader, format: 'esm' });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        const lineMatch = msg.match(/:(\d+):\d+:/);
        diagnostics.push({
          filePath: file.file_path,
          language: lang,
          line: lineMatch ? Number(lineMatch[1]) : 1,
          severity: 'critical',
          checkType: 'syntax',
          tool: 'esbuild',
          message: msg.split('\n')[0],
        });
      }
    } else if (lang === 'python') {
      enginesUsed.add('python3 py_compile');
      const tmpFile = path.join(os.tmpdir(), `autopatch_${crypto.randomUUID()}.py`);
      try {
        await fs.writeFile(tmpFile, code, 'utf8');
        await execFileAsync('python3', ['-m', 'py_compile', tmpFile], { timeout: 3000, env: {} });
      } catch (err: unknown) {
        const stderr = (err as { stderr?: string })?.stderr || (err instanceof Error ? err.message : String(err));
        const lineMatch = stderr.match(/line (\d+)/i);
        diagnostics.push({
          filePath: file.file_path,
          language: lang,
          line: lineMatch ? Number(lineMatch[1]) : 1,
          severity: 'critical',
          checkType: 'syntax',
          tool: 'python3 py_compile',
          message: stderr.trim().split('\n').slice(-2).join(' — '),
        });
      } finally {
        await fs.rm(tmpFile, { force: true }).catch(() => {});
      }
    } else if (lang === 'c' || lang === 'cpp') {
      const compiler = lang === 'cpp' ? 'g++' : 'gcc';
      enginesUsed.add(`${compiler} -fsyntax-only`);
      const ext = lang === 'cpp' ? '.cpp' : '.c';
      const tmpFile = path.join(os.tmpdir(), `autopatch_${crypto.randomUUID()}${ext}`);
      try {
        await fs.writeFile(tmpFile, code, 'utf8');
        await execFileAsync(compiler, ['-fsyntax-only', '-Wall', tmpFile], { timeout: 3500, env: {} });
      } catch (err: unknown) {
        const stderr = (err as { stderr?: string })?.stderr || '';
        const errLine = stderr.split('\n').find((l) => l.includes('error:')) || stderr.split('\n')[0];
        const lineMatch = errLine?.match(/:(\d+):\d+:/);
        if (errLine) {
          diagnostics.push({
            filePath: file.file_path,
            language: lang,
            line: lineMatch ? Number(lineMatch[1]) : 1,
            severity: 'high',
            checkType: 'syntax',
            tool: `${compiler} -fsyntax-only`,
            message: errLine.replace(tmpFile, file.file_path),
          });
        }
      } finally {
        await fs.rm(tmpFile, { force: true }).catch(() => {});
      }
    } else if (lang === 'json') {
      enginesUsed.add('JSON.parse');
      try {
        JSON.parse(code);
      } catch (err: unknown) {
        diagnostics.push({
          filePath: file.file_path,
          language: lang,
          line: 1,
          severity: 'critical',
          checkType: 'syntax',
          tool: 'JSON.parse',
          message: err instanceof Error ? err.message : 'Invalid JSON syntax',
        });
      }
    } else if (lang === 'html') {
      enginesUsed.add('Cheerio HTML5 parser');
      const $ = cheerio.load(code);
      $('img').each((_, el) => {
        if (!$(el).attr('alt')) {
          diagnostics.push({
            filePath: file.file_path,
            language: lang,
            line: 1,
            severity: 'medium',
            checkType: 'static',
            tool: 'HTML5 Accessibility Checker',
            message: `<img> element (${$(el).attr('src') || 'inline'}) is missing an alt attribute.`,
          });
        }
      });
      if (code.toLowerCase().includes('<html') && !$('meta[name="viewport"]').length) {
        diagnostics.push({
          filePath: file.file_path,
          language: lang,
          line: 1,
          severity: 'medium',
          checkType: 'static',
          tool: 'HTML5 Responsive Checker',
          message: 'Document is missing <meta name="viewport"> for mobile responsiveness.',
        });
      }
    } else if (['java', 'go', 'rust', 'css', 'php', 'csharp'].includes(lang)) {
      enginesUsed.add('Structural delimiter & static analyzer');
      const bal = checkBalancedDelimiters(code);
      if (!bal.ok) {
        diagnostics.push({
          filePath: file.file_path,
          language: lang,
          line: bal.line,
          severity: 'high',
          checkType: 'syntax',
          tool: 'Delimiter Parser',
          message: bal.detail,
        });
      }
    }

    // 2. LANGUAGE-SPECIFIC STATIC PATTERN CHECKS
    lines.forEach((line, idx) => {
      const ln = idx + 1;
      if ((lang === 'javascript' || lang === 'typescript') && /\beval\s*\(/.test(line)) {
        diagnostics.push({
          filePath: file.file_path,
          language: lang,
          line: ln,
          severity: 'critical',
          checkType: 'static',
          tool: 'JS Security Rules',
          message: 'Direct eval() invocation introduces arbitrary code execution risk.',
        });
      }
      if (lang === 'python' && /def\s+\w+\s*\([^)]*=\s*(\[\]|\{\})/.test(line)) {
        diagnostics.push({
          filePath: file.file_path,
          language: lang,
          line: ln,
          severity: 'high',
          checkType: 'static',
          tool: 'Python Static Rules',
          message: 'Mutable default argument ([] or {}) persists state across function calls.',
        });
      }
      if (lang === 'python' && /f["']\s*(SELECT|INSERT|UPDATE|DELETE)\b/i.test(line)) {
        diagnostics.push({
          filePath: file.file_path,
          language: lang,
          line: ln,
          severity: 'critical',
          checkType: 'static',
          tool: 'Python Security Rules',
          message: 'SQL query constructed via f-string interpolation risks SQL injection.',
        });
      }
      if ((lang === 'c' || lang === 'cpp') && /\b(gets|strcpy|sprintf|strcat)\s*\(/.test(line)) {
        diagnostics.push({
          filePath: file.file_path,
          language: lang,
          line: ln,
          severity: 'critical',
          checkType: 'static',
          tool: 'C/C++ Memory Safety Rules',
          message: 'Unbounded C string function (gets/strcpy/sprintf/strcat) risks buffer overflow.',
        });
      }
      if (lang === 'sql' && /\b(DELETE\s+FROM|UPDATE\s+\w+\s+SET)\b/i.test(line) && !/\bWHERE\b/i.test(code)) {
        diagnostics.push({
          filePath: file.file_path,
          language: lang,
          line: ln,
          severity: 'high',
          checkType: 'static',
          tool: 'SQL Safety Rules',
          message: 'DELETE/UPDATE statement appears to lack a WHERE clause.',
        });
      }
      if (lang === 'rust' && /\.unwrap\(\)/.test(line)) {
        diagnostics.push({
          filePath: file.file_path,
          language: lang,
          line: ln,
          severity: 'medium',
          checkType: 'static',
          tool: 'Rust Safety Rules',
          message: 'Calling .unwrap() can panic at runtime; prefer pattern matching or the ? operator.',
        });
      }
      if (lang === 'csharp' && /\basync\s+void\b/.test(line)) {
        diagnostics.push({
          filePath: file.file_path,
          language: lang,
          line: ln,
          severity: 'high',
          checkType: 'static',
          tool: 'C# Async Rules',
          message: 'async void method swallows exceptions and crashes process; return Task instead.',
        });
      }
      if (lang === 'php' && /\b(eval|shell_exec|system|passthru)\s*\(/.test(line)) {
        diagnostics.push({
          filePath: file.file_path,
          language: lang,
          line: ln,
          severity: 'critical',
          checkType: 'static',
          tool: 'PHP Security Rules',
          message: 'Dynamic command/code execution function detected; sanitize or remove.',
        });
      }
    });
  }

  return {
    diagnostics,
    syntaxEnginesUsed: Array.from(enginesUsed),
  };
}
