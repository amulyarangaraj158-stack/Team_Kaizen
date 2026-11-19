import path from 'node:path';

export interface ProjectFileRecord {
  id: string;
  file_path: string;
  file_name: string;
  language: string;
  line_count: number;
  current_content: string;
}

export interface ProjectBugRecord {
  id: string;
  file_id: string;
  file_path: string;
  line_start: number;
  line_end: number;
  title: string;
  category: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  status: string;
  impact_score: number;
}

export interface ImpactNode {
  fileId: string;
  filePath: string;
  fileName: string;
  language: string;
  lineCount: number;
  functions: string[];
  bugCount: number;
  openBugCount: number;
  maxSeverity: 'critical' | 'high' | 'medium' | 'low' | 'none';
  riskScore: number;
  directImports: string[];
  importedBy: string[];
  cascadingRiskFiles: string[];
  affectedFunctions: string[];
  bugs: Array<{ id: string; title: string; severity: string; lineStart: number; status: string }>;
}

export interface ImpactEdge {
  from: string;
  to: string;
  statement: string;
}

function extractFunctions(content: string, language: string): Array<{ name: string; line: number }> {
  const lines = content.split('\n');
  const results: Array<{ name: string; line: number }> = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (language === 'javascript' || language === 'typescript') {
      const fnMatch =
        line.match(/(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/) ||
        line.match(/(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/) ||
        line.match(/class\s+([A-Za-z_$][\w$]*)/);
      if (fnMatch) results.push({ name: fnMatch[1], line: i + 1 });
    } else if (language === 'python') {
      const pyMatch = line.match(/^\s*(?:async\s+)?def\s+([A-Za-z_][\w]*)\s*\(/) || line.match(/^\s*class\s+([A-Za-z_][\w]*)/);
      if (pyMatch) results.push({ name: pyMatch[1], line: i + 1 });
    } else if (language === 'java' || language === 'c' || language === 'cpp') {
      const cMatch = line.match(/(?:public|private|protected|static|\s)+[\w<>[\]]+\s+([A-Za-z_][\w]*)\s*\([^;]*\)\s*\{/);
      if (cMatch && !['if', 'for', 'while', 'switch', 'catch'].includes(cMatch[1])) {
        results.push({ name: cMatch[1], line: i + 1 });
      }
    }
  }

  return results;
}

function resolveImportToProjectFile(
  fromFilePath: string,
  specifier: string,
  allFilePaths: string[],
  language: string
): string | null {
  const pathSet = new Set(allFilePaths);

  if (language === 'javascript' || language === 'typescript') {
    if (!specifier.startsWith('.')) return null;
    const baseDir = path.posix.dirname(fromFilePath);
    const resolved = path.posix.normalize(path.posix.join(baseDir, specifier));
    const candidates = [
      resolved,
      `${resolved}.js`,
      `${resolved}.ts`,
      `${resolved}.jsx`,
      `${resolved}.tsx`,
      `${resolved}.mjs`,
      `${resolved}/index.js`,
      `${resolved}/index.ts`,
    ];
    for (const c of candidates) {
      if (pathSet.has(c)) return c;
    }
    return null;
  }

  if (language === 'python') {
    const dotted = specifier.replace(/^\.+/, '').replace(/\./g, '/');
    const candidates = [`${dotted}.py`, `${dotted}/__init__.py`];
    for (const c of candidates) {
      if (pathSet.has(c)) return c;
    }
    // Also match relative to current dir
    const baseDir = path.posix.dirname(fromFilePath);
    const relCandidate = path.posix.normalize(path.posix.join(baseDir, `${dotted}.py`));
    if (pathSet.has(relCandidate)) return relCandidate;
    return null;
  }

  if (language === 'c' || language === 'cpp') {
    const baseDir = path.posix.dirname(fromFilePath);
    const candidate = path.posix.normalize(path.posix.join(baseDir, specifier));
    if (pathSet.has(candidate)) return candidate;
    if (pathSet.has(specifier)) return specifier;
  }

  return null;
}

function extractRawImports(content: string, language: string): Array<{ specifier: string; statement: string }> {
  const found: Array<{ specifier: string; statement: string }> = [];
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (language === 'javascript' || language === 'typescript') {
      const esm = trimmed.match(/import\s+.*?\s+from\s+['"]([^'"]+)['"]/);
      if (esm) found.push({ specifier: esm[1], statement: trimmed });
      const sideEffect = trimmed.match(/^import\s+['"]([^'"]+)['"]/);
      if (sideEffect) found.push({ specifier: sideEffect[1], statement: trimmed });
      const req = trimmed.match(/require\(\s*['"]([^'"]+)['"]\s*\)/);
      if (req) found.push({ specifier: req[1], statement: trimmed });
    } else if (language === 'python') {
      const fromImp = trimmed.match(/^from\s+([A-Za-z0-9_.]+)\s+import\s+/);
      if (fromImp) found.push({ specifier: fromImp[1], statement: trimmed });
      const plainImp = trimmed.match(/^import\s+([A-Za-z0-9_.]+)/);
      if (plainImp) found.push({ specifier: plainImp[1], statement: trimmed });
    } else if (language === 'c' || language === 'cpp') {
      const inc = trimmed.match(/^#include\s+"([^"]+)"/);
      if (inc) found.push({ specifier: inc[1], statement: trimmed });
    }
  }

  return found;
}

const SEVERITY_RANK: Record<string, number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

const SEVERITY_WEIGHT: Record<string, number> = {
  critical: 35,
  high: 22,
  medium: 12,
  low: 5,
};

export function analyzeProjectImpact(
  files: ProjectFileRecord[],
  bugs: ProjectBugRecord[]
): {
  nodes: ImpactNode[];
  edges: ImpactEdge[];
  hasVerifiedDependencies: boolean;
  summary: {
    highRiskFiles: number;
    totalDependencies: number;
    cascadingFilesCount: number;
  };
} {
  const allPaths = files.map((f) => f.file_path);
  const edges: ImpactEdge[] = [];
  const edgeKeys = new Set<string>();
  const directImportsMap: Record<string, string[]> = {};
  const importedByMap: Record<string, string[]> = {};

  for (const f of files) {
    directImportsMap[f.file_path] = [];
    importedByMap[f.file_path] = [];
  }

  for (const f of files) {
    const rawImports = extractRawImports(f.current_content, f.language);
    for (const imp of rawImports) {
      const target = resolveImportToProjectFile(f.file_path, imp.specifier, allPaths, f.language);
      if (target && target !== f.file_path) {
        const key = `${f.file_path}->${target}`;
        if (!edgeKeys.has(key)) {
          edgeKeys.add(key);
          edges.push({ from: f.file_path, to: target, statement: imp.statement });
          directImportsMap[f.file_path].push(target);
          importedByMap[target].push(f.file_path);
        }
      }
    }
  }

  // BFS to find downstream dependents (files that directly or transitively import a defective file)
  function getDownstreamDependents(startPath: string): string[] {
    const visited = new Set<string>();
    const queue = [...(importedByMap[startPath] || [])];
    while (queue.length > 0) {
      const curr = queue.shift()!;
      if (visited.has(curr) || curr === startPath) continue;
      visited.add(curr);
      for (const next of importedByMap[curr] || []) {
        if (!visited.has(next)) queue.push(next);
      }
    }
    return Array.from(visited);
  }

  const cascadingSet = new Set<string>();

  const nodes: ImpactNode[] = files.map((f) => {
    const fileBugs = bugs.filter((b) => b.file_id === f.id || b.file_path === f.file_path);
    const openBugs = fileBugs.filter((b) => b.status !== 'verified' && b.status !== 'rejected');
    const funcs = extractFunctions(f.current_content, f.language);

    // Map bug line numbers to enclosing function where determinable
    const affectedFnSet = new Set<string>();
    for (const b of fileBugs) {
      let enclosing: string | null = null;
      for (const fn of funcs) {
        if (fn.line <= b.line_start) {
          enclosing = fn.name;
        }
      }
      if (enclosing) affectedFnSet.add(enclosing);
    }

    let maxSeverity: ImpactNode['maxSeverity'] = 'none';
    let riskScore = 0;
    for (const b of openBugs) {
      if (SEVERITY_RANK[b.severity] > SEVERITY_RANK[maxSeverity]) {
        maxSeverity = b.severity;
      }
      riskScore += SEVERITY_WEIGHT[b.severity] || 5;
    }

    const dependents = getDownstreamDependents(f.file_path);
    if (openBugs.length > 0) {
      for (const dep of dependents) cascadingSet.add(dep);
      riskScore += dependents.length * 10;
    }

    return {
      fileId: f.id,
      filePath: f.file_path,
      fileName: f.file_name,
      language: f.language,
      lineCount: f.line_count,
      functions: funcs.map((fn) => fn.name),
      bugCount: fileBugs.length,
      openBugCount: openBugs.length,
      maxSeverity,
      riskScore: Math.min(100, riskScore),
      directImports: directImportsMap[f.file_path] || [],
      importedBy: importedByMap[f.file_path] || [],
      cascadingRiskFiles: openBugs.length > 0 ? dependents : [],
      affectedFunctions: Array.from(affectedFnSet),
      bugs: fileBugs.map((b) => ({
        id: b.id,
        title: b.title,
        severity: b.severity,
        lineStart: b.line_start,
        status: b.status,
      })),
    };
  });

  const highRiskFiles = nodes.filter((n) => n.maxSeverity === 'critical' || n.maxSeverity === 'high').length;

  return {
    nodes,
    edges,
    hasVerifiedDependencies: edges.length > 0,
    summary: {
      highRiskFiles,
      totalDependencies: edges.length,
      cascadingFilesCount: cascadingSet.size,
    },
  };
}
