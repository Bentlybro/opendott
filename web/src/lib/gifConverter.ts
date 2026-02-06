/**
 * GIF Converter - Auto-resize and un-optimize GIFs for DOTT
 * 
 * The DOTT device requires:
 * - 240x240 pixel dimensions
 * - Full frames (no delta/optimized frames)
 * 
 * This uses gifuct-js to decode and gif.js to encode.
 */

import { parseGIF, decompressFrames } from 'gifuct-js';
// @ts-ignore - gif.js doesn't have types
import GIF from 'gif.js-upgrade';

const TARGET_SIZE = 240;
const MAX_FRAMES = 30;  // Limit frame count to keep file size reasonable

/**
 * Inject NETSCAPE extension for looping if missing.
 * Must be inserted right after the global color table, before the first frame.
 */
function ensureNetscapeLoop(data: Uint8Array): Uint8Array<ArrayBuffer> {
  // Check if NETSCAPE already exists
  const str = String.fromCharCode.apply(null, Array.from(data.slice(0, 500)));
  if (str.includes('NETSCAPE')) {
    console.log('NETSCAPE already present');
    return new Uint8Array(data) as Uint8Array<ArrayBuffer>;
  }
  
  // Find insertion point: after header (6) + LSD (7) + global color table
  let insertPos = 13;  // After header + logical screen descriptor
  if (data[10] & 0x80) {  // Global color table present
    const gctSize = 3 * (2 ** ((data[10] & 0x07) + 1));
    insertPos += gctSize;
  }
  
  // NETSCAPE2.0 extension block (19 bytes)
  // 21 FF 0B 4E 45 54 53 43 41 50 45 32 2E 30 03 01 00 00 00
  const netscape = new Uint8Array([
    0x21, 0xFF,       // Extension introducer + Application extension label
    0x0B,             // Block size (11 bytes)
    0x4E, 0x45, 0x54, 0x53, 0x43, 0x41, 0x50, 0x45,  // "NETSCAPE"
    0x32, 0x2E, 0x30, // "2.0"
    0x03,             // Sub-block size (3 bytes)
    0x01,             // Sub-block ID (always 1 for loop)
    0x00, 0x00,       // Loop count: 0 = infinite (little-endian)
    0x00              // Block terminator
  ]);
  
  // Create new array with NETSCAPE inserted
  const result = new Uint8Array(data.length + netscape.length);
  result.set(data.slice(0, insertPos), 0);
  result.set(netscape, insertPos);
  result.set(data.slice(insertPos), insertPos + netscape.length);
  
  console.log(`Injected NETSCAPE extension at position ${insertPos}`);
  return result as Uint8Array<ArrayBuffer>;
}

export interface ConversionResult {
  data: Uint8Array;
  frameCount: number;
  originalSize: { width: number; height: number };
}

export interface ConversionProgress {
  stage: 'decoding' | 'rendering' | 'encoding';
  progress: number;  // 0-100
}

/**
 * Check if GIF needs conversion
 */
export function needsConversion(data: Uint8Array): { needs: boolean; reason: string } {
  if (data.length < 10) {
    return { needs: false, reason: 'Invalid GIF' };
  }
  
  const width = data[6] | (data[7] << 8);
  const height = data[8] | (data[9] << 8);
  
  if (width !== TARGET_SIZE || height !== TARGET_SIZE) {
    return { needs: true, reason: `Resize ${width}×${height} → ${TARGET_SIZE}×${TARGET_SIZE}` };
  }
  
  // Check for partial frames
  let pos = 13;
  if (data[10] & 0x80) {
    pos += 3 * (2 ** ((data[10] & 0x07) + 1));
  }
  
  while (pos < data.length - 1) {
    if (data[pos] === 0x21) {
      if (data[pos + 1] === 0xF9) pos += 8;
      else {
        pos += 2;
        while (pos < data.length && data[pos] !== 0) pos += data[pos] + 1;
        pos += 1;
      }
    } else if (data[pos] === 0x2C) {
      const fw = data[pos + 5] | (data[pos + 6] << 8);
      const fh = data[pos + 7] | (data[pos + 8] << 8);
      if (fw !== width || fh !== height) {
        return { needs: true, reason: 'Convert partial frames → full frames' };
      }
      pos += 10;
      if (data[pos - 1] & 0x80) pos += 3 * (2 ** ((data[pos - 1] & 0x07) + 1));
      pos += 1;
      while (pos < data.length && data[pos] !== 0) pos += data[pos] + 1;
      pos += 1;
    } else if (data[pos] === 0x3B) break;
    else pos += 1;
  }
  
  return { needs: false, reason: 'Ready' };
}

/**
 * Convert animated GIF to 240x240 with full frames
 */
export async function convertAnimatedGif(
  file: File,
  onProgress?: (progress: ConversionProgress) => void
): Promise<ConversionResult> {
  // Read file
  const buffer = await file.arrayBuffer();
  const data = new Uint8Array(buffer);
  
  onProgress?.({ stage: 'decoding', progress: 10 });
  
  // Parse GIF
  const gif = parseGIF(data.buffer as ArrayBuffer);
  const frames = decompressFrames(gif, true);
  
  if (frames.length === 0) {
    throw new Error('No frames found in GIF');
  }
  
  // Limit frame count to keep file size reasonable
  let frameStep = 1;
  let selectedFrames = frames;
  
  if (frames.length > MAX_FRAMES) {
    // Sample frames evenly
    frameStep = Math.ceil(frames.length / MAX_FRAMES);
    selectedFrames = frames.filter((_, i) => i % frameStep === 0);
    console.log(`Reducing frames: ${frames.length} → ${selectedFrames.length} (every ${frameStep}th frame)`);
  }
  
  onProgress?.({ stage: 'decoding', progress: 30 });
  
  const originalWidth = gif.lsd.width;
  const originalHeight = gif.lsd.height;
  
  // Create encoder with optimized settings for smaller file size
  const encoder = new GIF({
    workers: 2,
    quality: 20,  // Higher = faster but larger. 10-20 is good balance.
    width: TARGET_SIZE,
    height: TARGET_SIZE,
    workerScript: '/gif.worker.js',
    dither: false,  // Disable dithering for cleaner output
    repeat: 0,  // 0 = infinite loop, -1 = no repeat, N = repeat N times
  });
  
  // Create canvas for compositing
  const canvas = document.createElement('canvas');
  canvas.width = TARGET_SIZE;
  canvas.height = TARGET_SIZE;
  const ctx = canvas.getContext('2d')!;
  
  // Full-size canvas for frame compositing (original size)
  const fullCanvas = document.createElement('canvas');
  fullCanvas.width = originalWidth;
  fullCanvas.height = originalHeight;
  const fullCtx = fullCanvas.getContext('2d')!;
  
  onProgress?.({ stage: 'rendering', progress: 40 });
  
  // Process each frame
  for (let i = 0; i < selectedFrames.length; i++) {
    const frame = selectedFrames[i];
    // Adjust delay to compensate for skipped frames
    const adjustedDelay = (frame.delay || 100) * frameStep;
    
    // Create ImageData for this frame's patch
    const frameImageData = new ImageData(
      new Uint8ClampedArray(frame.patch),
      frame.dims.width,
      frame.dims.height
    );
    
    // Put frame patch at correct position
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = frame.dims.width;
    tempCanvas.height = frame.dims.height;
    const tempCtx = tempCanvas.getContext('2d')!;
    tempCtx.putImageData(frameImageData, 0, 0);
    
    // Draw patch onto full canvas
    fullCtx.drawImage(tempCanvas, frame.dims.left, frame.dims.top);
    
    // Scale and draw to target canvas
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, TARGET_SIZE, TARGET_SIZE);
    
    const scale = Math.min(TARGET_SIZE / originalWidth, TARGET_SIZE / originalHeight);
    const scaledW = originalWidth * scale;
    const scaledH = originalHeight * scale;
    const x = (TARGET_SIZE - scaledW) / 2;
    const y = (TARGET_SIZE - scaledH) / 2;
    
    ctx.drawImage(fullCanvas, x, y, scaledW, scaledH);
    
    // Add frame to encoder
    encoder.addFrame(ctx, {
      delay: adjustedDelay,
      copy: true
    });
    
    // Handle disposal
    if (frame.disposalType === 2) {
      // Restore to background
      fullCtx.clearRect(frame.dims.left, frame.dims.top, frame.dims.width, frame.dims.height);
    }
    
    onProgress?.({ stage: 'rendering', progress: 40 + (i / selectedFrames.length) * 40 });
  }
  
  onProgress?.({ stage: 'encoding', progress: 80 });
  
  // Render GIF
  return new Promise((resolve, reject) => {
    encoder.on('finished', (blob: Blob) => {
      blob.arrayBuffer().then(buffer => {
        onProgress?.({ stage: 'encoding', progress: 100 });
        let data = new Uint8Array(buffer);
        console.log(`Converted GIF: ${selectedFrames.length} frames, ${buffer.byteLength} bytes`);
        
        // Ensure NETSCAPE loop extension is present (gif.js bug workaround)
        data = ensureNetscapeLoop(data);
        
        // Verify NETSCAPE extension
        const str = String.fromCharCode.apply(null, Array.from(data.slice(0, 500)));
        const netIdx = str.indexOf('NETSCAPE');
        if (netIdx >= 0) {
          console.log(`✓ NETSCAPE found at ${netIdx}, loop count: ${data[netIdx+16] | (data[netIdx+17] << 8)} (0=infinite)`);
        } else {
          console.error('✗ NETSCAPE injection failed!');
        }
        
        resolve({
          data,
          frameCount: selectedFrames.length,
          originalSize: { width: originalWidth, height: originalHeight }
        });
      });
    });
    
    encoder.on('error', reject);
    encoder.render();
  });
}

/**
 * Convert static image to 240x240 GIF
 */
export async function convertStaticToGif(file: File): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = TARGET_SIZE;
      canvas.height = TARGET_SIZE;
      const ctx = canvas.getContext('2d')!;
      
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, TARGET_SIZE, TARGET_SIZE);
      
      const scale = Math.min(TARGET_SIZE / img.naturalWidth, TARGET_SIZE / img.naturalHeight);
      const scaledW = img.naturalWidth * scale;
      const scaledH = img.naturalHeight * scale;
      const x = (TARGET_SIZE - scaledW) / 2;
      const y = (TARGET_SIZE - scaledH) / 2;
      
      ctx.drawImage(img, x, y, scaledW, scaledH);
      
      // Create single-frame GIF
      const encoder = new GIF({
        workers: 1,
        quality: 10,
        width: TARGET_SIZE,
        height: TARGET_SIZE,
        workerScript: '/gif.worker.js',
        repeat: 0,  // 0 = infinite loop
      });
      
      encoder.addFrame(ctx, { delay: 1000, copy: true });
      
      encoder.on('finished', (blob: Blob) => {
        blob.arrayBuffer().then(buffer => {
          URL.revokeObjectURL(url);
          // Ensure NETSCAPE loop extension (even for single-frame, for consistency)
          const data = ensureNetscapeLoop(new Uint8Array(buffer as ArrayBuffer));
          resolve(data);
        });
      });
      
      encoder.on('error', (e: Error) => {
        URL.revokeObjectURL(url);
        reject(e);
      });
      
      encoder.render();
    };
    
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image'));
    };
    
    img.src = url;
  });
}
