export type WorkspaceModule =
  | 'dashboard'
  | 'projects'
  | 'explain'
  | 'scanner'
  | 'radar'
  | 'repair'
  | 'testing'
  | 'rollback'
  | 'patterns'
  | 'learning'
  | 'reports'
  | 'chat'
  | 'languages'
  | 'website'
  | 'multimedia'
  | 'audit';

export interface User {
  id: string;
  name: string;
  email: string;
  role: string;
  bio: string;
  created_at: string;
}

export interface ProjectSummary {
  id: string;
  user_id: string;
  name: string;
  description: string;
  primary_language: string;
  languages: string[];
  total_files: number;
  total_lines: number;
  health_status: 'healthy' | 'warning' | 'critical' | 'unscanned';
  last_scan_at: string | null;
  created_at: string;
  updated_at: string;
  total_bugs?: number;
  open_bugs?: number;
  verified_bugs?: number;
}

export interface UploadedFile {
  id: string;
  project_id: string;
  file_path: string;
  file_name: string;
  language: string;
  size_bytes: number;
  line_count: number;
  original_content: string;
  current_content: string;
  created_at: string;
  updated_at: string;
}

export type BugSeverity = 'critical' | 'high' | 'medium' | 'low';
export type BugStatus = 'open' | 'patch_generated' | 'patched' | 'verified' | 'rejected';

export interface DetectedBug {
  id: string;
  project_id: string;
  scan_id: string;
  file_id: string;
  file_path: string;
  line_start: number;
  line_end: number;
  title: string;
  category: string;
  severity: BugSeverity;
  impact_score: number;
  confidence: number;
  priority_score: number;
  description: string;
  why_occurred: string;
  root_cause: string;
  potential_impact: string;
  suggested_solution: string;
  status: BugStatus;
  created_at: string;
  updated_at: string;
  fix_count?: number;
  latest_fix_id?: string | null;
  latest_fix_status?: string | null;
}

export interface SuggestedFix {
  id: string;
  bug_id: string;
  project_id: string;
  file_id: string;
  original_code: string;
  patched_code: string;
  explanation: string;
  confidence: number;
  risks: string[];
  changeHighlights?: string[];
  status: 'pending' | 'accepted' | 'rejected' | 'rolled_back';
  applied_by_user_id: string | null;
  applied_by_name?: string | null;
  applied_at: string | null;
  created_at: string;
  bug_title?: string;
  bug_severity?: BugSeverity;
  file_path?: string;
  line_start?: number;
  bug_status?: BugStatus;
}

export interface CodeExplanation {
  summary: string;
  beginnerExplanation: string;
  stepByStep: Array<{ step: number; lines: string; title: string; detail: string }>;
  constructs: Array<{ name: string; kind: string; role: string }>;
  riskySections: Array<{ lineStart: number; lineEnd: number; severity: string; reason: string }>;
  complexity: {
    time: string;
    space: string;
    notes: string;
  };
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

export interface ImpactRadarData {
  nodes: ImpactNode[];
  edges: ImpactEdge[];
  hasVerifiedDependencies: boolean;
  summary: {
    highRiskFiles: number;
    totalDependencies: number;
    cascadingFilesCount: number;
  };
}

export interface GeneratedTestCase {
  id: string;
  name: string;
  category: 'normal' | 'invalid' | 'boundary';
  description: string;
  inputSummary: string;
  expectedSummary: string;
  jsTestBody: string;
  staticExpectPresent?: string;
  staticExpectAbsent?: string;
}

export interface ExecutedTestCase {
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

export interface TestResultRecord {
  id: string;
  project_id: string;
  bug_id: string;
  fix_id: string | null;
  phase: 'before' | 'after';
  execution_mode: 'isolated_vm' | 'static_validation';
  total_tests: number;
  passed_tests: number;
  failed_tests: number;
  regression_detected: boolean;
  validation_status: 'passed' | 'failed' | 'static_verified' | 'error';
  summary: string;
  cases: ExecutedTestCase[];
  created_at: string;
  bug_title?: string;
  file_path?: string;
  bug_severity?: BugSeverity;
  bug_status?: BugStatus;
}

export interface ChangeHistoryRecord {
  id: string;
  project_id: string;
  file_id: string;
  bug_id: string | null;
  fix_id: string | null;
  user_id: string;
  user_name: string;
  user_email?: string;
  file_path: string;
  bug_title?: string | null;
  action_type: 'patch_accepted' | 'patch_rejected' | 'rollback';
  before_content: string;
  after_content: string;
  latest_file_content?: string;
  baseline_file_content?: string;
  notes: string;
  created_at: string;
}

export interface ScanHistoryRecord {
  id: string;
  project_id: string;
  user_id: string;
  status: 'running' | 'completed' | 'failed';
  model_used: string;
  files_scanned: number;
  bugs_found: number;
  critical_count: number;
  high_count: number;
  medium_count: number;
  low_count: number;
  duration_ms: number;
  error_message: string | null;
  created_at: string;
}

export interface LearningInsight {
  id: string;
  user_id: string;
  project_id: string | null;
  concept_title: string;
  mistake_category: string;
  frequency_count: number;
  why_it_happens: string;
  explanation: string;
  recommendation: string;
  status: 'active' | 'practicing' | 'mastered';
  created_at: string;
  updated_at: string;
}

export interface NotificationItem {
  id: string;
  user_id: string;
  project_id: string | null;
  type: 'info' | 'success' | 'warning' | 'error';
  title: string;
  message: string;
  is_read: number;
  action_module?: string | null;
  project_name?: string | null;
  created_at: string;
}

export interface DashboardData {
  stats: {
    totalProjects: number;
    projectsAnalyzed: number;
    totalBugs: number;
    criticalBugs: number;
    highBugs: number;
    mediumBugs: number;
    lowBugs: number;
    bugsRepaired: number;
    verifiedFixes: number;
    pendingFixes: number;
    failedTests: number;
    passedTests: number;
    failedRepairs: number;
    fixSuccessRate: number;
    acceptedFixes: number;
    pendingPatches: number;
    rejectedPatches: number;
  };
  projects: ProjectSummary[];
  trends: Array<{ label: string; detected: number; resolved: number }>;
  activity: Array<{
    id: string;
    type: string;
    title: string;
    detail: string;
    projectId: string | null;
    timestamp: string;
  }>;
}

export interface ChatCodeSnippet {
  fileId?: string;
  filePath: string;
  lineStart: number;
  lineEnd: number;
  code: string;
}

export interface AiConversation {
  id: string;
  project_id: string;
  user_id: string;
  title: string;
  explanation_mode: 'beginner' | 'advanced';
  created_at: string;
  updated_at: string;
  message_count?: number;
  last_message_preview?: string | null;
}

export interface AiMessage {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant';
  content: string;
  code_context: ChatCodeSnippet | null;
  referenced_bug_ids: string[];
  referenced_files: Array<{
    filePath: string;
    lineStart: number;
    lineEnd: number;
    note: string;
  }>;
  follow_up_suggestions: string[];
  created_at: string;
}

export interface LanguageCapability {
  id: string;
  name: string;
  extensions: string[];
  syntaxCheck: 'compiler_parser' | 'structural_parser';
  syntaxEngine: string;
  staticAnalysis: boolean;
  aiReview: boolean;
  isolatedExecution: boolean;
  executionNotes: string;
  commonDefectClasses: string[];
}

export interface LanguageBreakdownItem {
  language: string;
  fileCount: number;
  totalLines: number;
  totalBytes: number;
  bugCount: number;
  openBugs: number;
  files: Array<{ id: string; filePath: string; lineCount: number }>;
  capability: LanguageCapability | null;
}

export interface LanguageDiagnostic {
  fileId: string;
  filePath: string;
  language: string;
  line: number;
  column?: number;
  severity: 'error' | 'warning' | 'info';
  source: 'syntax_engine' | 'static_rule';
  engine: string;
  code: string;
  message: string;
}

export interface WebsiteIssue {
  id: string;
  category: 'functional' | 'performance' | 'responsive' | 'accessibility' | 'seo';
  severity: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  description: string;
  evidence: string;
  recommendation: string;
}

export interface WebsiteAssetProbe {
  url: string;
  kind: 'link' | 'image' | 'script' | 'stylesheet' | 'media';
  status: number | null;
  ok: boolean;
  contentType: string | null;
  contentLength: number | null;
  latencyMs: number;
  error?: string;
}

export interface WebsiteScanRecord {
  id: string;
  user_id: string;
  url: string;
  final_url: string;
  status: 'completed' | 'auth_required' | 'failed';
  http_status: number | null;
  response_time_ms: number;
  page_title: string;
  embed_allowed: boolean;
  embed_block_reason: string | null;
  auth_required: boolean;
  analysis_mode: string;
  total_issues: number;
  category_counts: {
    functional: number;
    performance: number;
    responsive: number;
    accessibility: number;
    seo: number;
  };
  metrics: {
    htmlSizeBytes: number;
    redirectCount: number;
    contentType: string;
    serverHeader: string | null;
    totalImages: number;
    imagesMissingAlt: number;
    totalScripts: number;
    renderBlockingScripts: number;
    totalStylesheets: number;
    totalLinks: number;
    probedAssetsCount: number;
    brokenAssetsCount: number;
    hasViewportMeta: boolean;
    hasH1: boolean;
    hasMetaDescription: boolean;
    hasCanonical: boolean;
    hasLangAttr: boolean;
  };
  issues: WebsiteIssue[];
  assets: WebsiteAssetProbe[];
  created_at: string;
}

export interface MediaTechnicalIssue {
  severity: 'critical' | 'high' | 'medium' | 'low';
  category: string;
  title: string;
  detail: string;
  recommendation: string;
}

export interface MediaAiAssessment {
  qualityRating?: 'good' | 'fair' | 'poor';
  summary?: string;
  observations?: Array<{ severity: 'high' | 'medium' | 'low' | 'info'; title: string; detail: string }>;
  accessibilityNotes?: string[];
  recommendations?: string[];
  note?: string;
  unavailable?: boolean;
}

export interface MultimediaScanRecord {
  id: string;
  user_id: string;
  project_id: string | null;
  media_type: 'image' | 'video' | 'audio';
  file_name: string;
  mime_type: string;
  size_bytes: number;
  status: 'passed' | 'warnings' | 'failed';
  technical_engine: string;
  metadata: Record<string, unknown>;
  issues: MediaTechnicalIssue[];
  ai_assessment: MediaAiAssessment | null;
  created_at: string;
}

export interface ProjectMediaAuditResult {
  filesScanned: number;
  totalReferences: number;
  issues: Array<{
    filePath: string;
    line: number;
    reference: string;
    mediaType: 'image' | 'video' | 'audio';
    severity: 'high' | 'medium' | 'low';
    issue: string;
    recommendation: string;
  }>;
}

export interface PatchAuditEvent {
  id: string;
  project_id: string;
  project_name?: string;
  bug_id: string | null;
  bug_title?: string | null;
  bug_severity?: string | null;
  patch_id: string | null;
  file_id: string | null;
  file_path: string;
  user_id: string;
  actor_name: string;
  event_type:
    | 'bug_detected'
    | 'patch_generated'
    | 'patch_reviewed'
    | 'patch_accepted'
    | 'patch_rejected'
    | 'tests_executed'
    | 'patch_verified'
    | 'rollback_executed';
  decision_status: string | null;
  test_status: string | null;
  summary: string;
  original_code: string | null;
  proposed_code: string | null;
  modified_code: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface AdvancedDashboardData {
  chat: {
    conversations: number;
    messages: number;
  };
  languages: {
    supportedTotal: number;
    activeInWorkspace: number;
    activeList: string[];
  };
  website: {
    totalScans: number;
    totalIssues: number;
    lastScanAt: string | null;
  };
  multimedia: {
    totalScans: number;
    totalIssues: number;
    imageCount: number;
    videoCount: number;
    audioCount: number;
  };
  notifications: {
    total: number;
    unread: number;
    successes: number;
  };
  audit: {
    totalEvents: number;
    verifiedEvents: number;
    rollbackEvents: number;
  };
}

