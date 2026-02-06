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
