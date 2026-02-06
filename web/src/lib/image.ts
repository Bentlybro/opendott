/**
 * Image validation and processing utilities
 */

export interface ImageInfo {
  file: File;
  width: number;
  height: number;
  type: 'gif' | 'png' | 'jpeg' | 'unknown';
  isAnimated: boolean;
  dataUrl: string;
  frameWarning?: string;  // Warning about partial frames
  frameCount?: number;
}

// Magic bytes for image detection
const GIF_MAGIC = [0x47, 0x49, 0x46];  // "GIF"
const PNG_MAGIC = [0x89, 0x50, 0x4E, 0x47];  // PNG signature
const JPEG_MAGIC = [0xFF, 0xD8, 0xFF];  // JPEG SOI

function detectImageType(data: Uint8Array): 'gif' | 'png' | 'jpeg' | 'unknown' {
  if (data.length < 4) return 'unknown';
  
  if (data[0] === GIF_MAGIC[0] && data[1] === GIF_MAGIC[1] && data[2] === GIF_MAGIC[2]) {
    return 'gif';
  }
  if (data[0] === PNG_MAGIC[0] && data[1] === PNG_MAGIC[1] && 
      data[2] === PNG_MAGIC[2] && data[3] === PNG_MAGIC[3]) {
    return 'png';
  }
  if (data[0] === JPEG_MAGIC[0] && data[1] === JPEG_MAGIC[1] && data[2] === JPEG_MAGIC[2]) {
    return 'jpeg';
  }
  return 'unknown';
}

function isAnimatedGif(data: Uint8Array): boolean {
  // Count NETSCAPE extension blocks and graphic control extensions
  let graphicControlCount = 0;
  
  for (let i = 0; i < data.length - 3; i++) {
    // Graphic Control Extension
    if (data[i] === 0x21 && data[i + 1] === 0xF9) {
      graphicControlCount++;
      if (graphicControlCount > 1) return true;
    }
  }
  
  return false;
}

/**
 * Check if GIF has full frames (required for DOTT animation!)
 * Returns { valid, warning, frameCount }
 */
function validateGifFrames(data: Uint8Array): { valid: boolean; warning?: string; frameCount: number } {
  const width = data[6] | (data[7] << 8);
  const height = data[8] | (data[9] << 8);
  
  let pos = 13;
  if (data[10] & 0x80) {  // Global color table
    const gctSize = 3 * (2 ** ((data[10] & 0x07) + 1));
    pos += gctSize;
  }
  
  const frames: Array<{ w: number; h: number }> = [];
  
  while (pos < data.length - 1) {
    if (data[pos] === 0x21) {  // Extension
      if (data[pos + 1] === 0xF9) {  // GCE
        pos += 8;
      } else {
        pos += 2;
        while (pos < data.length && data[pos] !== 0) {
          pos += data[pos] + 1;
        }
        pos += 1;
      }
    } else if (data[pos] === 0x2C) {  // Image descriptor
      const fw = data[pos + 5] | (data[pos + 6] << 8);
      const fh = data[pos + 7] | (data[pos + 8] << 8);
      frames.push({ w: fw, h: fh });
      
      pos += 10;
      if (data[pos - 1] & 0x80) {  // Local color table
        pos += 3 * (2 ** ((data[pos - 1] & 0x07) + 1));
      }
      pos += 1;  // LZW min code size
      while (pos < data.length && data[pos] !== 0) {
        pos += data[pos] + 1;
      }
      pos += 1;
    } else if (data[pos] === 0x3B) {  // Trailer
      break;
    } else {
      pos += 1;
    }
  }
  
  const partialFrames = frames.filter(f => f.w !== width || f.h !== height);
  
  if (partialFrames.length > 0 && frames.length > 1) {
    return {
      valid: false,
      warning: `⚠️ This GIF has ${partialFrames.length} optimized/partial frame(s). DOTT requires full ${width}×${height} frames for animation to work. The image will display but may not animate. Use "gifsicle --unoptimize" to fix.`,
      frameCount: frames.length
    };
  }
  
  return { valid: true, frameCount: frames.length };
}

export async function validateImage(file: File): Promise<ImageInfo> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = async () => {
      const arrayBuffer = reader.result as ArrayBuffer;
      const data = new Uint8Array(arrayBuffer);
      
      const type = detectImageType(data);
      if (type === 'unknown') {
        reject(new Error('Unsupported image format. Please use GIF, PNG, or JPEG.'));
        return;
      }
      
      const isAnimated = type === 'gif' && isAnimatedGif(data);
      
      // Check for partial frames (GIF only)
      let frameWarning: string | undefined;
      let frameCount = 1;
      if (type === 'gif' && isAnimated) {
        const frameValidation = validateGifFrames(data);
        if (!frameValidation.valid) {
          frameWarning = frameValidation.warning;
        }
        frameCount = frameValidation.frameCount;
      }
      
      // Get dimensions using Image element
      const img = new Image();
      const dataUrl = URL.createObjectURL(file);
      
      img.onload = () => {
        resolve({
          file,
          width: img.naturalWidth,
          height: img.naturalHeight,
          type,
          isAnimated,
          dataUrl,
          frameWarning,
          frameCount,
        });
      };
      
      img.onerror = () => {
        URL.revokeObjectURL(dataUrl);
        reject(new Error('Failed to load image'));
      };
      
      img.src = dataUrl;
    };
    
    reader.onerror = () => {
      reject(new Error('Failed to read file'));
    };
    
    reader.readAsArrayBuffer(file);
  });
}

export async function processImageForDevice(file: File): Promise<Uint8Array> {
  // For now, just return the raw file data
  // TODO: Add resizing/cropping to 240x240 if needed
  // TODO: Convert to GIF format if not already
  
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = () => {
      resolve(new Uint8Array(reader.result as ArrayBuffer));
    };
    
    reader.onerror = () => {
      reject(new Error('Failed to read file'));
    };
    
    reader.readAsArrayBuffer(file);
  });
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
