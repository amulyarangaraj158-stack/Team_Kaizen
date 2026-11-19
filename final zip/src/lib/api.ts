import { io, Socket } from 'socket.io-client';

export interface User {
  id: string;
  email: string;
  name: string;
  role: string;
}

export interface ProjectSummary {
  id: string;
  user_id: string;
  name: string;
  description: string;
  primary_language: string;
  health_score: number;
  file_count: number;
  open_bugs: number;
  resolved_bugs: number;
  critical_bugs: number;
  last_scan_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectFile {
  id: string;
  project_id: string;
  path: string;
  language: string;
  content: string;
  original_content: string;
  size_bytes: number;
  line_count: number;
  updated_at: string;
}

export interface ScoreFactor {
  name: string;
  impact: 'positive' | 'negative' | 'neutral';
  weight: string;
  detail: string;
}

export interface SuggestedFix {
  id: string;
  bug_id: string;
  project_id: string;
  file_id: string | null;
  original_code: string;
  proposed_code: string;
  explanation: string;
  confidence_score: number;
  risk_score: number;
  risk_category: 'Low' | 'Medium' | 'High' | 'Critical';
  score_explanation: string;
  scoreFactors: ScoreFactor[];
  status: 'pending' | 'accepted' | 'rejected' | 'rolled_back';
  created_at: string;
  latestTest?: TestResultRecord | null;
}

export interface DetectedBug {
  id: string;
  project_id: string;
  scan_id: string | null;
  file_id: string | null;
  file_path: string;
  line_number: number;
  column_number: number;
  category: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  description: string;
  root_cause: string;
  code_snippet: string;
  status: 'open' | 'patched' | 'resolved' | 'ignored';
  analyzer_source: string;
  prevention_tip: string;
  relatedConcepts: string[];
  created_at: string;
  resolved_at: string | null;
  fixes: SuggestedFix[];
}

export interface TestResultRecord {
  id: string;
  project_id: string;
  fix_id: string | null;
  run_type: string;
  status: 'passed' | 'failed' | 'skipped';
  total_tests: number;
  passed_tests: number;
  failed_tests: number;
  newlyFailed?: string[];
  baselineComparison?: {
    baseline?: {
      executed: boolean;
      runner: string;
      status: string;
      totalTests: number;
      passedTests: number;
      failedTests: number;
      failedTestNames: string[];
      outputLog: string;
      durationMs: number;
    };
    patched?: {
      executed: boolean;
      runner: string;
      status: string;
      totalTests: number;
      passedTests: number;
      failedTests: number;
      failedTestNames: string[];
      outputLog: string;
      durationMs: number;
    };
    resolvedTests?: string[];
    regressionDetected?: boolean;
    summary?: string;
  };
  output_log: string;
  duration_ms: number;
  created_at: string;
  bug_title?: string;
  file_path?: string;
}

export interface PatchSnapshot {
  id: string;
  project_id: string;
  user_id: string;
  fix_id: string | null;
  label: string;
  status: 'active' | 'rolled_back';
  created_at: string;
  files: Array<{ fileId: string; path: string; contentBefore: string; bugId?: string }>;
}

export interface AppNotification {
  id: string;
  userId: string;
  projectId: string | null;
  type: string;
  title: string;
  message: string;
  linkPath: string;
  isRead: boolean;
  createdAt: string;
}

export interface ScanProgressEvent {
  scanId: string;
  projectId: string;
  stageIndex: number;
  totalStages: number;
  stageName: string;
  progressPercent: number;
  filesAnalyzed: number;
  bugsFound: number;
  durationMs: number;
  status: 'running' | 'completed' | 'failed';
  detail: string;
}

export interface HealthResponse {
  status: 'operational' | 'degraded';
  timestamp: string;
  services: {
    backendApi: { status: string; detail: string };
    database: { status: string; detail: string };
    aiService: { status: string; provider: string; model: string; detail: string };
    codeAnalysisEngine: { status: string; detail: string };
    testingEngine: { status: string; detail: string };
  };
}

const TOKEN_STORAGE_KEY = 'autopatch_jwt_token';

export function getStoredToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setStoredToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_STORAGE_KEY, token);
    else localStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    // ignore storage errors
  }
}

export async function apiFetch<T = unknown>(
  url: string,
  options: RequestInit & { raw?: boolean } = {}
): Promise<T> {
  const token = getStoredToken();
  const headers = new Headers(options.headers || {});
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  if (!(options.body instanceof FormData) && options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(url, {
    ...options,
    headers,
  });

  if (options.raw) {
    if (!res.ok) {
      throw new Error(`Request failed (${res.status})`);
    }
    return (await res.text()) as unknown as T;
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const errMsg = (data as { error?: string }).error || `Request failed with status ${res.status}`;
    const err = new Error(errMsg) as Error & { status?: number; data?: unknown };
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data as T;
}

let socketInstance: Socket | null = null;

export function connectSocket(token: string): Socket {
  if (socketInstance && socketInstance.connected) {
    return socketInstance;
  }
  if (socketInstance) {
    socketInstance.disconnect();
  }
  socketInstance = io({
    auth: { token },
    reconnection: true,
    reconnectionAttempts: 8,
    reconnectionDelay: 1200,
  });
  return socketInstance;
}

export function disconnectSocket(): void {
  if (socketInstance) {
    socketInstance.disconnect();
    socketInstance = null;
  }
}
