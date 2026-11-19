import React, { useEffect, useRef } from 'react';
import Editor, { DiffEditor, loader, OnMount } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';

// Configure Monaco to use the local bundled package instead of external CDN
loader.config({ monaco });

let themeRegistered = false;
function ensureCyberTheme(m: typeof monaco) {
  if (themeRegistered) return;
  m.editor.defineTheme('autopatch-cyber', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '64748B', fontStyle: 'italic' },
      { token: 'keyword', foreground: 'A855F7', fontStyle: 'bold' },
      { token: 'string', foreground: '39FF88' },
      { token: 'number', foreground: 'FFB020' },
      { token: 'type', foreground: '00F5FF' },
      { token: 'function', foreground: '3B82F6' },
    ],
    colors: {
      'editor.background': '#070B14',
      'editor.foreground': '#F1F5F9',
      'editorLineNumber.foreground': '#475569',
      'editorLineNumber.activeForeground': '#00F5FF',
      'editor.selectionBackground': '#00F5FF28',
      'editor.lineHighlightBackground': '#101A2B',
      'editorCursor.foreground': '#00F5FF',
      'editorGutter.background': '#0B1220',
      'diffEditor.insertedTextBackground': '#39FF881F',
      'diffEditor.removedTextBackground': '#FF386426',
    },
  });
  themeRegistered = true;
}

export interface DiagnosticMarker {
  lineNumber: number;
  columnNumber?: number;
  severity: 'critical' | 'high' | 'medium' | 'low';
  message: string;
}

export function MonacoCodeEditor({
  value,
  language,
  onChange,
  readOnly = false,
  height = '480px',
  markers = [],
}: {
  value: string;
  language: string;
  onChange?: (val: string) => void;
  readOnly?: boolean;
  height?: string;
  markers?: DiagnosticMarker[];
}) {
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);

  const handleMount: OnMount = (editor, m) => {
    ensureCyberTheme(m);
    m.editor.setTheme('autopatch-cyber');
    editorRef.current = editor;
    applyMarkers(editor, m, markers);
  };

  useEffect(() => {
    if (editorRef.current) {
      applyMarkers(editorRef.current, monaco, markers);
    }
  }, [markers, value]);

  const monacoLang = mapLanguageToMonaco(language);

  return (
    <div className="overflow-hidden rounded-md border border-[#00F5FF]/15 bg-[#070B14]" style={{ height }}>
      <Editor
        height={height}
        language={monacoLang}
        value={value}
        theme="autopatch-cyber"
        beforeMount={(m) => ensureCyberTheme(m)}
        onMount={handleMount}
        onChange={(v) => onChange?.(v ?? '')}
        options={{
          readOnly,
          fontFamily: '"JetBrains Mono", monospace',
          fontSize: 13,
          lineHeight: 21,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          padding: { top: 12, bottom: 12 },
          renderLineHighlight: 'all',
          automaticLayout: true,
          wordWrap: 'on',
        }}
      />
    </div>
  );
}

export function MonacoDiffViewer({
  original,
  modified,
  language,
  height = '440px',
  editableModified = false,
  onModifiedChange,
}: {
  original: string;
  modified: string;
  language: string;
  height?: string;
  editableModified?: boolean;
  onModifiedChange?: (val: string) => void;
}) {
  const monacoLang = mapLanguageToMonaco(language);

  return (
    <div className="overflow-hidden rounded-md border border-[#00F5FF]/15 bg-[#070B14]" style={{ height }}>
      <DiffEditor
        height={height}
        language={monacoLang}
        original={original}
        modified={modified}
        theme="autopatch-cyber"
        beforeMount={(m) => ensureCyberTheme(m)}
        onMount={(diffEditor, m) => {
          ensureCyberTheme(m);
          m.editor.setTheme('autopatch-cyber');
          if (editableModified && onModifiedChange) {
            const modEditor = diffEditor.getModifiedEditor();
            modEditor.onDidChangeModelContent(() => {
              onModifiedChange(modEditor.getValue());
            });
          }
        }}
        options={{
          readOnly: !editableModified,
          originalEditable: false,
          renderSideBySide: true,
          fontFamily: '"JetBrains Mono", monospace',
          fontSize: 12.5,
          lineHeight: 20,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          automaticLayout: true,
        }}
      />
    </div>
  );
}

function applyMarkers(editor: monaco.editor.IStandaloneCodeEditor, m: typeof monaco, markers: DiagnosticMarker[]) {
  const model = editor.getModel();
  if (!model) return;
  const monacoMarkers: monaco.editor.IMarkerData[] = markers.map((mk) => ({
    startLineNumber: Math.max(1, mk.lineNumber),
    startColumn: Math.max(1, mk.columnNumber || 1),
    endLineNumber: Math.max(1, mk.lineNumber),
    endColumn: 120,
    message: mk.message,
    severity:
      mk.severity === 'critical' || mk.severity === 'high'
        ? m.MarkerSeverity.Error
        : mk.severity === 'medium'
          ? m.MarkerSeverity.Warning
          : m.MarkerSeverity.Info,
  }));
  m.editor.setModelMarkers(model, 'autopatch', monacoMarkers);
}

function mapLanguageToMonaco(lang: string): string {
  const map: Record<string, string> = {
    typescript: 'typescript',
    javascript: 'javascript',
    python: 'python',
    java: 'java',
    c: 'c',
    cpp: 'cpp',
    go: 'go',
    rust: 'rust',
    sql: 'sql',
    html: 'html',
    css: 'css',
    json: 'json',
    php: 'php',
    csharp: 'csharp',
  };
  return map[lang.toLowerCase()] || 'plaintext';
}
