import test from 'node:test';
import assert from 'node:assert/strict';
import { calculatePatchScores } from './scoring';

test('calculatePatchScores boosts confidence and lowers risk when sandbox tests pass', () => {
  const noTests = calculatePatchScores({
    bugCategory: 'sql_injection',
    bugSeverity: 'critical',
    originalCode: 'const q = `SELECT * FROM users WHERE id = ${id}`;',
    proposedCode: 'const q = "SELECT * FROM users WHERE id = ?";',
    filePath: 'src/db/users.ts',
    changedFilesCount: 1,
    directDependentsCount: 1,
    indirectDependentsCount: 0,
    hasUnitTests: false,
    testsPassedAfterPatch: null,
    analyzerVerified: true,
  });

  const withPassingTests = calculatePatchScores({
    bugCategory: 'sql_injection',
    bugSeverity: 'critical',
    originalCode: 'const q = `SELECT * FROM users WHERE id = ${id}`;',
    proposedCode: 'const q = "SELECT * FROM users WHERE id = ?";',
    filePath: 'src/db/users.ts',
    changedFilesCount: 1,
    directDependentsCount: 1,
    indirectDependentsCount: 0,
    hasUnitTests: true,
    testsPassedAfterPatch: true,
    newlyFailedTestsCount: 0,
    analyzerVerified: true,
  });

  assert.ok(withPassingTests.confidenceScore > noTests.confidenceScore);
  assert.ok(withPassingTests.riskScore < noTests.riskScore);
  assert.ok(withPassingTests.factors.length >= 3);
  assert.ok(withPassingTests.scoreExplanation.includes('Heuristic engineering estimate'));
});

test('calculatePatchScores escalates risk to High/Critical for sensitive paths with test regressions', () => {
  const report = calculatePatchScores({
    bugCategory: 'security',
    bugSeverity: 'critical',
    originalCode: 'export const ok = true;',
    proposedCode: 'export const ok = false;',
    filePath: 'src/auth/paymentSecurity.ts',
    changedFilesCount: 3,
    directDependentsCount: 4,
    indirectDependentsCount: 3,
    hasUnitTests: true,
    testsPassedAfterPatch: false,
    newlyFailedTestsCount: 2,
    analyzerVerified: true,
  });

  assert.ok(report.riskScore >= 75);
  assert.equal(report.riskCategory, 'Critical');
  assert.ok(report.confidenceScore < 65);
});
