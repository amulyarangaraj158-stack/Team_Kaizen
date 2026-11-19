import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { classifyMediaMime } from '../utils/security';

const execFileAsync = promisify(execFile);

export interface MultimediaIssue {
  severity: 'critical' | 'high' | 'medium' | 'low';
  checkType: 'technical' | 'project_reference';
  title: string;
  detail: string;
  recommendation: string;
}

export interface MultimediaTechnicalReport {
  filename: string;
  mediaType: 'image' | 'audio' | 'video';
  mimeType: string;
  sizeBytes: number;
  magicHeaderValid: boolean;
  ffprobeAvailable: boolean;
  metadata: {
    formatName?: string;
    durationSeconds?: number;
    bitRate?: number;
    width?: number;
    height?: number;
    videoCodec?: string;
    audioCodec?: string;
    hasVideoStream?: boolean;
    hasAudioStream?: boolean;
  };
  issues: MultimediaIssue[];
  status: 'healthy' | 'warning' | 'corrupted';
}

function verifyMagicBytes(buf: Buffer, mimeType: string): { valid: boolean; detected: string } {
  if (buf.length < 4) return { valid: false, detected: 'empty/truncated' };
  const hex4 = buf.subarray(0, 4).toString('hex').toLowerCase();
  const ascii4 = buf.subarray(0, 4).toString('ascii');
  const headText = buf.subarray(0, 128).toString('utf8').trim().toLowerCase();

  if (hex4 === '89504e47') return { valid: mimeType.includes('png'), detected: 'PNG' };
  if (hex4.startsWith('ffd8ff')) return { valid: mimeType.includes('jpeg') || mimeType.includes('jpg'), detected: 'JPEG' };
  if (ascii4 === 'GIF8') return { valid: mimeType.includes('gif'), detected: 'GIF' };
  if (ascii4 === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') {
    return { valid: mimeType.includes('webp'), detected: 'WebP' };
  }
  if (ascii4 === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WAVE') {
    return { valid: mimeType.includes('wav'), detected: 'WAV' };
  }
  if (headText.startsWith('<svg') || headText.includes('<svg')) {
    return { valid: mimeType.includes('svg'), detected: 'SVG' };
  }
  if (ascii4 === 'OggS') return { valid: mimeType.includes('ogg'), detected: 'OGG' };
  if (ascii4 === 'fLaC') return { valid: mimeType.includes('flac'), detected: 'FLAC' };
  if (ascii4.startsWith('ID3') || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0)) {
    return { valid: mimeType.includes('mpeg') || mimeType.includes('mp3'), detected: 'MP3' };
  }
  if (buf.length >= 12 && buf.subarray(4, 8).toString('ascii') === 'ftyp') {
    return { valid: mimeType.includes('mp4') || mimeType.includes('quicktime'), detected: 'MP4/MOV' };
  }
  if (hex4 === '1a45dfa3') {
    return { valid: mimeType.includes('webm') || mimeType.includes('matroska'), detected: 'WebM/MKV' };
  }
  if (buf[0] === 0x42 && buf[1] === 0x4d) {
    return { valid: mimeType.includes('bmp'), detected: 'BMP' };
  }

  return { valid: false, detected: 'unknown/corrupted' };
}

/**
 * Performs real technical inspection on uploaded image, audio, or video buffers
 * using magic-byte verification and ffprobe (FFmpeg) inside an isolated temp file.
 */
export async function inspectMultimediaBuffer(
  buffer: Buffer,
  filename: string,
  mimeType: string
): Promise<MultimediaTechnicalReport> {
  const mediaType = classifyMediaMime(mimeType);
  if (!mediaType) {
    throw new Error(`Unsupported media MIME type: ${mimeType}`);
  }

  const issues: MultimediaIssue[] = [];
  const magic = verifyMagicBytes(buffer, mimeType);
  if (!magic.valid) {
    issues.push({
      severity: 'critical',
      checkType: 'technical',
      title: 'File Signature / MIME Type Mismatch or Corrupted Header',
      detail: `Declared MIME "${mimeType}" did not match binary signature (detected: ${magic.detected}).`,
      recommendation: 'Re-export the asset in a valid format or verify the file was not truncated during transfer.',
    });
  }

  let ffprobeAvailable = false;
  const metadata: MultimediaTechnicalReport['metadata'] = {};

  const safeExt = path.extname(filename).replace(/[^a-zA-Z0-9.]/g, '') || '.bin';
  const tmpPath = path.join(os.tmpdir(), `autopatch-media-${Date.now()}-${Math.random().toString(36).slice(2)}${safeExt}`);

  try {
    fs.writeFileSync(tmpPath, buffer);
    // SVG is XML text; handle dimensions directly if SVG
    if (mimeType.includes('svg')) {
      const text = buffer.toString('utf8');
      if (/<script\b/i.test(text)) {
        issues.push({
          severity: 'critical',
          checkType: 'technical',
          title: 'Embedded <script> Tag Detected Inside SVG Image',
          detail: 'SVG assets containing executable JavaScript pose a Stored XSS risk.',
          recommendation: 'Sanitize SVG markup and strip <script> elements and inline event handlers.',
        });
      }
      const wMatch = text.match(/width=["'](\d+)/i);
      const hMatch = text.match(/height=["'](\d+)/i);
      if (wMatch) metadata.width = Number(wMatch[1]);
      if (hMatch) metadata.height = Number(hMatch[1]);
      metadata.formatName = 'svg';
    } else {
      try {
        const { stdout } = await execFileAsync(
          'ffprobe',
          ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', tmpPath],
          { timeout: 6000, maxBuffer: 512 * 1024 }
        );
        ffprobeAvailable = true;
        const parsed = JSON.parse(stdout || '{}');
        const streams: Array<Record<string, unknown>> = Array.isArray(parsed.streams) ? parsed.streams : [];
        const fmt = parsed.format ?? {};

        metadata.formatName = typeof fmt.format_name === 'string' ? fmt.format_name : undefined;
        metadata.durationSeconds = fmt.duration ? Number(fmt.duration) : undefined;
        metadata.bitRate = fmt.bit_rate ? Number(fmt.bit_rate) : undefined;

        const videoStream = streams.find((s) => s.codec_type === 'video');
        const audioStream = streams.find((s) => s.codec_type === 'audio');

        metadata.hasVideoStream = Boolean(videoStream);
        metadata.hasAudioStream = Boolean(audioStream);

        if (videoStream) {
          metadata.width = typeof videoStream.width === 'number' ? videoStream.width : undefined;
          metadata.height = typeof videoStream.height === 'number' ? videoStream.height : undefined;
          metadata.videoCodec = typeof videoStream.codec_name === 'string' ? videoStream.codec_name : undefined;
        }
        if (audioStream) {
          metadata.audioCodec = typeof audioStream.codec_name === 'string' ? audioStream.codec_name : undefined;
        }

        if (mediaType === 'image') {
          if (!metadata.width || !metadata.height) {
            issues.push({
              severity: 'high',
              checkType: 'technical',
              title: 'Unreadable Image Dimensions',
              detail: 'ffprobe could not extract valid pixel width/height from this image.',
              recommendation: 'Verify the file is not corrupted and re-encode as PNG, JPEG, or WebP.',
            });
          } else if (metadata.width > 4096 || metadata.height > 4096) {
            issues.push({
              severity: 'medium',
              checkType: 'technical',
              title: `Oversized Image Resolution (${metadata.width}x${metadata.height})`,
              detail: 'Very large raster dimensions increase memory pressure and slow browser decoding.',
              recommendation: 'Downscale to <= 2048px wide and serve responsive WebP/AVIF variants.',
            });
          }
        }

        if (mediaType === 'audio') {
          if (!metadata.hasAudioStream) {
            issues.push({
              severity: 'critical',
              checkType: 'technical',
              title: 'Missing Audio Stream in Audio Container',
              detail: 'Container parsed cleanly but contains zero playable audio tracks.',
              recommendation: 'Re-mux or re-export the audio file with AAC, MP3, or Opus encoding.',
            });
          }
          if (!metadata.durationSeconds || metadata.durationSeconds <= 0) {
            issues.push({
              severity: 'high',
              checkType: 'technical',
              title: 'Zero or Missing Audio Duration Metadata',
              detail: 'Audio duration header is missing or zero, breaking timeline scrubbing in HTML5 players.',
              recommendation: 'Remux the file with FFmpeg to rewrite duration headers.',
            });
          }
        }

        if (mediaType === 'video') {
          if (!metadata.hasVideoStream) {
            issues.push({
              severity: 'critical',
              checkType: 'technical',
              title: 'Missing Video Track in Video File',
              detail: 'No decodable video stream was detected inside this container.',
              recommendation: 'Re-encode using H.264 (avc1) or VP9 inside MP4/WebM.',
            });
          }
          if (!metadata.hasAudioStream) {
            issues.push({
              severity: 'low',
              checkType: 'technical',
              title: 'Video Contains No Audio Stream',
              detail: 'No audio track found. Ignore if this is intentionally a muted background loop.',
              recommendation: 'Mux an AAC or Opus audio track if sound is expected.',
            });
          }
          if (metadata.videoCodec && !['h264', 'vp8', 'vp9', 'av1', 'hevc'].includes(metadata.videoCodec.toLowerCase())) {
            issues.push({
              severity: 'medium',
              checkType: 'technical',
              title: `Limited Web Playback Codec (${metadata.videoCodec})`,
              detail: `Codec "${metadata.videoCodec}" has inconsistent browser support across Safari, Chrome, and Firefox.`,
              recommendation: 'Transcode to H.264 (yuv420p) + AAC in an MP4 container with faststart enabled.',
            });
          }
        }
      } catch (probeErr: unknown) {
        const msg = probeErr instanceof Error ? probeErr.message : String(probeErr);
        if (msg.includes('ENOENT')) {
          ffprobeAvailable = false;
        } else {
          ffprobeAvailable = true;
          issues.push({
            severity: 'critical',
            checkType: 'technical',
            title: 'Media Decoder Error (Corrupted Stream)',
            detail: `ffprobe failed to decode media container: ${msg.slice(0, 220)}`,
            recommendation: 'Inspect source asset integrity and re-encode with FFmpeg.',
          });
        }
      }
    }
  } finally {
    try {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    } catch {
      // ignore cleanup error
    }
  }

  const hasCritical = issues.some((i) => i.severity === 'critical');
  const status: MultimediaTechnicalReport['status'] = hasCritical
    ? 'corrupted'
    : issues.length > 0
      ? 'warning'
      : 'healthy';

  return {
    filename,
    mediaType,
    mimeType,
    sizeBytes: buffer.length,
    magicHeaderValid: magic.valid,
    ffprobeAvailable,
    metadata,
    issues,
    status,
  };
}

/**
 * Inspects source code files in a project for broken or risky multimedia asset references.
 */
export function scanProjectMultimediaReferences(
  files: Array<{ path: string; content: string }>
): MultimediaIssue[] {
  const issues: MultimediaIssue[] = [];
  const availablePaths = new Set(files.map((f) => f.path.toLowerCase()));
  const mediaRefRegex = /["']([^"'\s]+\.(?:png|jpe?g|webp|gif|svg|mp3|wav|ogg|mp4|webm|mov))["']/gi;

  for (const file of files) {
    const matches = file.content.matchAll(mediaRefRegex);
    for (const m of matches) {
      const ref = m[1];
      if (/^https?:\/\//i.test(ref)) {
        if (ref.startsWith('http://')) {
          issues.push({
            severity: 'medium',
            checkType: 'project_reference',
            title: `Insecure HTTP Media Reference in ${file.path}`,
            detail: `Asset "${ref}" uses unencrypted http://, which triggers mixed-content blocking on HTTPS sites.`,
            recommendation: 'Switch the media URL to https:// or bundle the asset locally.',
          });
        }
        continue;
      }
      const normalized = ref.replace(/^\.?\//, '').toLowerCase();
      const existsInProject =
        availablePaths.has(normalized) ||
        Array.from(availablePaths).some((p) => p.endsWith(`/${normalized}`) || p.endsWith(normalized));

      if (!existsInProject) {
        issues.push({
          severity: 'medium',
          checkType: 'project_reference',
          title: `Unresolved Local Media Reference in ${file.path}`,
          detail: `Referenced asset "${ref}" was not found among uploaded project files.`,
          recommendation: 'Verify the relative path or include the static media file in your project bundle.',
        });
      }
    }
  }

  return issues.slice(0, 20);
}
