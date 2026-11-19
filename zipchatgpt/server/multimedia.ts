import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import * as cheerio from 'cheerio';

const execFileAsync = promisify(execFile);

export interface MediaIssue {
  title: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  category: 'Technical Validation' | 'Quality & Optimization' | 'Compatibility' | 'Reference Audit';
  explanation: string;
  recommendation: string;
  evidence: string;
}

export interface MediaInspectionResult {
  mediaType: 'image' | 'video' | 'audio';
  fileName: string;
  detectedFormat: string;
  mimeType: string;
  sizeBytes: number;
  status: 'completed' | 'failed';
  metadata: Record<string, string | number | boolean | null>;
  issues: MediaIssue[];
}

function detectMagicSignature(buf: Buffer, ext: string): { format: string; mime: string } {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return { format: 'png', mime: 'image/png' };
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { format: 'jpeg', mime: 'image/jpeg' };
  }
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    return { format: 'webp', mime: 'image/webp' };
  }
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WAVE') {
    return { format: 'wav', mime: 'audio/wav' };
  }
  if (buf.length >= 4 && buf.toString('ascii', 0, 4) === 'OggS') {
    return { format: 'ogg', mime: 'audio/ogg' };
  }
  if (buf.length >= 4 && buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) {
    return { format: 'webm', mime: 'video/webm' };
  }
  if (buf.length >= 12 && buf.toString('ascii', 4, 8) === 'ftyp') {
    const brand = buf.toString('ascii', 8, 12);
    if (brand.includes('qt')) return { format: 'mov', mime: 'video/quicktime' };
    if (brand.includes('M4A')) return { format: 'aac', mime: 'audio/mp4' };
    return { format: 'mp4', mime: 'video/mp4' };
  }
  if (
    (buf.length >= 3 && buf.toString('ascii', 0, 3) === 'ID3') ||
    (buf.length >= 2 && buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0)
  ) {
    // Could be MP3 or ADTS AAC
    if (ext === '.aac') return { format: 'aac', mime: 'audio/aac' };
    return { format: 'mp3', mime: 'audio/mpeg' };
  }
  const headText = buf.slice(0, 512).toString('utf8').trim();
  if (headText.includes('<svg') || (headText.startsWith('<?xml') && headText.includes('<svg'))) {
    return { format: 'svg', mime: 'image/svg+xml' };
  }
  return { format: 'unknown', mime: 'application/octet-stream' };
}

export async function inspectImageBuffer(fileName: string, buffer: Buffer): Promise<MediaInspectionResult> {
  const ext = path.extname(fileName).toLowerCase();
  const magic = detectMagicSignature(buffer, ext);
  const issues: MediaIssue[] = [];

  const extMap: Record<string, string[]> = {
    '.png': ['png'],
    '.jpg': ['jpeg'],
    '.jpeg': ['jpeg'],
    '.webp': ['webp'],
    '.svg': ['svg'],
  };

  if (!extMap[ext]) {
    issues.push({
      title: `Unsupported Image Extension (${ext || 'none'})`,
      severity: 'high',
      category: 'Technical Validation',
      explanation: `Extension "${ext}" is outside the supported web formats (PNG, JPG/JPEG, WebP, SVG).`,
      recommendation: 'Convert the asset to PNG, JPEG, WebP, or SVG.',
      evidence: `Filename: ${fileName} · Detected signature: ${magic.format}`,
    });
  } else if (magic.format !== 'unknown' && !extMap[ext].includes(magic.format)) {
    issues.push({
      title: `Extension Mismatch: Named ${ext} but Binary Is ${magic.format.toUpperCase()}`,
      severity: 'high',
      category: 'Technical Validation',
      explanation: `The file carries extension "${ext}", but its magic-byte header identifies it as ${magic.format.toUpperCase()}.`,
      recommendation: `Rename the file to match its true format (.${magic.format}) or re-encode properly so browsers/CDNs serve the right MIME type.`,
      evidence: `Declared extension: ${ext} · Magic signature: ${magic.format} (${magic.mime})`,
    });
  }

  // Handle SVG text inspection cleanly
  if (magic.format === 'svg' || ext === '.svg') {
    const svgText = buffer.toString('utf8');
    const hasSvgRoot = /<svg[\s>]/i.test(svgText);
    const hasViewBox = /viewBox\s*=/i.test(svgText);
    const hasScript = /<script[\s>]/i.test(svgText) || /\bon\w+\s*=/i.test(svgText);

    if (!hasSvgRoot) {
      issues.push({
        title: 'Corrupted or Invalid SVG Markup',
        severity: 'critical',
        category: 'Technical Validation',
        explanation: 'File does not contain a valid <svg> root element.',
        recommendation: 'Re-export the vector graphic from your design tool as clean SVG.',
        evidence: 'Missing <svg> opening tag.',
      });
    }
    if (!hasViewBox) {
      issues.push({
        title: 'SVG Missing viewBox Attribute',
        severity: 'medium',
        category: 'Compatibility',
        explanation: 'Without a viewBox attribute, the SVG will not scale cleanly inside responsive containers.',
        recommendation: 'Add a viewBox="0 0 width height" attribute to the <svg> root element.',
        evidence: 'No viewBox attribute detected.',
      });
    }
    if (hasScript) {
      issues.push({
        title: 'Potentially Malicious Embedded Script Inside SVG',
        severity: 'critical',
        category: 'Technical Validation',
        explanation: 'The SVG contains <script> or inline on* event attributes, which create Stored XSS risks.',
        recommendation: 'Sanitize the SVG with SVGO/DOMPurify before hosting.',
        evidence: 'Detected <script> or inline event handler attribute in SVG payload.',
      });
    }
    if (buffer.length > 300 * 1024) {
      issues.push({
        title: `Oversized SVG File (${(buffer.length / 1024).toFixed(0)} KB)`,
        severity: 'medium',
        category: 'Quality & Optimization',
        explanation: 'SVG exceeds 300 KB, often caused by embedded raster bitmaps or unoptimized vector paths.',
        recommendation: 'Run SVGO optimization or convert complex photographic artwork to WebP.',
        evidence: `Size: ${buffer.length} bytes`,
      });
    }

    return {
      mediaType: 'image',
      fileName,
      detectedFormat: hasSvgRoot ? 'svg' : magic.format,
      mimeType: 'image/svg+xml',
      sizeBytes: buffer.length,
      status: 'completed',
      metadata: {
        format: 'SVG',
        hasViewBox,
        containsEmbeddedScript: hasScript,
        sizeKb: Number((buffer.length / 1024).toFixed(1)),
      },
      issues,
    };
  }

  // Raster image inspection using Sharp (real binary decode)
  try {
    const meta = await sharp(buffer).metadata();
    const width = meta.width || 0;
    const height = meta.height || 0;
    const aspectRatio = height > 0 ? Number((width / height).toFixed(2)) : 0;

    if (width === 0 || height === 0) {
      issues.push({
        title: 'Invalid or Zero-Dimension Image',
        severity: 'critical',
        category: 'Technical Validation',
        explanation: 'Decoded image metadata reported 0px width or height.',
        recommendation: 'Re-export a valid non-empty image file.',
        evidence: `width=${width}, height=${height}`,
      });
    }

    if (buffer.length > 1024 * 1024) {
      issues.push({
        title: `Excessive Image File Size (${(buffer.length / (1024 * 1024)).toFixed(2)} MB)`,
        severity: buffer.length > 3 * 1024 * 1024 ? 'high' : 'medium',
        category: 'Quality & Optimization',
        explanation: 'Web images larger than 1 MB slow Largest Contentful Paint and consume excess bandwidth.',
        recommendation: 'Compress the image and convert to WebP (typically 30–60% smaller than PNG/JPEG).',
        evidence: `File size: ${buffer.length} bytes · Format: ${meta.format}`,
      });
    }

    if (width > 3840 || height > 3840) {
      issues.push({
        title: `Unusually Large Dimensions (${width} × ${height}px)`,
        severity: 'medium',
        category: 'Quality & Optimization',
        explanation: 'Resolution exceeds 4K (3840px), causing unnecessary GPU memory allocation in browsers.',
        recommendation: 'Resize to the maximum display dimensions needed (e.g., 1920px wide for full-bleed heroes) and serve srcset variants.',
        evidence: `Dimensions: ${width}x${height}px`,
      });
    }

    if (aspectRatio > 5 || (aspectRatio > 0 && aspectRatio < 0.2)) {
      issues.push({
        title: `Extreme Aspect Ratio (${aspectRatio}:1)`,
        severity: 'low',
        category: 'Quality & Optimization',
        explanation: 'The image has a heavily elongated aspect ratio that may clip or distort in standard cards.',
        recommendation: 'Crop to a standard ratio (16:9, 4:3, 1:1) or apply CSS object-fit: cover intentionally.',
        evidence: `Width ${width} / Height ${height} = ${aspectRatio}:1`,
      });
    }

    if (meta.format === 'png' && !meta.hasAlpha && buffer.length > 250 * 1024) {
      issues.push({
        title: 'Opaque PNG Without Transparency (Suboptimal Format)',
        severity: 'low',
        category: 'Quality & Optimization',
        explanation: 'This PNG contains no alpha transparency channel yet uses lossless PNG encoding.',
        recommendation: 'Convert to WebP or optimized JPEG to significantly reduce file size without losing transparency.',
        evidence: `format=png · hasAlpha=false · channels=${meta.channels} · size=${(buffer.length / 1024).toFixed(0)} KB`,
      });
    }

    // Check pixel density / low-res quality indicator
    if (width > 0 && width < 120 && height < 120 && !fileName.toLowerCase().includes('icon') && !fileName.toLowerCase().includes('favicon')) {
      issues.push({
        title: `Very Low Image Resolution (${width} × ${height}px)`,
        severity: 'low',
        category: 'Quality & Optimization',
        explanation: 'Small bitmap images appear blurry or pixelated when scaled up on high-DPI Retina displays.',
        recommendation: 'Provide a higher-resolution source (2x) or vector SVG.',
        evidence: `Dimensions: ${width}x${height}px`,
      });
    }

    return {
      mediaType: 'image',
      fileName,
      detectedFormat: meta.format || magic.format,
      mimeType: magic.mime !== 'application/octet-stream' ? magic.mime : `image/${meta.format || 'png'}`,
      sizeBytes: buffer.length,
      status: 'completed',
      metadata: {
        width,
        height,
        aspectRatio,
        format: (meta.format || magic.format).toUpperCase(),
        hasAlpha: Boolean(meta.hasAlpha),
        channels: meta.channels || null,
        space: meta.space || null,
        densityDpi: meta.density || null,
        sizeKb: Number((buffer.length / 1024).toFixed(1)),
      },
      issues,
    };
  } catch (err: unknown) {
    issues.push({
      title: 'Corrupted or Unreadable Image Binary',
      severity: 'critical',
      category: 'Technical Validation',
      explanation: `Sharp image decoder failed to parse this file: ${err instanceof Error ? err.message : 'Decode error'}.`,
      recommendation: 'Verify the file was not truncated during upload or corrupted on disk, and re-export from source.',
      evidence: err instanceof Error ? err.message : 'Binary decode failure',
    });
    return {
      mediaType: 'image',
      fileName,
      detectedFormat: magic.format,
      mimeType: magic.mime,
      sizeBytes: buffer.length,
      status: 'failed',
      metadata: {
        error: err instanceof Error ? err.message : 'Corrupted image',
        sizeKb: Number((buffer.length / 1024).toFixed(1)),
      },
      issues,
    };
  }
}

interface FfprobeOutput {
  streams?: Array<{
    codec_type?: string;
    codec_name?: string;
    width?: number;
    height?: number;
    r_frame_rate?: string;
    sample_rate?: string;
    channels?: number;
    bit_rate?: string;
    duration?: string;
  }>;
  format?: {
    format_name?: string;
    duration?: string;
    bit_rate?: string;
    size?: string;
  };
}

export async function inspectVideoBuffer(fileName: string, buffer: Buffer): Promise<MediaInspectionResult> {
  const ext = path.extname(fileName).toLowerCase();
  const magic = detectMagicSignature(buffer, ext);
  const issues: MediaIssue[] = [];
  const tmpFile = path.join(os.tmpdir(), `autopatch_vid_${crypto.randomUUID()}${ext || '.mp4'}`);

  try {
    await fs.writeFile(tmpFile, buffer);
    const { stdout } = await execFileAsync(
      'ffprobe',
      ['-v', 'error', '-show_format', '-show_streams', '-print_format', 'json', tmpFile],
      { timeout: 8000, env: {} }
    );

    const parsed = JSON.parse(stdout) as FfprobeOutput;
    const videoStream = parsed.streams?.find((s) => s.codec_type === 'video');
    const audioStream = parsed.streams?.find((s) => s.codec_type === 'audio');
    const durationSec = Number(parsed.format?.duration || videoStream?.duration || 0);
    const bitrateKbps = parsed.format?.bit_rate ? Math.round(Number(parsed.format.bit_rate) / 1000) : null;

    let fps: number | null = null;
    if (videoStream?.r_frame_rate && videoStream.r_frame_rate.includes('/')) {
      const [num, den] = videoStream.r_frame_rate.split('/').map(Number);
      if (den > 0) fps = Number((num / den).toFixed(2));
    }

    const width = videoStream?.width || 0;
    const height = videoStream?.height || 0;
    const codec = (videoStream?.codec_name || 'unknown').toLowerCase();

    if (!videoStream) {
      issues.push({
        title: 'Missing Video Stream Inside Container',
        severity: 'critical',
        category: 'Technical Validation',
        explanation: 'FFprobe inspected the container but found no valid video stream.',
        recommendation: 'Re-encode the source media with a valid video track (H.264/VP9).',
        evidence: `Container: ${parsed.format?.format_name || 'unknown'} · Streams: ${parsed.streams?.length || 0}`,
      });
    }

    if (!Number.isFinite(durationSec) || durationSec <= 0) {
      issues.push({
        title: 'Missing or Invalid Video Duration Metadata',
        severity: 'high',
        category: 'Technical Validation',
        explanation: 'Container metadata does not report a valid positive duration.',
        recommendation: 'Remux with FFmpeg (-movflags +faststart) to repair duration and seeking index.',
        evidence: `Reported duration: ${parsed.format?.duration ?? 'missing'}`,
      });
    }

    if (videoStream && !['h264', 'vp8', 'vp9', 'av1'].includes(codec)) {
      issues.push({
        title: `Limited Cross-Browser Video Codec (${codec.toUpperCase()})`,
        severity: 'high',
        category: 'Compatibility',
        explanation: `Codec "${codec}" is not universally playable across Chrome, Firefox, and Safari HTML5 <video> elements.`,
        recommendation: 'Transcode to H.264 (AVC, yuv420p) in MP4 or VP9/AV1 in WebM for universal browser playback.',
        evidence: `ffprobe video codec_name=${codec}`,
      });
    }

    if (!audioStream) {
      issues.push({
        title: 'No Audio Track Detected',
        severity: 'low',
        category: 'Compatibility',
        explanation: 'This video file has no audio stream. Ignore if intentionally muted background video.',
        recommendation: 'If narration or sound is expected, verify the audio track was not stripped during export.',
        evidence: 'ffprobe found 0 audio streams.',
      });
    }

    if (buffer.length > 20 * 1024 * 1024) {
      issues.push({
        title: `Large Video File Size (${(buffer.length / (1024 * 1024)).toFixed(1)} MB)`,
        severity: 'medium',
        category: 'Quality & Optimization',
        explanation: 'Large progressive video files cause buffering stalls for web visitors.',
        recommendation: 'Compress with CRF 23 H.264 or deliver adaptive HLS/DASH streaming segments.',
        evidence: `Size: ${(buffer.length / (1024 * 1024)).toFixed(2)} MB · Bitrate: ${bitrateKbps ?? 'unknown'} kbps`,
      });
    }

    if (width > 0 && height > 0 && (width % 2 !== 0 || height % 2 !== 0)) {
      issues.push({
        title: `Odd Video Dimensions (${width} × ${height})`,
        severity: 'medium',
        category: 'Compatibility',
        explanation: 'Odd pixel dimensions break hardware YUV420 decoders on several mobile browsers.',
        recommendation: 'Scale video dimensions to even integers (e.g. 1280x720 or 1920x1080).',
        evidence: `Resolution: ${width}x${height}`,
      });
    }

    return {
      mediaType: 'video',
      fileName,
      detectedFormat: parsed.format?.format_name || magic.format,
      mimeType: magic.mime !== 'application/octet-stream' ? magic.mime : `video/${ext.replace('.', '') || 'mp4'}`,
      sizeBytes: buffer.length,
      status: 'completed',
      metadata: {
        codec: codec.toUpperCase(),
        width,
        height,
        aspectRatio: height > 0 ? Number((width / height).toFixed(2)) : null,
        fps,
        durationSeconds: Number(durationSec.toFixed(2)),
        bitrateKbps,
        hasAudioTrack: Boolean(audioStream),
        audioCodec: audioStream?.codec_name?.toUpperCase() || 'None',
        container: parsed.format?.format_name || 'unknown',
      },
      issues,
    };
  } catch (err: unknown) {
    const msg = (err as { stderr?: string })?.stderr || (err instanceof Error ? err.message : 'FFprobe decode failed');
    issues.push({
      title: 'Corrupted or Unreadable Video File',
      severity: 'critical',
      category: 'Technical Validation',
      explanation: 'FFprobe could not parse container headers or streams for this video file.',
      recommendation: 'Verify the video file is intact and encoded in a valid MP4, WebM, or MOV container.',
      evidence: msg.trim().slice(0, 260),
    });
    return {
      mediaType: 'video',
      fileName,
      detectedFormat: magic.format,
      mimeType: magic.mime,
      sizeBytes: buffer.length,
      status: 'failed',
      metadata: { error: msg.trim().slice(0, 200) },
      issues,
    };
  } finally {
    await fs.rm(tmpFile, { force: true }).catch(() => {});
  }
}

export async function inspectAudioBuffer(fileName: string, buffer: Buffer): Promise<MediaInspectionResult> {
  const ext = path.extname(fileName).toLowerCase();
  const magic = detectMagicSignature(buffer, ext);
  const issues: MediaIssue[] = [];
  const tmpFile = path.join(os.tmpdir(), `autopatch_aud_${crypto.randomUUID()}${ext || '.mp3'}`);

  try {
    await fs.writeFile(tmpFile, buffer);
    const { stdout } = await execFileAsync(
      'ffprobe',
      ['-v', 'error', '-show_format', '-show_streams', '-print_format', 'json', tmpFile],
      { timeout: 8000, env: {} }
    );

    const parsed = JSON.parse(stdout) as FfprobeOutput;
    const audioStream = parsed.streams?.find((s) => s.codec_type === 'audio');
    const durationSec = Number(parsed.format?.duration || audioStream?.duration || 0);
    const sampleRate = audioStream?.sample_rate ? Number(audioStream.sample_rate) : null;
    const channels = audioStream?.channels || null;
    const bitrateKbps = Number(audioStream?.bit_rate || parsed.format?.bit_rate || 0)
      ? Math.round(Number(audioStream?.bit_rate || parsed.format?.bit_rate || 0) / 1000)
      : null;
    const codec = (audioStream?.codec_name || 'unknown').toLowerCase();

    // Real loudness & clipping detection via ffmpeg volumedetect filter!
    let meanVolumeDb: number | null = null;
    let maxVolumeDb: number | null = null;
    try {
      const volRes = await execFileAsync(
        'ffmpeg',
        ['-i', tmpFile, '-af', 'volumedetect', '-vn', '-sn', '-dn', '-f', 'null', '-'],
        { timeout: 10000, env: {} }
      );
      const stderrText = volRes.stderr || '';
      const meanMatch = stderrText.match(/mean_volume:\s*(-?\d+(?:\.\d+)?)\s*dB/);
      const maxMatch = stderrText.match(/max_volume:\s*(-?\d+(?:\.\d+)?)\s*dB/);
      if (meanMatch) meanVolumeDb = Number(meanMatch[1]);
      if (maxMatch) maxVolumeDb = Number(maxMatch[1]);
    } catch {
      // volumedetect optional if stream cannot decode
    }

    if (!audioStream) {
      issues.push({
        title: 'No Valid Audio Stream Found',
        severity: 'critical',
        category: 'Technical Validation',
        explanation: 'FFprobe could not locate a decodable audio stream in the uploaded file.',
        recommendation: 'Re-export the audio as MP3, WAV, AAC, or OGG.',
        evidence: `Container: ${parsed.format?.format_name || 'unknown'}`,
      });
    }

    if (!Number.isFinite(durationSec) || durationSec <= 0) {
      issues.push({
        title: 'Invalid or Zero Audio Duration',
        severity: 'high',
        category: 'Technical Validation',
        explanation: 'Audio metadata reports 0s or missing duration.',
        recommendation: 'Verify the recording is not empty and re-encode headers.',
        evidence: `duration=${parsed.format?.duration ?? 'missing'}`,
      });
    }

    if (maxVolumeDb !== null && maxVolumeDb >= -0.3) {
      issues.push({
        title: `Audio Clipping / Peak Distortion Risk (Max Peak ${maxVolumeDb} dB)`,
        severity: 'high',
        category: 'Quality & Optimization',
        explanation: `FFmpeg volumedetect measured a peak amplitude of ${maxVolumeDb} dB (near 0 dBFS digital ceiling), indicating likely clipping distortion.`,
        recommendation: 'Apply a -1.0 dB true-peak limiter and normalize loudness to -16 LUFS (web stereo).',
        evidence: `ffmpeg volumedetect: max_volume=${maxVolumeDb} dB, mean_volume=${meanVolumeDb ?? 'n/a'} dB`,
      });
    }

    if (meanVolumeDb !== null && meanVolumeDb <= -35) {
      issues.push({
        title: `Unusually Low Audio Level (Mean ${meanVolumeDb} dB)`,
        severity: 'medium',
        category: 'Quality & Optimization',
        explanation: `Average audio loudness is ${meanVolumeDb} dB, which may sound nearly silent on laptop or phone speakers.`,
        recommendation: 'Normalize loudness with ffmpeg loudnorm filter to -16 LUFS.',
        evidence: `ffmpeg volumedetect: mean_volume=${meanVolumeDb} dB, max_volume=${maxVolumeDb ?? 'n/a'} dB`,
      });
    }

    if (sampleRate && sampleRate < 22050) {
      issues.push({
        title: `Low Audio Sample Rate (${sampleRate} Hz)`,
        severity: 'low',
        category: 'Quality & Optimization',
        explanation: 'Sample rates below 22.05 kHz discard high frequencies and reduce vocal clarity.',
        recommendation: 'Export at 44.1 kHz or 48 kHz for crisp web playback.',
        evidence: `sample_rate=${sampleRate} Hz`,
      });
    }

    if (audioStream && !['mp3', 'aac', 'pcm_s16le', 'pcm_s24le', 'pcm_f32le', 'vorbis', 'opus', 'flac'].includes(codec)) {
      issues.push({
        title: `Browser Playback Compatibility Risk (${codec.toUpperCase()})`,
        severity: 'medium',
        category: 'Compatibility',
        explanation: `Audio codec "${codec}" may not play natively in all browsers.`,
        recommendation: 'Encode as MP3, AAC (M4A), or Opus (OGG/WebM) for wide browser compatibility.',
        evidence: `ffprobe audio codec_name=${codec}`,
      });
    }

    return {
      mediaType: 'audio',
      fileName,
      detectedFormat: parsed.format?.format_name || magic.format,
      mimeType: magic.mime !== 'application/octet-stream' ? magic.mime : `audio/${ext.replace('.', '') || 'mpeg'}`,
      sizeBytes: buffer.length,
      status: 'completed',
      metadata: {
        codec: codec.toUpperCase(),
        durationSeconds: Number(durationSec.toFixed(2)),
        sampleRateHz: sampleRate,
        bitrateKbps,
        channels,
        meanVolumeDb,
        maxVolumeDb,
        container: parsed.format?.format_name || 'unknown',
      },
      issues,
    };
  } catch (err: unknown) {
    const msg = (err as { stderr?: string })?.stderr || (err instanceof Error ? err.message : 'FFprobe audio decode failed');
    issues.push({
      title: 'Corrupted or Unreadable Audio File',
      severity: 'critical',
      category: 'Technical Validation',
      explanation: 'FFprobe failed to decode the audio container or headers.',
      recommendation: 'Check that the audio file is intact and saved in MP3, WAV, AAC, or OGG format.',
      evidence: msg.trim().slice(0, 260),
    });
    return {
      mediaType: 'audio',
      fileName,
      detectedFormat: magic.format,
      mimeType: magic.mime,
      sizeBytes: buffer.length,
      status: 'failed',
      metadata: { error: msg.trim().slice(0, 200) },
      issues,
    };
  } finally {
    await fs.rm(tmpFile, { force: true }).catch(() => {});
  }
}

export interface ProjectMediaAuditIssue {
  filePath: string;
  reference: string;
  mediaType: 'image' | 'video' | 'audio';
  severity: 'high' | 'medium' | 'low';
  issue: string;
  recommendation: string;
}

export function auditProjectMediaReferences(
  files: Array<{ file_path: string; language: string; current_content: string }>
): { totalReferences: number; issues: ProjectMediaAuditIssue[] } {
  const existingPaths = new Set(files.map((f) => f.file_path.toLowerCase()));
  const issues: ProjectMediaAuditIssue[] = [];
  let totalReferences = 0;

  const checkLocalPath = (fromFile: string, ref: string, mediaType: 'image' | 'video' | 'audio') => {
    totalReferences++;
    const clean = ref.split('?')[0].split('#')[0].trim();
    if (!clean || clean.startsWith('http://') || clean.startsWith('https://') || clean.startsWith('data:')) {
      return;
    }
    const baseDir = path.posix.dirname(fromFile);
    const resolved = path.posix.normalize(path.posix.join(baseDir === '.' ? '' : baseDir, clean)).replace(/^\/+/, '');
    if (!existingPaths.has(resolved.toLowerCase()) && !existingPaths.has(clean.replace(/^\/+/, '').toLowerCase())) {
      issues.push({
        filePath: fromFile,
        reference: ref,
        mediaType,
        severity: 'high',
        issue: `Referenced local ${mediaType} asset "${ref}" was not found in uploaded project files.`,
        recommendation: `Verify the asset exists at "${resolved}" or update the relative path.`,
      });
    }
    const ext = path.extname(clean).toLowerCase();
    const unsupportedMap: Record<string, string[]> = {
      image: ['.bmp', '.tiff', '.tif', '.psd', '.heic'],
      video: ['.avi', '.wmv', '.flv', '.mkv'],
      audio: ['.wma', '.aiff', '.mid'],
    };
    if (unsupportedMap[mediaType].includes(ext)) {
      issues.push({
        filePath: fromFile,
        reference: ref,
        mediaType,
        severity: 'medium',
        issue: `Unsupported web ${mediaType} format (${ext}) referenced in ${fromFile}.`,
        recommendation:
          mediaType === 'image'
            ? 'Convert to WebP, PNG, JPEG, or SVG.'
            : mediaType === 'video'
              ? 'Transcode to MP4 (H.264) or WebM.'
              : 'Convert to MP3, AAC, WAV, or OGG.',
      });
    }
  };

  for (const f of files) {
    if (f.language === 'html' || f.language === 'javascript' || f.language === 'typescript') {
      const $ = cheerio.load(f.current_content);
      $('img').each((_, el) => {
        const src = $(el).attr('src');
        if (src) checkLocalPath(f.file_path, src, 'image');
        if ($(el).attr('alt') === undefined) {
          issues.push({
            filePath: f.file_path,
            reference: src || '<img>',
            mediaType: 'image',
            severity: 'medium',
            issue: 'Image element missing alt attribute for accessibility.',
            recommendation: 'Add descriptive alt="..." text to the <img> element.',
          });
        }
      });
      $('video, video source').each((_, el) => {
        const src = $(el).attr('src');
        if (src) checkLocalPath(f.file_path, src, 'video');
      });
      $('audio, audio source').each((_, el) => {
        const src = $(el).attr('src');
        if (src) checkLocalPath(f.file_path, src, 'audio');
      });
    }
    if (f.language === 'css' || f.language === 'scss') {
      const urlRegex = /url\(\s*['"]?([^'")]+)['"]?\s*\)/g;
      let match: RegExpExecArray | null;
      while ((match = urlRegex.exec(f.current_content)) !== null) {
        if (/\.(png|jpe?g|webp|svg|gif|bmp|tiff)(\?|$)/i.test(match[1])) {
          checkLocalPath(f.file_path, match[1], 'image');
        }
      }
    }
  }

  return { totalReferences, issues };
}
