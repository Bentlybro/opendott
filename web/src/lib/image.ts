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

// Safety limits for DOTT device
const MAX_GIF_SIZE = 512 * 1024;  // 512KB max - device has limited RAM
const MAX_FRAMES = 50;  // Too many frames can cause issues
const MAX_DIMENSION = 500;  // Sanity check for dimensions

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
 * Thoroughly validate GIF structure to prevent device bricking.
 * Returns { valid: true } or { valid: false, error: "reason" }
 */
function validateGifStructure(data: Uint8Array): { valid: boolean; error?: string } {
  // Check minimum size
  if (data.length < 13) {
    return { valid: false, error: 'File is too small to be a valid GIF' };
  }
  
  // Check GIF header
  const header = String.fromCharCode(data[0], data[1], data[2]);
  if (header !== 'GIF') {
    return { valid: false, error: 'Not a valid GIF file (invalid header)' };
  }
  
  // Check version
  const version = String.fromCharCode(data[3], data[4], data[5]);
  if (version !== '87a' && version !== '89a') {
    return { valid: false, error: `Unsupported GIF version: ${version}` };
  }
  
  // Check dimensions
  const width = data[6] | (data[7] << 8);
  const height = data[8] | (data[9] << 8);
  
  if (width === 0 || height === 0) {
    return { valid: false, error: 'GIF has invalid dimensions (0x0)' };
  }
  
  if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
    return { valid: false, error: `GIF is too large (${width}×${height}). Maximum is ${MAX_DIMENSION}×${MAX_DIMENSION}` };
  }
  
  // Check file size
  if (data.length > MAX_GIF_SIZE) {
    return { valid: false, error: `GIF is too large (${Math.round(data.length / 1024)}KB). Maximum is ${MAX_GIF_SIZE / 1024}KB` };
  }
  
  // Parse through the GIF to check structure
  let pos = 13;
  
  // Skip global color table if present
  if (data[10] & 0x80) {
    const gctSize = 3 * (2 ** ((data[10] & 0x07) + 1));
    pos += gctSize;
    if (pos > data.length) {
      return { valid: false, error: 'GIF has truncated global color table' };
    }
  }
  
  let frameCount = 0;
  let foundTrailer = false;
  
  // Parse blocks
  while (pos < data.length) {
    const blockType = data[pos];
    
    if (blockType === 0x21) {
      // Extension block
      if (pos + 1 >= data.length) {
        return { valid: false, error: 'GIF has truncated extension block' };
      }
      
      const extType = data[pos + 1];
      
      if (extType === 0xF9) {
        // Graphic Control Extension (fixed size)
        pos += 8;
      } else {
        // Other extensions (variable size) - skip sub-blocks
        pos += 2;
        while (pos < data.length && data[pos] !== 0) {
          const subBlockSize = data[pos];
          pos += subBlockSize + 1;
          if (pos > data.length) {
            return { valid: false, error: 'GIF has truncated extension sub-block' };
          }
        }
        pos += 1; // Block terminator
      }
    } else if (blockType === 0x2C) {
      // Image descriptor
      if (pos + 10 > data.length) {
        return { valid: false, error: 'GIF has truncated image descriptor' };
      }
      
      frameCount++;
      if (frameCount > MAX_FRAMES) {
        return { valid: false, error: `GIF has too many frames (${frameCount}). Maximum is ${MAX_FRAMES}` };
      }
      
      pos += 10;
      
      // Skip local color table if present
      if (data[pos - 1] & 0x80) {
        const lctSize = 3 * (2 ** ((data[pos - 1] & 0x07) + 1));
        pos += lctSize;
        if (pos > data.length) {
          return { valid: false, error: 'GIF has truncated local color table' };
        }
      }
      
      // LZW minimum code size
      if (pos >= data.length) {
        return { valid: false, error: 'GIF has truncated image data' };
      }
      pos += 1;
      
      // Skip image data sub-blocks
      while (pos < data.length && data[pos] !== 0) {
        const subBlockSize = data[pos];
        pos += subBlockSize + 1;
        if (pos > data.length) {
          return { valid: false, error: 'GIF has truncated image data block' };
        }
      }
      pos += 1; // Block terminator
    } else if (blockType === 0x3B) {
      // Trailer - end of GIF
      foundTrailer = true;
      break;
    } else if (blockType === 0x00) {
      // Padding byte - skip
      pos += 1;
    } else {
      // Unknown block type - could be corrupt
      return { valid: false, error: `GIF has unknown block type: 0x${blockType.toString(16)}` };
    }
  }
  
  if (frameCount === 0) {
    return { valid: false, error: 'GIF has no image frames' };
  }
  
  if (!foundTrailer) {
    return { valid: false, error: 'GIF is missing trailer (file may be truncated)' };
  }
  
  return { valid: true };
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

export async function processImageForDevice(
  file: File,
  autoConvert: boolean = true,
  onProgress?: (stage: string, progress: number) => void
): Promise<Uint8Array> {
  // Read the file
  const buffer = await file.arrayBuffer();
  const data = new Uint8Array(buffer);
  const type = detectImageType(data);
  
  // GIFs: Validate structure first to prevent bricking
  if (type === 'gif') {
    console.log(`GIF detected (${data.length} bytes) - validating...`);
    
    // Structural validation (prevents corrupt/truncated GIFs from bricking device)
    const structureCheck = validateGifStructure(data);
    if (!structureCheck.valid) {
      throw new Error(`Invalid GIF: ${structureCheck.error}`);
    }
    
    // Check dimensions - DOTT is 240x240, warn if very different
    const width = data[6] | (data[7] << 8);
    const height = data[8] | (data[9] << 8);
    
    // If dimensions are way off and auto-convert is enabled, convert it
    if (autoConvert && (width > 300 || height > 300 || width < 50 || height < 50)) {
      console.log(`GIF dimensions (${width}×${height}) need resizing - converting...`);
      onProgress?.('Resizing GIF', 30);
      const { convertAnimatedGif, needsConversion } = await import('./gifConverter');
      const conversionNeeded = needsConversion(data);
      if (conversionNeeded.needs) {
        try {
          const result = await convertAnimatedGif(file, (p) => {
            onProgress?.(p.stage, p.progress);
          });
          // Validate the converted output too
          const convertedCheck = validateGifStructure(result.data);
          if (!convertedCheck.valid) {
            throw new Error(`Conversion produced invalid GIF: ${convertedCheck.error}`);
          }
          console.log(`Converted GIF: ${result.frameCount} frames, ${result.data.length} bytes`);
          return result.data;
        } catch (e) {
          // If conversion fails, log warning but try sending original
          console.warn('GIF conversion failed, trying original:', e);
        }
      }
    }
    
    // Frame validation (warns about partial frames that won't animate)
    const frameCheck = validateGifFrames(data);
    if (!frameCheck.valid && frameCheck.warning) {
      console.warn(frameCheck.warning);
      // Don't block - just warn. Partial frames display but don't animate.
    }
    
    console.log(`GIF validated OK - sending raw (${data.length} bytes)`);
    return data;
  }
  
  // PNG/JPEG: Convert to GIF (required - device only accepts GIF)
  if ((type === 'png' || type === 'jpeg') && autoConvert) {
    const { convertStaticToGif } = await import('./gifConverter');
    onProgress?.('Converting to GIF', 50);
    const converted = await convertStaticToGif(file);
    
    // Validate the converted output
    const convertedCheck = validateGifStructure(converted);
    if (!convertedCheck.valid) {
      throw new Error(`Conversion produced invalid GIF: ${convertedCheck.error}`);
    }
    
    return converted;
  }
  
  // Return raw data for anything else
  return data;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
