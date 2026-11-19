import { jsPDF } from 'jspdf';
import type {
  BugSeverity,
  BugStatus,
  DetectedBug,
  PatchAuditEvent,
  ProjectSummary,
  ScanHistoryRecord,
  SuggestedFix,
  TestResultRecord,
} from '../types';

export function formatTimestamp(ts: string | null | undefined): string {
  if (!ts) return 'Never';
  const normalized = ts.includes('T') ? ts : `${ts.replace(' ', 'T')}Z`;
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) return ts;
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function severityTextClass(severity: BugSeverity | string): string {
  switch (severity) {
    case 'critical':
      return 'text-red-400';
    case 'high':
      return 'text-amber-400';
    case 'medium':
      return 'text-blue-400';
    case 'low':
      return 'text-emerald-400';
    default:
      return 'text-slate-400';
  }
}

export function severityHex(severity: string): string {
  switch (severity) {
    case 'critical':
      return '#EF4444';
    case 'high':
      return '#F59E0B';
    case 'medium':
      return '#3B82F6';
    case 'low':
      return '#10B981';
    default:
      return '#64748B';
  }
}

export function statusLabel(status: BugStatus | string): { text: string; className: string } {
  switch (status) {
    case 'verified':
      return { text: 'Verified Fix', className: 'text-emerald-400' };
    case 'patched':
      return { text: 'Patched (Awaiting Test)', className: 'text-violet-400' };
    case 'patch_generated':
      return { text: 'Patch Ready', className: 'text-blue-400' };
    case 'rejected':
      return { text: 'Patch Rejected', className: 'text-slate-400' };
    case 'open':
    default:
      return { text: 'Open Defect', className: 'text-amber-400' };
  }
}

export function healthLabel(status: ProjectSummary['health_status']): { text: string; className: string } {
  switch (status) {
    case 'healthy':
      return { text: 'Healthy', className: 'text-emerald-400' };
    case 'warning':
      return { text: 'Needs Attention', className: 'text-amber-400' };
    case 'critical':
      return { text: 'Critical Risk', className: 'text-red-400' };
    default:
      return { text: 'Not Scanned', className: 'text-slate-400' };
  }
}

export function toMonacoLanguage(lang: string): string {
  const map: Record<string, string> = {
    javascript: 'javascript',
    typescript: 'typescript',
    python: 'python',
    java: 'java',
    c: 'c',
    cpp: 'cpp',
    html: 'html',
    css: 'css',
    scss: 'scss',
    json: 'json',
    sql: 'sql',
    go: 'go',
    rust: 'rust',
    ruby: 'ruby',
    php: 'php',
    csharp: 'csharp',
    markdown: 'markdown',
  };
  return map[lang] || 'plaintext';
}

export function downloadTextFile(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export interface FullReportPayload {
  generatedAt: string;
  generatedBy: { name: string; email: string; role: string };
  project: ProjectSummary;
  scans: ScanHistoryRecord[];
  bugs: DetectedBug[];
  fixes: SuggestedFix[];
  tests: TestResultRecord[];
}

export function exportProjectPdfReport(report: FullReportPayload): void {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 42;
  const maxWidth = pageWidth - margin * 2;
  let y = 50;

  const ensureSpace = (needed: number) => {
    if (y + needed > pageHeight - 48) {
      doc.addPage();
      y = 48;
    }
  };

  const addSectionTitle = (title: string) => {
    ensureSpace(34);
    y += 10;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(30, 58, 138);
    doc.text(title, margin, y);
    y += 6;
    doc.setDrawColor(203, 213, 225);
    doc.line(margin, y, pageWidth - margin, y);
    y += 16;
  };

  const addBodyLine = (label: string, value: string, indent = 0) => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(30, 41, 59);
    const labelText = label ? `${label}: ` : '';
    const fullText = `${labelText}${value}`;
    const lines = doc.splitTextToSize(fullText, maxWidth - indent) as string[];
    ensureSpace(lines.length * 13 + 4);
    doc.setFont('helvetica', 'normal');
    doc.text(lines, margin + indent, y);
    y += lines.length * 13 + 3;
  };

  // Header Banner
  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, pageWidth, 86, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.setTextColor(255, 255, 255);
  doc.text('AutoPatch AI — Engineering Audit & Repair Report', margin, 38);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(148, 163, 184);
  doc.text(
    `Project: ${report.project.name}  |  Generated: ${formatTimestamp(report.generatedAt)}  |  Engineer: ${report.generatedBy.name}`,
    margin,
    60
  );

  y = 108;

  // 1. Project & Scan Summary
  addSectionTitle('1. Project Overview & Scan Summary');
  addBodyLine('Project Name', report.project.name);
  addBodyLine('Description', report.project.description || 'No description provided');
  addBodyLine('Languages', (report.project.languages || [report.project.primary_language]).join(', '));
  addBodyLine('Scale', `${report.project.total_files} files, ${report.project.total_lines} lines of code`);
  addBodyLine('Health Status', report.project.health_status.toUpperCase());
  addBodyLine('Total Scans Executed', String(report.scans.length));

  // 2. Severity Distribution
  const crit = report.bugs.filter((b) => b.severity === 'critical').length;
  const high = report.bugs.filter((b) => b.severity === 'high').length;
  const med = report.bugs.filter((b) => b.severity === 'medium').length;
  const low = report.bugs.filter((b) => b.severity === 'low').length;
  const verified = report.bugs.filter((b) => b.status === 'verified').length;
  const patched = report.bugs.filter((b) => b.status === 'patched').length;

  addSectionTitle('2. Bug Severity Distribution & Remediation Status');
  addBodyLine('Total Detected Bugs', String(report.bugs.length));
  addBodyLine('Breakdown', `Critical: ${crit}  |  High: ${high}  |  Medium: ${med}  |  Low: ${low}`);
  addBodyLine('Verified Fixes', `${verified} verified, ${patched} patched awaiting tests, ${report.bugs.length - verified - patched} open/other`);

  // 3. Root Cause Analysis
  addSectionTitle('3. Detected Bugs & Root Cause Analysis');
  if (report.bugs.length === 0) {
    addBodyLine('', 'No defects recorded for this project.');
  } else {
    report.bugs.forEach((bug, idx) => {
      ensureSpace(95);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10.5);
      doc.setTextColor(15, 23, 42);
      const heading = `${idx + 1}. [${bug.severity.toUpperCase()}] ${bug.title}`;
      const hLines = doc.splitTextToSize(heading, maxWidth) as string[];
      doc.text(hLines, margin, y);
      y += hLines.length * 14 + 2;

      addBodyLine('Location', `${bug.file_path} (Lines ${bug.line_start}-${bug.line_end}) | Category: ${bug.category} | Status: ${bug.status}`, 10);
      addBodyLine('Metrics', `Impact: ${bug.impact_score}/100 | AI Confidence: ${bug.confidence}% | Priority: ${bug.priority_score}`, 10);
      addBodyLine('Root Cause', bug.root_cause, 10);
      addBodyLine('Potential Impact', bug.potential_impact, 10);
      addBodyLine('Suggested Solution', bug.suggested_solution, 10);
      y += 6;
    });
  }

  // 4. Accepted & Suggested Fixes
  addSectionTitle('4. AI Code Repairs & Safe Patch Approvals');
  if (report.fixes.length === 0) {
    addBodyLine('', 'No AI repair patches have been generated yet.');
  } else {
    report.fixes.forEach((fix, idx) => {
      ensureSpace(64);
      addBodyLine(
        `Patch ${idx + 1} (${fix.status.toUpperCase()})`,
        `${fix.bug_title || fix.bug_id} — ${fix.file_path || ''} (Confidence: ${fix.confidence}%)`
      );
      addBodyLine('Change Explanation', fix.explanation, 10);
      if (fix.risks?.length) {
        addBodyLine('Identified Risks', fix.risks.join('; '), 10);
      }
      y += 4;
    });
  }

  // 5. Test Guardian Validation Summary
  addSectionTitle('5. Test Guardian Validation & Final Summary');
  if (report.tests.length === 0) {
    addBodyLine('', 'No validation test runs have been recorded yet.');
  } else {
    report.tests.forEach((tr, idx) => {
      ensureSpace(48);
      addBodyLine(
        `Run ${idx + 1} [${tr.phase.toUpperCase()}-FIX | ${tr.execution_mode}]`,
        `${tr.bug_title || ''} — ${tr.passed_tests}/${tr.total_tests} passed | Status: ${tr.validation_status.toUpperCase()}${tr.regression_detected ? ' | REGRESSION DETECTED' : ''}`
      );
      addBodyLine('Summary', tr.summary, 10);
    });
  }

  const safeFile = report.project.name
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '');
  doc.save(`${safeFile || 'autopatch'}-audit-report.pdf`);
}

export function exportAuditTrailPdf(events: PatchAuditEvent[], filterSummary: string): void {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 40;
  const maxWidth = pageWidth - margin * 2;
  let y = 50;

  const ensureSpace = (needed: number) => {
    if (y + needed > pageHeight - 44) {
      doc.addPage();
      y = 44;
    }
  };

  doc.setFillColor(12, 19, 36);
  doc.rect(0, 0, pageWidth, 82, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(255, 255, 255);
  doc.text('AutoPatch AI — Append-Only Patch Audit Trail', margin, 36);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(148, 163, 184);
  doc.text(`Exported: ${formatTimestamp(new Date().toISOString())}  |  Records: ${events.length}  |  ${filterSummary}`, margin, 58);

  y = 104;

  if (events.length === 0) {
    doc.setFontSize(10);
    doc.setTextColor(71, 85, 105);
    doc.text('No patch audit events matched the selected filters.', margin, y);
  } else {
    events.forEach((ev, idx) => {
      ensureSpace(74);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.setTextColor(15, 23, 42);
      const header = `${idx + 1}. [${ev.event_type.toUpperCase()}] ${ev.project_name || ev.project_id} — ${ev.file_path || 'Project'}`;
      const hLines = doc.splitTextToSize(header, maxWidth) as string[];
      doc.text(hLines, margin, y);
      y += hLines.length * 13 + 2;

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(51, 65, 85);
      const meta = `Timestamp: ${formatTimestamp(ev.created_at)} | Actor: ${ev.actor_name} | Decision: ${ev.decision_status || 'n/a'} | Test: ${ev.test_status || 'n/a'}${ev.bug_id ? ` | Bug: ${ev.bug_id.slice(0, 8)}` : ''}${ev.patch_id ? ` | Patch: ${ev.patch_id.slice(0, 8)}` : ''}`;
      const mLines = doc.splitTextToSize(meta, maxWidth - 10) as string[];
      doc.text(mLines, margin + 10, y);
      y += mLines.length * 12 + 2;

      const sLines = doc.splitTextToSize(`Summary: ${ev.summary}`, maxWidth - 10) as string[];
      ensureSpace(sLines.length * 12 + 8);
      doc.text(sLines, margin + 10, y);
      y += sLines.length * 12 + 8;

      doc.setDrawColor(226, 232, 240);
      doc.line(margin, y - 4, pageWidth - margin, y - 4);
    });
  }

  doc.save(`autopatch-audit-trail-${new Date().toISOString().slice(0, 10)}.pdf`);
}

