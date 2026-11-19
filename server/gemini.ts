import { GoogleGenAI, Type } from '@google/genai';

const MODEL_NAME = 'gemini-4-hydrogen';

function getClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    throw new Error(
      'GEMINI_API_KEY is not configured on the server. Please set it in the Settings > Secrets panel.'
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

async function callWithRetry<T>(fn: () => Promise<T>, maxRetries = 2): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err);
      const isTransient =
        msg.includes('503') ||
        msg.includes('429') ||
        msg.includes('UNAVAILABLE') ||
        msg.includes('ECONNRESET') ||
        msg.includes('fetch failed');
      if (!isTransient || attempt === maxRetries) {
        break;
      }
      await new Promise((r) => setTimeout(r, 800 * Math.pow(2, attempt)));
    }
  }
  throw lastError;
}

function parseStrictJson<T>(raw: string | undefined, context: string): T {
  if (!raw || !raw.trim()) {
    throw new Error(`Gemini returned an empty response while performing ${context}.`);
  }
  const cleaned = raw
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '');
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    throw new Error(`Gemini returned malformed JSON during ${context}.`);
  }
}

export interface DetectedBugAI {
  title: string;
  filePath: string;
  lineStart: number;
  lineEnd: number;
  category: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  impactScore: number;
  confidence: number;
  description: string;
  whyOccurred: string;
  rootCause: string;
  potentialImpact: string;
  suggestedSolution: string;
}

export async function scanProjectFilesWithAI(
  projectName: string,
  files: Array<{ filePath: string; language: string; content: string }>
): Promise<{ bugs: DetectedBugAI[]; modelUsed: string }> {
  const ai = getClient();

  const numberedBundle = files
    .map((f) => {
      const numbered = f.content
        .split('\n')
        .map((line, idx) => `${idx + 1}: ${line}`)
        .join('\n');
      return `=== FILE: ${f.filePath} (${f.language}) ===\n${numbered}`;
    })
    .join('\n\n');

  const prompt = `Analyze the following source files from project "${projectName}" for real software defects.
Detect:
- Syntax errors
- Logical errors
- Runtime errors
- Edge-case errors
- Security vulnerabilities
- Code pattern and maintainability issues

IMPORTANT RULES:
1. Only report genuine bugs actually present in the provided source code.
2. Cite the exact filePath from the FILE header and accurate 1-indexed lineStart and lineEnd numbers.
3. impactScore and confidence must be integers between 1 and 100.
4. severity must be one of: "critical", "high", "medium", "low".
5. category should be one of: "Syntax Error", "Logical Error", "Runtime Error", "Edge-Case Error", "Security Vulnerability", "Maintainability Issue".

SOURCE FILES:
${numberedBundle}`;

  const response = await callWithRetry(() =>
    ai.models.generateContent({
      model: MODEL_NAME,
      contents: prompt,
      config: {
        systemInstruction:
          'You are a senior static analysis and security engineering engine. Return precise, factual bug reports with exact line numbers and root cause analysis in strict JSON.',
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            bugs: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  filePath: { type: Type.STRING },
                  lineStart: { type: Type.INTEGER },
                  lineEnd: { type: Type.INTEGER },
                  category: { type: Type.STRING },
                  severity: { type: Type.STRING },
                  impactScore: { type: Type.INTEGER },
                  confidence: { type: Type.INTEGER },
                  description: { type: Type.STRING },
                  whyOccurred: { type: Type.STRING },
                  rootCause: { type: Type.STRING },
                  potentialImpact: { type: Type.STRING },
                  suggestedSolution: { type: Type.STRING },
                },
                required: [
                  'title',
                  'filePath',
                  'lineStart',
                  'lineEnd',
                  'category',
                  'severity',
                  'impactScore',
                  'confidence',
                  'description',
                  'whyOccurred',
                  'rootCause',
                  'potentialImpact',
                  'suggestedSolution',
                ],
              },
            },
          },
          required: ['bugs'],
        },
      },
    })
  );

  const parsed = parseStrictJson<{ bugs: DetectedBugAI[] }>(response.text, 'AI Bug Scan');
  const validSeverities = new Set(['critical', 'high', 'medium', 'low']);

  const normalized = (parsed.bugs || []).map((b) => ({
    ...b,
    severity: (validSeverities.has(String(b.severity).toLowerCase())
      ? String(b.severity).toLowerCase()
      : 'medium') as 'critical' | 'high' | 'medium' | 'low',
    impactScore: Math.max(1, Math.min(100, Math.round(Number(b.impactScore) || 60))),
    confidence: Math.max(1, Math.min(100, Math.round(Number(b.confidence) || 80))),
    lineStart: Math.max(1, Math.round(Number(b.lineStart) || 1)),
    lineEnd: Math.max(1, Math.round(Number(b.lineEnd) || Number(b.lineStart) || 1)),
  }));

  return { bugs: normalized, modelUsed: MODEL_NAME };
}

export interface CodeExplanationAI {
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

export async function explainCodeWithAI(params: {
  filePath: string;
  language: string;
  fullCode: string;
  selectedCode?: string;
  startLine?: number;
  endLine?: number;
}): Promise<CodeExplanationAI> {
  const ai = getClient();
  const targetCode = params.selectedCode?.trim() ? params.selectedCode : params.fullCode;
  const offset = params.selectedCode?.trim() && params.startLine ? params.startLine : 1;

  const numbered = targetCode
    .split('\n')
    .map((line, i) => `${offset + i}: ${line}`)
    .join('\n');

  const prompt = `Explain the following ${params.language} code from "${params.filePath}" (lines ${offset} to ${offset + targetCode.split('\n').length - 1}).

Provide:
1. A clear concise summary.
2. A beginner-friendly explanation avoiding unnecessary jargon.
3. Step-by-step execution explanation referencing line ranges.
4. Key constructs (functions, variables, conditions, loops, algorithms) and their roles.
5. Potential logical problems or risky code sections with exact lineStart and lineEnd.
6. Time and space complexity where reasonably determinable (if not applicable, explain clearly why).

CODE:
${numbered}`;

  const response = await callWithRetry(() =>
    ai.models.generateContent({
      model: MODEL_NAME,
      contents: prompt,
      config: {
        systemInstruction:
          'You are an expert computer science educator and principal software engineer. Explain code clearly, accurately, and practically in strict JSON.',
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            summary: { type: Type.STRING },
            beginnerExplanation: { type: Type.STRING },
            stepByStep: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  step: { type: Type.INTEGER },
                  lines: { type: Type.STRING },
                  title: { type: Type.STRING },
                  detail: { type: Type.STRING },
                },
                required: ['step', 'lines', 'title', 'detail'],
              },
            },
            constructs: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  name: { type: Type.STRING },
                  kind: { type: Type.STRING },
                  role: { type: Type.STRING },
                },
                required: ['name', 'kind', 'role'],
              },
            },
            riskySections: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  lineStart: { type: Type.INTEGER },
                  lineEnd: { type: Type.INTEGER },
                  severity: { type: Type.STRING },
                  reason: { type: Type.STRING },
                },
                required: ['lineStart', 'lineEnd', 'severity', 'reason'],
              },
            },
            complexity: {
              type: Type.OBJECT,
              properties: {
                time: { type: Type.STRING },
                space: { type: Type.STRING },
                notes: { type: Type.STRING },
              },
              required: ['time', 'space', 'notes'],
            },
          },
          required: ['summary', 'beginnerExplanation', 'stepByStep', 'constructs', 'riskySections', 'complexity'],
        },
      },
    })
  );

  return parseStrictJson<CodeExplanationAI>(response.text, 'Code Explanation');
}

export interface GeneratedPatchAI {
  patchedCode: string;
  explanation: string;
  confidence: number;
  risks: string[];
  changeHighlights: string[];
}

export async function generatePatchWithAI(params: {
  filePath: string;
  language: string;
  currentCode: string;
  bug: {
    title: string;
    category: string;
    severity: string;
    lineStart: number;
    lineEnd: number;
    description: string;
    rootCause: string;
    suggestedSolution: string;
  };
}): Promise<GeneratedPatchAI> {
  const ai = getClient();

  const prompt = `Generate a MINIMAL, SAFE code repair patch for the following bug in "${params.filePath}" (${params.language}).

BUG REPORT:
- Title: ${params.bug.title}
- Category: ${params.bug.category}
- Severity: ${params.bug.severity}
- Lines: ${params.bug.lineStart}-${params.bug.lineEnd}
- Description: ${params.bug.description}
- Root Cause: ${params.bug.rootCause}
- Suggested Solution: ${params.bug.suggestedSolution}

STRICT REQUIREMENTS:
1. Return the COMPLETE updated file content in "patchedCode" with minimal changes strictly addressing the bug.
2. Preserve all existing exports, function signatures, imports, and unrelated functionality.
3. Do NOT wrap patchedCode in markdown fences.
4. Provide a clear explanation of every modified line, an honest confidence estimate (1-100), and concrete potential repair risks.

CURRENT FILE CONTENT:
${params.currentCode}`;

  const response = await callWithRetry(() =>
    ai.models.generateContent({
      model: MODEL_NAME,
      contents: prompt,
      config: {
        systemInstruction:
          'You are an autonomous safe code repair system. Produce minimal, surgical patches that fix the defect while preserving existing behavior and APIs.',
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            patchedCode: { type: Type.STRING },
            explanation: { type: Type.STRING },
            confidence: { type: Type.INTEGER },
            risks: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
            changeHighlights: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
          },
          required: ['patchedCode', 'explanation', 'confidence', 'risks', 'changeHighlights'],
        },
      },
    })
  );

  const parsed = parseStrictJson<GeneratedPatchAI>(response.text, 'Patch Generation');
  return {
    ...parsed,
    confidence: Math.max(1, Math.min(100, Math.round(Number(parsed.confidence) || 85))),
    risks: Array.isArray(parsed.risks) ? parsed.risks : [],
    changeHighlights: Array.isArray(parsed.changeHighlights) ? parsed.changeHighlights : [],
  };
}

export interface GeneratedTestCaseAI {
  id: string;
  name: string;
  category: 'normal' | 'invalid' | 'boundary';
  description: string;
  inputSummary: string;
  expectedSummary: string;
  // For JS/TS: executable body receiving `mod` (exports of target file) and returning { passed: boolean, actual: string, expected: string }
  jsTestBody: string;
  // For non-JS/TS static checks: regex/substring patterns that should be present/absent
  staticExpectPresent?: string;
  staticExpectAbsent?: string;
}

export async function generateRegressionTestsWithAI(params: {
  filePath: string;
  language: string;
  originalCode: string;
  patchedCode: string;
  bug: {
    title: string;
    category: string;
    description: string;
    rootCause: string;
  };
}): Promise<{ testCases: GeneratedTestCaseAI[] }> {
  const ai = getClient();
  const isJsLike = params.language === 'javascript' || params.language === 'typescript';

  const prompt = isJsLike
    ? `Generate 6 regression test cases (2 "normal", 2 "invalid", 2 "boundary") to validate a fix for the bug below in "${params.filePath}".

BUG: ${params.bug.title}
ROOT CAUSE: ${params.bug.rootCause}

ORIGINAL CODE:
${params.originalCode}

PATCHED CODE:
${params.patchedCode}

IMPORTANT FOR jsTestBody:
Each test's "jsTestBody" will be executed as the body of an async function(mod) where "mod" is the imported module object containing all exported functions from "${params.filePath}".
- Keep each jsTestBody self-contained, synchronous or simple async, and return an object: { passed: boolean, actual: string, expected: string }.
- Use try/catch inside jsTestBody whenever testing invalid/boundary inputs that might throw on buggy code or throw a specific expected error on patched code.
- Ensure at least 2 tests fail on the ORIGINAL buggy code and pass on the PATCHED code, while normal tests verify existing functionality is preserved.`
    : `Generate 6 structured static validation test cases (2 "normal", 2 "invalid", 2 "boundary") for the ${params.language} file "${params.filePath}".

BUG: ${params.bug.title}
ROOT CAUSE: ${params.bug.rootCause}

ORIGINAL CODE:
${params.originalCode}

PATCHED CODE:
${params.patchedCode}

Since ${params.language} code will be validated via safe static analysis rather than host execution:
- Provide clear description, inputSummary, expectedSummary.
- Set jsTestBody to "".
- Provide staticExpectPresent (exact safe pattern or guard substring expected in fixed code) and/or staticExpectAbsent (exact vulnerable/buggy pattern substring that must not appear in fixed code).`;

  const response = await callWithRetry(() =>
    ai.models.generateContent({
      model: MODEL_NAME,
      contents: prompt,
      config: {
        systemInstruction:
          'You are an automated QA and regression testing engineer. Generate concise, deterministic, high-signal regression test cases covering normal, invalid, and boundary inputs.',
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            testCases: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.STRING },
                  name: { type: Type.STRING },
                  category: { type: Type.STRING },
                  description: { type: Type.STRING },
                  inputSummary: { type: Type.STRING },
                  expectedSummary: { type: Type.STRING },
                  jsTestBody: { type: Type.STRING },
                  staticExpectPresent: { type: Type.STRING },
                  staticExpectAbsent: { type: Type.STRING },
                },
                required: ['id', 'name', 'category', 'description', 'inputSummary', 'expectedSummary', 'jsTestBody'],
              },
            },
          },
          required: ['testCases'],
        },
      },
    })
  );

  const parsed = parseStrictJson<{ testCases: GeneratedTestCaseAI[] }>(response.text, 'Regression Test Generation');
  const validCats = new Set(['normal', 'invalid', 'boundary']);
  const cases = (parsed.testCases || []).map((tc, idx) => ({
    ...tc,
    id: tc.id || `tc_${idx + 1}`,
    category: (validCats.has(String(tc.category).toLowerCase())
      ? String(tc.category).toLowerCase()
      : 'normal') as 'normal' | 'invalid' | 'boundary',
  }));
  return { testCases: cases };
}

export interface GeneratedLearningInsightAI {
  conceptTitle: string;
  mistakeCategory: string;
  frequencyCount: number;
  whyItHappens: string;
  explanation: string;
  recommendation: string;
}

export async function generateLearningInsightsWithAI(
  bugsSummary: Array<{ category: string; severity: string; title: string; rootCause: string; filePath: string }>
): Promise<{ insights: GeneratedLearningInsightAI[] }> {
  const ai = getClient();

  const prompt = `Based on this developer's actual bug scan history below, generate 3 to 5 personalized coding learning concepts that will help them eliminate recurring defects.

ACTUAL DETECTED BUGS:
${JSON.stringify(bugsSummary.slice(0, 25), null, 2)}

Write clear, beginner-friendly, actionable engineering guidance grounded strictly in the bugs above.`;

  const response = await callWithRetry(() =>
    ai.models.generateContent({
      model: MODEL_NAME,
      contents: prompt,
      config: {
        systemInstruction:
          'You are a supportive staff software engineering mentor turning real defect history into practical, encouraging skill-building lessons.',
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            insights: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  conceptTitle: { type: Type.STRING },
                  mistakeCategory: { type: Type.STRING },
                  frequencyCount: { type: Type.INTEGER },
                  whyItHappens: { type: Type.STRING },
                  explanation: { type: Type.STRING },
                  recommendation: { type: Type.STRING },
                },
                required: [
                  'conceptTitle',
                  'mistakeCategory',
                  'frequencyCount',
                  'whyItHappens',
                  'explanation',
                  'recommendation',
                ],
              },
            },
          },
          required: ['insights'],
        },
      },
    })
  );

  return parseStrictJson<{ insights: GeneratedLearningInsightAI[] }>(response.text, 'Learning Insights Generation');
}

export interface AutoPatchChatResponseAI {
  answer: string;
  referencedBugIds: string[];
  referencedFiles: Array<{
    filePath: string;
    lineStart: number;
    lineEnd: number;
    note: string;
  }>;
  followUpSuggestions: string[];
}

export async function chatWithAutoPatchAI(params: {
  projectName: string;
  explanationMode: 'beginner' | 'advanced';
  userMessage: string;
  selectedSnippet?: { filePath: string; lineStart: number; lineEnd: number; code: string } | null;
  files: Array<{ filePath: string; language: string; content: string }>;
  bugs: Array<{
    id: string;
    title: string;
    filePath: string;
    lineStart: number;
    lineEnd: number;
    severity: string;
    status: string;
    category: string;
    rootCause: string;
    suggestedSolution: string;
  }>;
  fixes: Array<{
    id: string;
    bugId: string;
    filePath: string;
    status: string;
    confidence: number;
    explanation: string;
    risks: string[];
  }>;
  tests: Array<{
    bugId: string;
    phase: string;
    validationStatus: string;
    passedTests: number;
    totalTests: number;
    regressionDetected: boolean;
    summary: string;
  }>;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
}): Promise<AutoPatchChatResponseAI> {
  const ai = getClient();

  const numberedFilesBlock = params.files
    .slice(0, 12)
    .map((f) => {
      const snippet = f.content
        .split('\n')
        .slice(0, 180)
        .map((line, i) => `${i + 1}: ${line}`)
        .join('\n');
      return `=== FILE: ${f.filePath} (${f.language}) ===\n${snippet.slice(0, 9000)}`;
    })
    .join('\n\n');

  const selectedBlock = params.selectedSnippet
    ? `\nUSER-SELECTED CODE SECTION (${params.selectedSnippet.filePath}, lines ${params.selectedSnippet.lineStart}-${params.selectedSnippet.lineEnd}):\n\`\`\`\n${params.selectedSnippet.code.slice(0, 4000)}\n\`\`\`\n`
    : '';

  const historyBlock =
    params.history.length > 0
      ? `\nRECENT CONVERSATION HISTORY:\n${params.history
          .slice(-8)
          .map((m) => `${m.role.toUpperCase()}: ${m.content.slice(0, 1400)}`)
          .join('\n')}\n`
      : '';

  const prompt = `You are "Ask AutoPatch", the project-aware conversational debugging assistant inside AutoPatch AI.
Answer the developer's question strictly using the ACTUAL project files, detected bugs, suggested fixes, and test results below.

PROJECT: ${params.projectName}
EXPLANATION DEPTH MODE: ${params.explanationMode === 'beginner' ? 'BEGINNER-FRIENDLY (clear analogies, explain jargon simply, step-by-step)' : 'ADVANCED ENGINEERING (deep root-cause analysis, edge cases, invariants, performance & architectural trade-offs)'}

DETECTED BUGS IN THIS PROJECT (${params.bugs.length}):
${JSON.stringify(params.bugs.slice(0, 25), null, 2)}

SUGGESTED PATCHES (${params.fixes.length}):
${JSON.stringify(params.fixes.slice(0, 15), null, 2)}

RECENT TEST VALIDATION RUNS (${params.tests.length}):
${JSON.stringify(params.tests.slice(0, 12), null, 2)}

ACTUAL PROJECT SOURCE FILES (WITH LINE NUMBERS):
${numberedFilesBlock}
${selectedBlock}
${historyBlock}

CURRENT DEVELOPER QUESTION:
${params.userMessage}

RULES:
1. Ground every claim in the actual source files, line numbers, bug IDs, patches, and test results provided above. Never invent files, functions, or bugs that do not exist in this project.
2. When showing code examples or suggested fixes, wrap them in markdown fenced code blocks with the language tag (e.g., \`\`\`javascript ... \`\`\`).
3. Remind the developer clearly when proposing code changes that AutoPatch never auto-modifies files from chat and requires explicit approval in Repair & Diff.
4. Populate referencedBugIds ONLY with exact bug IDs from the DETECTED BUGS list above that are directly relevant to your answer.
5. Populate referencedFiles ONLY with exact filePath values from the project files above and real line ranges.
6. Provide 2 to 4 concise, context-specific followUpSuggestions for this project.`;

  const response = await callWithRetry(() =>
    ai.models.generateContent({
      model: MODEL_NAME,
      contents: prompt,
      config: {
        systemInstruction:
          'You are Ask AutoPatch, a precision software debugging assistant. Stay grounded in the provided codebase, cite exact file paths and line numbers, and return strictly valid JSON.',
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            answer: { type: Type.STRING },
            referencedBugIds: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
            referencedFiles: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  filePath: { type: Type.STRING },
                  lineStart: { type: Type.INTEGER },
                  lineEnd: { type: Type.INTEGER },
                  note: { type: Type.STRING },
                },
                required: ['filePath', 'lineStart', 'lineEnd', 'note'],
              },
            },
            followUpSuggestions: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
          },
          required: ['answer', 'referencedBugIds', 'referencedFiles', 'followUpSuggestions'],
        },
      },
    })
  );

  const parsed = parseStrictJson<AutoPatchChatResponseAI>(response.text, 'Ask AutoPatch Chat');
  const validBugIdSet = new Set(params.bugs.map((b) => b.id));
  const validFilePathSet = new Set(params.files.map((f) => f.filePath));

  return {
    answer: parsed.answer || 'Unable to generate a response for this question.',
    referencedBugIds: (parsed.referencedBugIds || []).filter((id) => validBugIdSet.has(id)),
    referencedFiles: (parsed.referencedFiles || [])
      .filter((rf) => validFilePathSet.has(rf.filePath))
      .map((rf) => ({
        filePath: rf.filePath,
        lineStart: Math.max(1, Number(rf.lineStart) || 1),
        lineEnd: Math.max(Math.max(1, Number(rf.lineStart) || 1), Number(rf.lineEnd) || 1),
        note: rf.note || '',
      })),
    followUpSuggestions: (parsed.followUpSuggestions || []).slice(0, 4),
  };
}

export interface MediaAiAssessmentResult {
  qualityRating: 'good' | 'fair' | 'poor';
  summary: string;
  observations: Array<{
    severity: 'high' | 'medium' | 'low' | 'info';
    title: string;
    detail: string;
  }>;
  accessibilityNotes: string[];
  recommendations: string[];
}

export async function analyzeMediaWithGeminiAI(params: {
  mediaType: 'image' | 'audio';
  mimeType: string;
  base64Data: string;
  fileName: string;
  technicalMetadata: Record<string, unknown>;
}): Promise<MediaAiAssessmentResult> {
  const ai = getClient();

  const prompt =
    params.mediaType === 'image'
      ? `Perform an AI Visual Quality & Accessibility Assessment on this uploaded image asset ("${params.fileName}").
Known deterministic technical metadata (already verified by sharp):
${JSON.stringify(params.technicalMetadata, null, 2)}

Inspect the actual image pixels for:
- Visual blurriness, compression artifacts, pixelation, or severe distortion
- Clipped text, cropped UI elements, poor contrast, or visual defects
- Accessibility issues (e.g., dense baked-in text needing detailed alt text, low legibility)
- Practical web optimization recommendations

Do NOT invent issues that are not visibly present in the image.`
      : `Perform an AI Audio Quality Assessment on this uploaded audio asset ("${params.fileName}").
Known deterministic technical metadata (already verified by ffprobe/ffmpeg):
${JSON.stringify(params.technicalMetadata, null, 2)}

Listen to the actual audio and assess:
- Audible distortion, hum, background noise, clipping, or abrupt cuts
- Intelligibility / clarity of speech or audio signal
- Accessibility considerations (e.g., whether captions/transcripts are needed)
- Practical engineering recommendations

Do NOT invent defects not present in the audio.`;

  const response = await callWithRetry(() =>
    ai.models.generateContent({
      model: MODEL_NAME,
      contents: [
        {
          inlineData: {
            mimeType: params.mimeType,
            data: params.base64Data,
          },
        },
        { text: prompt },
      ],
      config: {
        systemInstruction:
          'You are a multimodal media QA engineer. Provide honest, concise, evidence-grounded quality and accessibility assessments in strict JSON.',
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            qualityRating: { type: Type.STRING },
            summary: { type: Type.STRING },
            observations: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  severity: { type: Type.STRING },
                  title: { type: Type.STRING },
                  detail: { type: Type.STRING },
                },
                required: ['severity', 'title', 'detail'],
              },
            },
            accessibilityNotes: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
            recommendations: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
          },
          required: ['qualityRating', 'summary', 'observations', 'accessibilityNotes', 'recommendations'],
        },
      },
    })
  );

  const parsed = parseStrictJson<MediaAiAssessmentResult>(response.text, 'Multimodal Media Assessment');
  const validRating = new Set(['good', 'fair', 'poor']);
  const validSev = new Set(['high', 'medium', 'low', 'info']);
  return {
    qualityRating: (validRating.has(String(parsed.qualityRating).toLowerCase())
      ? String(parsed.qualityRating).toLowerCase()
      : 'fair') as 'good' | 'fair' | 'poor',
    summary: parsed.summary || 'AI media assessment completed.',
    observations: (parsed.observations || []).map((o) => ({
      severity: (validSev.has(String(o.severity).toLowerCase())
        ? String(o.severity).toLowerCase()
        : 'info') as 'high' | 'medium' | 'low' | 'info',
      title: o.title || 'Observation',
      detail: o.detail || '',
    })),
    accessibilityNotes: parsed.accessibilityNotes || [],
    recommendations: parsed.recommendations || [],
  };
}

