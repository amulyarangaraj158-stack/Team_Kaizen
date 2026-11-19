import { GoogleGenAI, Type } from '@google/genai';

const DEFAULT_MODEL = process.env.GEMINI_MODEL || 'gemini-4-hydrogen';

function getClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    return null;
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

export function getAiServiceStatus(): {
  configured: boolean;
  provider: string;
  model: string;
  status: 'operational' | 'unconfigured';
} {
  const configured = Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim() !== '' && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY');
  return {
    configured,
    provider: 'Google Gemini (@google/genai)',
    model: DEFAULT_MODEL,
    status: configured ? 'operational' : 'unconfigured',
  };
}

export interface AiPatchSuggestion {
  proposedCode: string;
  explanation: string;
  rootCause: string;
  preventionTip: string;
  relatedConcepts: string[];
  aiGenerated: boolean;
}

export interface AiDiscoveredBug {
  filePath: string;
  lineNumber: number;
  category: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  description: string;
  rootCause: string;
  proposedCode: string;
  explanation: string;
  preventionTip: string;
  relatedConcepts: string[];
}

/**
 * Uses Gemini to inspect a bug with surrounding file context and generate a
 * minimal, safe, syntactically valid proposed file patch + learning explanation.
 */
export async function generateAiPatchForBug(params: {
  filePath: string;
  language: string;
  fileContent: string;
  bugTitle: string;
  bugDescription: string;
  bugCategory: string;
  lineNumber: number;
  relatedFilesContext?: string;
}): Promise<AiPatchSuggestion> {
  const ai = getClient();
  if (!ai) {
    throw new Error('GEMINI_API_KEY is not configured on the server. Configure it in Settings > Secrets to generate AI patches.');
  }

  const prompt = [
    `You are AutoPatch AI, a senior software security and debugging engineer.`,
    `Fix the identified bug in "${params.filePath}" (${params.language}) around line ${params.lineNumber}.`,
    `Bug Category: ${params.bugCategory}`,
    `Bug Title: ${params.bugTitle}`,
    `Bug Description: ${params.bugDescription}`,
    params.relatedFilesContext ? `Related project dependency context:\n${params.relatedFilesContext}` : '',
    `Rules:`,
    `- Return the COMPLETE updated file content in proposedCode (not a partial snippet).`,
    `- Keep all existing exports, function signatures, and unrelated logic intact so baseline tests keep passing.`,
    `- Do not add placeholder comments or omit existing lines.`,
    ``,
    `Original file content:`,
    '```' + params.language,
    params.fileContent,
    '```',
  ]
    .filter(Boolean)
    .join('\n');

  const response = await ai.models.generateContent({
    model: DEFAULT_MODEL,
    contents: prompt,
    config: {
      systemInstruction:
        'Return strictly valid JSON conforming to the schema. Produce production-safe, minimal diffs that fix the bug without breaking callers.',
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          proposedCode: { type: Type.STRING, description: 'Complete patched file contents.' },
          explanation: { type: Type.STRING, description: 'Clear technical explanation of why this patch resolves the bug.' },
          rootCause: { type: Type.STRING, description: 'Concise root cause of the original bug.' },
          preventionTip: { type: Type.STRING, description: 'Actionable engineering prevention guideline.' },
          relatedConcepts: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: '2-4 engineering concepts relevant to this bug.',
          },
        },
        required: ['proposedCode', 'explanation', 'rootCause', 'preventionTip', 'relatedConcepts'],
      },
    },
  });

  const rawText = (response.text ?? '{}').trim();
  const parsed = JSON.parse(rawText);
  return {
    proposedCode: typeof parsed.proposedCode === 'string' && parsed.proposedCode.trim() ? parsed.proposedCode : params.fileContent,
    explanation: parsed.explanation || 'AI patch generated.',
    rootCause: parsed.rootCause || params.bugDescription,
    preventionTip: parsed.preventionTip || 'Add unit tests and static analysis checks for this pattern.',
    relatedConcepts: Array.isArray(parsed.relatedConcepts) ? parsed.relatedConcepts.slice(0, 5) : [params.bugCategory],
    aiGenerated: true,
  };
}

/**
 * Context-aware AI bug discovery across project source files during a scan.
 */
export async function analyzeProjectCodeWithGemini(
  files: Array<{ path: string; language: string; content: string }>,
  existingStaticTitles: string[]
): Promise<AiDiscoveredBug[]> {
  const ai = getClient();
  if (!ai) {
    return [];
  }

  const boundedFiles = files
    .filter((f) => f.content.trim().length > 0 && !/\.(test|spec)\./.test(f.path))
    .slice(0, 6)
    .map((f) => `--- FILE: ${f.path} (${f.language}) ---\n${f.content.slice(0, 4500)}`)
    .join('\n\n');

  if (!boundedFiles) return [];

  const prompt = [
    `Analyze the following project files for real software bugs, logic defects, security vulnerabilities, race conditions, or edge-case crashes.`,
    `Static analysis already flagged: ${existingStaticTitles.join('; ') || 'none'}.`,
    `Return up to 3 high-value, concrete findings (avoid duplicates of static findings). For each finding provide a complete patched file in proposedCode.`,
    ``,
    boundedFiles,
  ].join('\n');

  const response = await ai.models.generateContent({
    model: DEFAULT_MODEL,
    contents: prompt,
    config: {
      systemInstruction:
        'Be rigorous and evidence-based. Only report genuine bugs visible in the provided code. Never invent files or line numbers.',
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            filePath: { type: Type.STRING },
            lineNumber: { type: Type.INTEGER },
            category: { type: Type.STRING },
            severity: { type: Type.STRING },
            title: { type: Type.STRING },
            description: { type: Type.STRING },
            rootCause: { type: Type.STRING },
            proposedCode: { type: Type.STRING },
            explanation: { type: Type.STRING },
            preventionTip: { type: Type.STRING },
            relatedConcepts: { type: Type.ARRAY, items: { type: Type.STRING } },
          },
          required: ['filePath', 'lineNumber', 'category', 'severity', 'title', 'description', 'rootCause', 'proposedCode', 'explanation', 'preventionTip'],
        },
      },
    },
  });

  const parsed = JSON.parse((response.text ?? '[]').trim());
  if (!Array.isArray(parsed)) return [];
  const validPaths = new Set(files.map((f) => f.path));

  return parsed
    .filter((item) => item && typeof item.filePath === 'string' && validPaths.has(item.filePath))
    .slice(0, 3)
    .map((item) => {
      const sev = ['critical', 'high', 'medium', 'low'].includes(String(item.severity).toLowerCase())
        ? (String(item.severity).toLowerCase() as 'critical' | 'high' | 'medium' | 'low')
        : 'medium';
      return {
        filePath: item.filePath,
        lineNumber: Math.max(1, Number(item.lineNumber) || 1),
        category: String(item.category || 'logic_bug'),
        severity: sev,
        title: String(item.title || 'AI Detected Code Defect'),
        description: String(item.description || ''),
        rootCause: String(item.rootCause || ''),
        proposedCode: String(item.proposedCode || ''),
        explanation: String(item.explanation || ''),
        preventionTip: String(item.preventionTip || ''),
        relatedConcepts: Array.isArray(item.relatedConcepts) ? item.relatedConcepts.map(String).slice(0, 5) : [],
      };
    });
}

/**
 * Ask AutoPatch AI multi-turn debugging assistant with full project context.
 * Never modifies files; provides clear debugging guidance and reviewable code examples.
 */
export async function askAutoPatchChat(params: {
  projectName: string;
  projectFilesSummary: string;
  openBugsSummary: string;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  userMessage: string;
  contextFile?: string;
  contextCode?: string;
}): Promise<string> {
  const ai = getClient();
  if (!ai) {
    throw new Error('GEMINI_API_KEY is not configured. Add GEMINI_API_KEY in Settings > Secrets to use Ask AutoPatch AI.');
  }

  const systemInstruction = [
    `You are Ask AutoPatch, an autonomous software debugging and code intelligence engineer for project "${params.projectName}".`,
    `You help developers understand errors, trace root causes, review proposed fixes, inspect dependencies, and optimize code.`,
    `IMPORTANT: You NEVER silently modify project files. If you propose code changes, present them clearly so the developer can review and explicitly approve them in the Code Workbench.`,
    ``,
    `Project Files Summary:\n${params.projectFilesSummary}`,
    `Current Detected Bugs:\n${params.openBugsSummary}`,
  ].join('\n');

  const historyTranscript = params.history
    .slice(-8)
    .map((m) => `${m.role === 'user' ? 'Developer' : 'AutoPatch AI'}: ${m.content}`)
    .join('\n\n');

  const currentPrompt = [
    historyTranscript ? `Previous conversation:\n${historyTranscript}\n` : '',
    params.contextFile ? `Selected file context: ${params.contextFile}` : '',
    params.contextCode ? `Selected code snippet:\n\`\`\`\n${params.contextCode.slice(0, 3500)}\n\`\`\`` : '',
    `Developer question: ${params.userMessage}`,
  ]
    .filter(Boolean)
    .join('\n\n');

  const response = await ai.models.generateContent({
    model: DEFAULT_MODEL,
    contents: currentPrompt,
    config: {
      systemInstruction,
    },
  });

  return (response.text ?? 'No response generated.').trim();
}

/**
 * Generates evidence-based prevention recommendations from historical project bug patterns.
 */
export async function generatePatternPreventionRecommendations(patternSummary: string): Promise<string[]> {
  const ai = getClient();
  if (!ai) {
    throw new Error('GEMINI_API_KEY is not configured on the server.');
  }

  const response = await ai.models.generateContent({
    model: DEFAULT_MODEL,
    contents: `Based on these real historical bug records from the database, provide 4 specific, actionable engineering prevention recommendations tailored to these exact patterns:\n\n${patternSummary}`,
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.ARRAY,
        items: { type: Type.STRING },
      },
    },
  });

  const parsed = JSON.parse((response.text ?? '[]').trim());
  return Array.isArray(parsed) ? parsed.map(String).slice(0, 5) : [];
}

/**
 * Optional semantic visual inspection for uploaded images via Gemini multimodal input.
 * Clearly labeled as AI semantic interpretation separate from ffprobe technical checks.
 */
export async function analyzeImageSemanticsWithGemini(
  buffer: Buffer,
  mimeType: string,
  filename: string
): Promise<string | null> {
  const ai = getClient();
  if (!ai) return null;
  if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(mimeType.toLowerCase())) {
    return null;
  }

  const response = await ai.models.generateContent({
    model: DEFAULT_MODEL,
    contents: {
      parts: [
        {
          inlineData: {
            mimeType,
            data: buffer.toString('base64'),
          },
        },
        {
          text: `Inspect this UI/media image ("${filename}") concisely in 2-3 sentences for visual artifacts, clipping, readability/contrast issues, or broken layout cues.`,
        },
      ],
    },
  });

  return (response.text ?? '').trim() || null;
}
