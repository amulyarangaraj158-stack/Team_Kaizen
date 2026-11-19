import JSZip from 'jszip';
import path from 'node:path';

export const ALLOWED_EXTENSIONS = new Set([
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.ts',
  '.tsx',
  '.py',
  '.java',
  '.c',
  '.h',
  '.cpp',
  '.hpp',
  '.cc',
  '.html',
  '.htm',
  '.css',
  '.scss',
  '.json',
  '.sql',
  '.go',
  '.rs',
  '.rb',
  '.php',
  '.cs',
  '.md',
]);

export const MAX_FILE_BYTES = 2 * 1024 * 1024; // 2MB per source file
export const MAX_ZIP_BYTES = 10 * 1024 * 1024; // 10MB per ZIP archive
export const MAX_EXTRACTED_FILES = 60;
export const MAX_TOTAL_UNCOMPRESSED_BYTES = 12 * 1024 * 1024;

export function sanitizeRelativePath(rawPath: string): string | null {
  if (!rawPath || rawPath.includes('\0')) return null;
  const normalized = path.posix.normalize(rawPath.replace(/\\/g, '/')).replace(/^\/+/, '');
  if (!normalized || normalized === '.' || normalized.startsWith('..') || normalized.includes('/../')) {
    return null;
  }
  // Skip OS junk and dependency directories
  const segments = normalized.split('/');
  const ignoredDirs = new Set(['node_modules', '.git', '__pycache__', '.venv', 'venv', 'dist', 'build', '.DS_Store', '__MACOSX']);
  if (segments.some((s) => ignoredDirs.has(s))) {
    return null;
  }
  return normalized;
}

export function isSupportedSourceFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return ALLOWED_EXTENSIONS.has(ext);
}

export async function extractSafeZipBuffer(
  zipBuffer: Buffer
): Promise<{ files: Array<{ filePath: string; content: string }>; skippedCount: number }> {
  if (zipBuffer.length > MAX_ZIP_BYTES) {
    throw new Error(`ZIP archive exceeds maximum allowed size of ${MAX_ZIP_BYTES / (1024 * 1024)}MB.`);
  }

  const zip = await JSZip.loadAsync(zipBuffer);
  const extracted: Array<{ filePath: string; content: string }> = [];
  let totalUncompressed = 0;
  let skippedCount = 0;

  const entries = Object.values(zip.files);
  for (const entry of entries) {
    if (entry.dir) continue;

    const cleanPath = sanitizeRelativePath(entry.name);
    if (!cleanPath || !isSupportedSourceFile(cleanPath)) {
      skippedCount++;
      continue;
    }

    if (extracted.length >= MAX_EXTRACTED_FILES) {
      throw new Error(`ZIP archive contains more than ${MAX_EXTRACTED_FILES} supported source files.`);
    }

    const buf = await entry.async('nodebuffer');
    if (buf.length > MAX_FILE_BYTES) {
      skippedCount++;
      continue;
    }

    totalUncompressed += buf.length;
    if (totalUncompressed > MAX_TOTAL_UNCOMPRESSED_BYTES) {
      throw new Error('ZIP uncompressed content exceeds safe size limit (12MB).');
    }

    // Reject binary files containing null bytes
    if (buf.includes(0)) {
      skippedCount++;
      continue;
    }

    extracted.push({
      filePath: cleanPath,
      content: buf.toString('utf8'),
    });
  }

  // Strip common top-level wrapper folder if all files share one (e.g. "my-repo/src/index.js" -> "src/index.js")
  if (extracted.length > 0) {
    const firstSegment = extracted[0].filePath.split('/')[0];
    const allSharePrefix =
      extracted.every((f) => f.filePath.includes('/') && f.filePath.startsWith(`${firstSegment}/`));
    if (allSharePrefix) {
      for (const f of extracted) {
        f.filePath = f.filePath.slice(firstSegment.length + 1);
      }
    }
  }

  if (extracted.length === 0) {
    throw new Error(
      'No supported source files found in ZIP archive. Supported formats include JS, TS, Python, Java, C/C++, HTML, CSS, SQL, Go, Rust, Ruby, PHP, JSON.'
    );
  }

  return { files: extracted, skippedCount };
}
