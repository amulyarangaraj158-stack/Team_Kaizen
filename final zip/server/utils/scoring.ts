export type RiskCategory = 'Low' | 'Medium' | 'High' | 'Critical';

export interface ScoreFactor {
  name: string;
  impact: 'positive' | 'negative' | 'neutral';
  weight: string;
  detail: string;
}

export interface PatchScoreInput {
  bugCategory: string;
  bugSeverity: 'critical' | 'high' | 'medium' | 'low';
  originalCode: string;
  proposedCode: string;
  filePath: string;
  changedFilesCount: number;
  directDependentsCount: number;
  indirectDependentsCount: number;
  hasUnitTests: boolean;
  testsPassedAfterPatch?: boolean | null;
  newlyFailedTestsCount?: number;
  analyzerVerified?: boolean;
}

export interface PatchScoreReport {
  confidenceScore: number; // 0 - 100
  riskScore: number; // 0 - 100
  riskCategory: RiskCategory;
  scoreExplanation: string;
  factors: ScoreFactor[];
}

const SENSITIVE_PATH_PATTERNS = [
  /auth/i,
  /security/i,
  /payment/i,
  /billing/i,
  /crypto/i,
  /token/i,
  /session/i,
  /database|db|sql|migration/i,
  /middleware/i,
  /permission|rbac|acl/i,
];

function countChangedLines(before: string, after: string): number {
  const aLines = before.split('\n');
  const bLines = after.split('\n');
  const maxLen = Math.max(aLines.length, bLines.length);
  let diff = 0;
  for (let i = 0; i < maxLen; i++) {
    if ((aLines[i] ?? '') !== (bLines[i] ?? '')) {
      diff++;
    }
  }
  return diff;
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(val)));
}

/**
 * Computes transparent, deterministic Fix Confidence and Change Risk scores.
 * Explicitly separates resolution confidence from side-effect risk and explains
 * every contributing signal rather than claiming an opaque probability.
 */
export function calculatePatchScores(input: PatchScoreInput): PatchScoreReport {
  const factors: ScoreFactor[] = [];

  // --- A. Fix Confidence Calculation ---
  let confidence = 64;

  const changedLines = countChangedLines(input.originalCode, input.proposedCode);
  const codeActuallyChanged = input.originalCode.trim() !== input.proposedCode.trim();

  if (!codeActuallyChanged) {
    confidence = 15;
    factors.push({
      name: 'Patch Diff Delta',
      impact: 'negative',
      weight: '-49 conf',
      detail: 'Proposed patch is identical to original code and does not address the bug.',
    });
  } else if (changedLines <= 15) {
    confidence += 12;
    factors.push({
      name: 'Targeted Minimal Diff',
      impact: 'positive',
      weight: '+12 conf',
      detail: `Focused change touching ${changedLines} line(s) reduces unintended logic drift.`,
    });
  } else if (changedLines <= 45) {
    confidence += 5;
    factors.push({
      name: 'Moderate Diff Scope',
      impact: 'neutral',
      weight: '+5 conf',
      detail: `Patch modifies ${changedLines} lines of code.`,
    });
  } else {
    confidence -= 8;
    factors.push({
      name: 'Large Diff Surface',
      impact: 'negative',
      weight: '-8 conf',
      detail: `Broad rewrite (${changedLines} lines modified) increases review scrutiny.`,
    });
  }

  if (input.analyzerVerified) {
    confidence += 9;
    factors.push({
      name: 'Static Analyzer Corroboration',
      impact: 'positive',
      weight: '+9 conf',
      detail: 'Issue was pinpointed with exact line diagnostics from the static analyzer.',
    });
  }

  const wellUnderstoodCategories = ['security', 'sql_injection', 'null_safety', 'type_error', 'syntax', 'async_error', 'resource_leak'];
  if (wellUnderstoodCategories.includes(input.bugCategory.toLowerCase())) {
    confidence += 6;
    factors.push({
      name: 'Well-Defined Bug Category',
      impact: 'positive',
      weight: '+6 conf',
      detail: `Category "${input.bugCategory}" follows deterministic remediation patterns.`,
    });
  }

  if (input.testsPassedAfterPatch === true && (input.newlyFailedTestsCount ?? 0) === 0) {
    confidence += 14;
    factors.push({
      name: 'Sandbox Regression Verification',
      impact: 'positive',
      weight: '+14 conf',
      detail: 'Isolated sandbox test run passed with zero newly introduced regressions.',
    });
  } else if (input.testsPassedAfterPatch === false || (input.newlyFailedTestsCount ?? 0) > 0) {
    confidence -= 28;
    factors.push({
      name: 'Sandbox Test Failures',
      impact: 'negative',
      weight: '-28 conf',
      detail: `Isolated test run reported ${input.newlyFailedTestsCount ?? 1} regression failure(s).`,
    });
  } else if (!input.hasUnitTests) {
    confidence -= 7;
    factors.push({
      name: 'No Automated Test Suite',
      impact: 'negative',
      weight: '-7 conf',
      detail: 'Confidence is heuristic-limited because no runnable test file was found for this project.',
    });
  }

  // --- B. Change Risk Calculation ---
  let risk = 14;

  if (input.changedFilesCount > 1) {
    const filePenalty = Math.min(25, (input.changedFilesCount - 1) * 10);
    risk += filePenalty;
    factors.push({
      name: 'Multi-File Blast Radius',
      impact: 'negative',
      weight: `+${filePenalty} risk`,
      detail: `Changes span ${input.changedFilesCount} files, increasing integration risk.`,
    });
  }

  const depPenalty = Math.min(28, input.directDependentsCount * 7 + input.indirectDependentsCount * 3);
  if (depPenalty > 0) {
    risk += depPenalty;
    factors.push({
      name: 'Dependency Graph Impact',
      impact: depPenalty >= 15 ? 'negative' : 'neutral',
      weight: `+${depPenalty} risk`,
      detail: `${input.directDependentsCount} direct and ${input.indirectDependentsCount} indirect dependent module(s) import this file.`,
    });
  }

  const isSensitivePath = SENSITIVE_PATH_PATTERNS.some((re) => re.test(input.filePath));
  if (isSensitivePath) {
    risk += 18;
    factors.push({
      name: 'Sensitive Code Path',
      impact: 'negative',
      weight: '+18 risk',
      detail: `File "${input.filePath}" touches a security, payment, authentication, or database boundary.`,
    });
  }

  if (changedLines > 35) {
    risk += 12;
  } else if (changedLines > 15) {
    risk += 5;
  }

  if (!input.hasUnitTests) {
    risk += 14;
    factors.push({
      name: 'Missing Test Coverage',
      impact: 'negative',
      weight: '+14 risk',
      detail: 'Side effects cannot be automatically checked without an automated test suite.',
    });
  } else if (input.testsPassedAfterPatch === true && (input.newlyFailedTestsCount ?? 0) === 0) {
    risk -= 10;
    factors.push({
      name: 'Verified Against Test Baseline',
      impact: 'positive',
      weight: '-10 risk',
      detail: 'Baseline regression suite confirmed unchanged behavior across existing tests.',
    });
  } else if (input.testsPassedAfterPatch === false || (input.newlyFailedTestsCount ?? 0) > 0) {
    risk += 26;
  }

  const confidenceScore = clamp(confidence, 5, 98);
  const riskScore = clamp(risk, 5, 99);

  let riskCategory: RiskCategory = 'Low';
  if (riskScore >= 75) riskCategory = 'Critical';
  else if (riskScore >= 50) riskCategory = 'High';
  else if (riskScore >= 26) riskCategory = 'Medium';

  const scoreExplanation =
    `Heuristic engineering estimate (not a statistical probability). ` +
    `Fix Confidence (${confidenceScore}/100) weighs diff precision (${changedLines} changed line${changedLines === 1 ? '' : 's'}), ` +
    `static diagnostic match, and ${input.testsPassedAfterPatch === true ? 'passing sandbox regression checks' : input.testsPassedAfterPatch === false ? 'failing sandbox test results' : 'pending test verification'}. ` +
    `Change Risk (${riskScore}/100 · ${riskCategory}) weighs ${input.directDependentsCount} direct dependent(s), ` +
    `${isSensitivePath ? 'sensitive execution path exposure' : 'standard module path'}, and test coverage availability.`;

  return {
    confidenceScore,
    riskScore,
    riskCategory,
    scoreExplanation,
    factors,
  };
}
