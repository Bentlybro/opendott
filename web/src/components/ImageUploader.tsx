import { useCallback, useState } from 'react';
import { Upload, Image as ImageIcon, X, Check, Loader2, RefreshCw, Sparkles } from 'lucide-react';
import { cn } from '../lib/utils';
import { validateImage, processImageForDevice, formatFileSize, type ImageInfo } from '../lib/image';
import { optimizeGifAggressive } from '../lib/gifOptimizer';

interface ImageUploaderProps {
  isConnected: boolean;
  isUploading: boolean;
  progress: number;
  onUpload: (data: Uint8Array) => Promise<boolean>;
}

interface ProcessedImage {
  originalInfo: ImageInfo;
  convertedData: Uint8Array;
  convertedDataUrl: string;
  convertedSize: number;
  wasConverted: boolean;
  frameCount?: number;
}

export function ImageUploader({ isConnected, isUploading, progress, onUpload }: ImageUploaderProps) {
  const [dragActive, setDragActive] = useState(false);
  const [processedImage, setProcessedImage] = useState<ProcessedImage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState(false);
  const [processingStatus, setProcessingStatus] = useState<string | null>(null);
  const [isOptimizing, setIsOptimizing] = useState(false);

  // Limits
  const HARD_LIMIT_KB = 500;  // Block files over this
  const WARN_LIMIT_KB = 50;   // Warn about files over this

  const handleFile = useCallback(async (file: File) => {
    setError(null);
    setUploadSuccess(false);
    setProcessedImage(null);
    
    // Hard file size limit
    if (file.size > HARD_LIMIT_KB * 1024) {
      setError(`File too large (${Math.round(file.size / 1024)}KB). Maximum is ${HARD_LIMIT_KB}KB. Try a shorter or simpler GIF.`);
      return;
    }
    
    try {
      // First validate and get original info
      setProcessingStatus('Analyzing...');
      const originalInfo = await validateImage(file);
      
      // GIFs: send raw (no conversion - this is what works!)
      // PNG/JPEG: convert to GIF
      const isGif = originalInfo.type === 'gif';
      const needsConversion = !isGif;  // Only non-GIFs need conversion
      
      // Process the image (GIFs pass through raw, others convert)
      if (needsConversion) {
        setProcessingStatus('Converting to GIF...');
      } else {
        setProcessingStatus('Preparing...');
      }
      const convertedData = await processImageForDevice(
        file,
        true,
        (stage, prog) => {
          setProcessingStatus(`${stage}... ${Math.round(prog)}%`);
        }
      );
      
      // Create a blob URL for the converted data
      const blob = new Blob([convertedData as BlobPart], { type: 'image/gif' });
      const convertedDataUrl = URL.createObjectURL(blob);
      
      // Count frames in converted GIF
      let frameCount = 1;
      let pos = 13;
      if (convertedData[10] & 0x80) {
        pos += 3 * (2 ** ((convertedData[10] & 0x07) + 1));
      }
      while (pos < convertedData.length - 1) {
        if (convertedData[pos] === 0x2C) {
          frameCount++;
          pos += 10;
          if (convertedData[pos - 1] & 0x80) {
            pos += 3 * (2 ** ((convertedData[pos - 1] & 0x07) + 1));
          }
          pos += 1;
          while (pos < convertedData.length && convertedData[pos] !== 0) {
            pos += convertedData[pos] + 1;
          }
          pos += 1;
        } else if (convertedData[pos] === 0x3B) {
          break;
        } else if (convertedData[pos] === 0x21) {
          pos += 2;
          while (pos < convertedData.length && convertedData[pos] !== 0) {
            pos += convertedData[pos] + 1;
          }
          pos += 1;
        } else {
          pos += 1;
        }
      }
      frameCount = Math.max(1, frameCount - 1); // Fix off-by-one
      
      setProcessedImage({
        originalInfo,
        convertedData,
        convertedDataUrl,
        convertedSize: convertedData.length,
        wasConverted: needsConversion,
        frameCount,
      });
      setProcessingStatus(null);
    } catch (err) {
      setError((err as Error).message);
      setProcessedImage(null);
      setProcessingStatus(null);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const handleUpload = useCallback(async () => {
    if (!processedImage || !isConnected) return;
    
    setUploadSuccess(false);
    
    try {
      // Use pre-converted data
      const success = await onUpload(processedImage.convertedData);
      setUploadSuccess(success);
      if (!success) {
        setError('Upload failed. Please try again.');
      }
    } catch (err) {
      setError((err as Error).message);
    }
  }, [processedImage, isConnected, onUpload]);

  const clearImage = useCallback(() => {
    if (processedImage?.originalInfo.dataUrl) {
      URL.revokeObjectURL(processedImage.originalInfo.dataUrl);
    }
    if (processedImage?.convertedDataUrl) {
      URL.revokeObjectURL(processedImage.convertedDataUrl);
    }
    setProcessedImage(null);
    setError(null);
    setUploadSuccess(false);
  }, [processedImage]);

  const handleOptimize = useCallback(async () => {
    if (!processedImage) return;
    
    setIsOptimizing(true);
    setError(null);
    
    try {
      const result = await optimizeGifAggressive(processedImage.convertedData);
      
      if (!result.success || !result.data) {
        setError(result.error || 'Optimization failed');
        return;
      }
      
      // Update with optimized data
      const blob = new Blob([result.data as BlobPart], { type: 'image/gif' });
      const newUrl = URL.createObjectURL(blob);
      
      // Revoke old URL
      if (processedImage.convertedDataUrl) {
        URL.revokeObjectURL(processedImage.convertedDataUrl);
      }
      
      // Count frames in optimized GIF
      let frameCount = 0;
      let pos = 13;
      if (result.data[10] & 0x80) {
        pos += 3 * (2 ** ((result.data[10] & 0x07) + 1));
      }
      while (pos < result.data.length - 1) {
        if (result.data[pos] === 0x2C) {
          frameCount++;
          pos += 10;
          if (result.data[pos - 1] & 0x80) {
            pos += 3 * (2 ** ((result.data[pos - 1] & 0x07) + 1));
          }
          pos += 1;
          while (pos < result.data.length && result.data[pos] !== 0) {
            pos += result.data[pos] + 1;
          }
          pos += 1;
        } else if (result.data[pos] === 0x3B) {
          break;
        } else if (result.data[pos] === 0x21) {
          pos += 2;
          while (pos < result.data.length && result.data[pos] !== 0) {
            pos += result.data[pos] + 1;
          }
          pos += 1;
        } else {
          pos += 1;
        }
      }
      
      setProcessedImage({
        ...processedImage,
        convertedData: result.data,
        convertedDataUrl: newUrl,
        convertedSize: result.optimizedSize,
        wasConverted: true,  // Mark as converted since we optimized
        frameCount: Math.max(1, frameCount),
      });
      
    } catch (err) {
      setError(`Optimization failed: ${(err as Error).message}`);
    } finally {
      setIsOptimizing(false);
    }
  }, [processedImage]);

  return (
    <div className="space-y-4">
      {/* Drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
        onDragLeave={() => setDragActive(false)}
        onDrop={handleDrop}
        className={cn(
          "relative border-2 border-dashed rounded-xl p-8 text-center transition-colors",
          dragActive ? "border-blue-500 bg-blue-500/10" : "border-zinc-700 hover:border-zinc-600",
          processingStatus && "opacity-50 pointer-events-none"
        )}
      >
        <input
          type="file"
          accept="image/gif,image/png,image/jpeg"
          onChange={handleChange}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          disabled={isUploading || !!processingStatus}
        />
        
        {processingStatus ? (
          <>
            <RefreshCw className="w-12 h-12 mx-auto mb-4 text-blue-500 animate-spin" />
            <div className="text-lg font-medium text-white mb-2">
              {processingStatus}
            </div>
          </>
        ) : (
          <>
            <Upload className="w-12 h-12 mx-auto mb-4 text-zinc-500" />
            <div className="text-lg font-medium text-white mb-2">
              Drop your image here
            </div>
            <div className="text-sm text-zinc-400">
              or click to browse • GIF, PNG, JPEG
            </div>
          </>
        )}
      </div>

      {/* Error message */}
      {error && (
        <div className="p-4 rounded-lg bg-red-500/20 border border-red-500/50 text-red-400">
          {error}
        </div>
      )}

      {/* Image preview - shows CONVERTED image */}
      {processedImage && (
        <div className="p-4 rounded-xl bg-zinc-900 border border-zinc-800">
          <div className="flex gap-4">
            {/* Round preview (like the device) - shows converted image */}
            <div className="relative">
              <div className="w-32 h-32 rounded-full overflow-hidden bg-black border-4 border-zinc-700">
                <img
                  src={processedImage.convertedDataUrl}
                  alt="Preview (converted)"
                  className="w-full h-full object-cover"
                />
              </div>
              <button
                onClick={clearImage}
                className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-zinc-800 text-zinc-400 hover:text-white flex items-center justify-center"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            
            {/* Image info */}
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-2">
                <ImageIcon className="w-5 h-5 text-zinc-400" />
                <span className="font-medium text-white truncate max-w-[200px]">
                  {processedImage.originalInfo.file.name}
                </span>
              </div>
              
              <div className="text-sm text-zinc-400 space-y-1">
                {/* Show conversion info */}
                {processedImage.wasConverted ? (
                  <div className="text-green-400">
                    {processedImage.originalInfo.width}×{processedImage.originalInfo.height} → 240×240
                  </div>
                ) : (
                  <div>240 × 240 px</div>
                )}
                <div>
                  {processedImage.wasConverted && (
                    <span className="text-zinc-500 line-through mr-2">
                      {formatFileSize(processedImage.originalInfo.file.size)}
                    </span>
                  )}
                  {formatFileSize(processedImage.convertedSize)}
                </div>
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded text-xs font-medium uppercase bg-purple-500/20 text-purple-400">
                    GIF
                  </span>
                  {(processedImage.frameCount ?? 0) > 1 && (
                    <span className="px-2 py-0.5 rounded text-xs font-medium bg-green-500/20 text-green-400">
                      {processedImage.frameCount} frames
                    </span>
                  )}
                  {processedImage.wasConverted && (
                    <span className="px-2 py-0.5 rounded text-xs font-medium bg-blue-500/20 text-blue-400">
                      Converted
                    </span>
                  )}
                </div>
              </div>
              
              {/* Upload button */}
              <button
                onClick={handleUpload}
                disabled={!isConnected || isUploading}
                className={cn(
                  "mt-4 px-6 py-2 rounded-lg font-medium transition-colors flex items-center gap-2",
                  uploadSuccess 
                    ? "bg-green-500 text-white"
                    : "bg-blue-500 text-white hover:bg-blue-600",
                  (!isConnected || isUploading) && "opacity-50 cursor-not-allowed"
                )}
              >
                {isUploading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Uploading... {Math.round(progress)}%
                  </>
                ) : uploadSuccess ? (
                  <>
                    <Check className="w-4 h-4" />
                    Uploaded!
                  </>
                ) : (
                  <>
                    <Upload className="w-4 h-4" />
                    Upload to Device
                  </>
                )}
              </button>
            </div>
          </div>
          
          {/* Status message */}
          {processedImage.wasConverted ? (
            <div className="mt-4 p-3 rounded-lg bg-purple-500/20 border border-purple-500/50 text-purple-400 text-sm">
              <strong>Optimized!</strong> {formatFileSize(processedImage.convertedSize)}, {processedImage.frameCount} frame{(processedImage.frameCount ?? 0) !== 1 ? 's' : ''}.
            </div>
          ) : (
            <div className="mt-4 p-3 rounded-lg bg-green-500/20 border border-green-500/50 text-green-400 text-sm">
              <strong>Ready!</strong> GIF will be sent as-is ({formatFileSize(processedImage.convertedSize)}, {processedImage.frameCount} frame{(processedImage.frameCount ?? 0) !== 1 ? 's' : ''}).
            </div>
          )}
          
          {/* Size warning with optimization */}
          {processedImage.convertedSize > WARN_LIMIT_KB * 1024 && (
            <div className="mt-4 p-3 rounded-lg bg-yellow-500/20 border border-yellow-500/50 text-yellow-400 text-sm">
              <strong>Warning:</strong> File is {Math.round(processedImage.convertedSize / 1024)}KB. 
              GIFs over ~{WARN_LIMIT_KB}KB may not loop properly on DOTT.
              
              <div className="mt-3">
                <button
                  onClick={handleOptimize}
                  disabled={isOptimizing}
                  className={cn(
                    "px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2",
                    "bg-purple-500 text-white hover:bg-purple-600 transition-colors",
                    isOptimizing && "opacity-50 cursor-not-allowed"
                  )}
                >
                  {isOptimizing ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Optimizing...
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4" />
                      Optimize Now
                    </>
                  )}
                </button>
              </div>
            </div>
          )}
          
          {/* Progress bar */}
          {isUploading && (
            <div className="mt-4 h-2 bg-zinc-800 rounded-full overflow-hidden">
              <div 
                className="h-full bg-blue-500 transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
