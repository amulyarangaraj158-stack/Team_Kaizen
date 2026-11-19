import React, { useEffect, useRef } from 'react';
import Editor, { DiffEditor, type EditorProps, type DiffEditorProps, type DiffOnMount } from '@monaco-editor/react';
import { Loader2, AlertTriangle } from 'lucide-react';
import '../../lib/monaco';

interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallbackTitle?: string;
}

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      message: error?.message || 'An unexpected rendering error occurred.',
    };
  }

  componentDidCatch(error: Error): void {
    console.error('UI ErrorBoundary caught:', error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="p-6 bg-[#0C1324] border border-red-500/30 rounded-xl text-center space-y-3 my-4">
          <AlertTriangle className="w-6 h-6 text-amber-400 mx-auto" />
          <h3 className="text-sm font-semibold text-white font-display">
            {this.props.fallbackTitle || 'Something went wrong in this view'}
          </h3>
          <p className="text-xs text-slate-400 max-w-md mx-auto">{this.state.message}</p>
          <button
            type="button"
            onClick={() => this.setState({ hasError: false, message: '' })}
            className="px-4 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-500 rounded-lg transition-colors"
          >
            Reload View
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function EditorLoading() {
  return (
    <div className="h-full w-full bg-[#080D19] flex items-center justify-center gap-2 text-xs text-slate-400">
      <Loader2 className="w-4 h-4 animate-spin text-blue-400" />
      <span>Initializing Monaco Editor...</span>
    </div>
  );
}

export function SafeCodeEditor(props: EditorProps) {
  return (
    <ErrorBoundary fallbackTitle="Code Editor encountered an issue">
      <Editor
        loading={<EditorLoading />}
        keepCurrentModel={true}
        {...props}
      />
    </ErrorBoundary>
  );
}

export function SafeDiffEditor({ onMount, ...rest }: DiffEditorProps) {
  const diffEditorRef = useRef<Parameters<DiffOnMount>[0] | null>(null);

  const handleMount: DiffOnMount = (editor, monacoInstance) => {
    diffEditorRef.current = editor;
    if (onMount) onMount(editor, monacoInstance);
  };

  useEffect(() => {
    return () => {
      // Prevent Monaco's "TextModel got disposed before DiffEditorWidget model got reset" error on unmount
      try {
        diffEditorRef.current?.setModel(null);
      } catch {
        // ignore if already disposed
      }
      diffEditorRef.current = null;
    };
  }, []);

  return (
    <ErrorBoundary fallbackTitle="Diff Editor encountered an issue">
      <DiffEditor
        loading={<EditorLoading />}
        keepCurrentOriginalModel={true}
        keepCurrentModifiedModel={true}
        onMount={handleMount}
        {...rest}
      />
    </ErrorBoundary>
  );
}
