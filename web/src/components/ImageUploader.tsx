import { useCallback, useState } from 'react';
import { Upload, Image as ImageIcon, X, Check, Loader2, RefreshCw } from 'lucide-react';
import { cn } from '../lib/utils';
import { validateImage, processImageForDevice, formatFileSize, type ImageInfo } from '../lib/image';

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

  const handleFile = useCallback(async (file: File) => {
    setError(null);
    setUploadSuccess(false);
    setProcessedImage(null);
    
    try {
      // First validate and get original info
      setProcessingStatus('Analyzing...');
      const originalInfo = await validateImage(file);
      
      // Small GIFs (<50KB) work better raw - our conversion makes them bigger!
      const isSmallEnough = file.size <= 50 * 1024;
      const isGif = originalInfo.type === 'gif';
      const skipConversion = isSmallEnough && isGif;
      
      // Check if conversion would normally be needed
      const wouldNeedConversion = 
        originalInfo.width !== 240 || 
        originalInfo.height !== 240 || 
        !!originalInfo.frameWarning || 
        originalInfo.type !== 'gif';
      
      let convertedData: Uint8Array;
      
      if (skipConversion) {
        // Small GIF - send raw for best results
        setProcessingStatus('Small GIF - using original...');
        const buffer = await file.arrayBuffer();
        convertedData = new Uint8Array(buffer);
        console.log(`Small GIF (${(file.size/1024).toFixed(1)}KB) - using raw file`);
      } else {
        // Convert larger files
        setProcessingStatus('Converting...');
        convertedData = await processImageForDevice(
          file,
          true,
          (stage, prog) => {
            setProcessingStatus(`${stage}... ${Math.round(prog)}%`);
          }
        );
      }
      
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
        wasConverted: !skipConversion && wouldNeedConversion,
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
          
          {/* Status messages */}
          {processedImage.wasConverted ? (
            <div className="mt-4 p-3 rounded-lg bg-green-500/20 border border-green-500/50 text-green-400 text-sm">
              <strong>Ready to upload!</strong> Image converted to 240×240 with {processedImage.frameCount} full frame{(processedImage.frameCount ?? 0) !== 1 ? 's' : ''}.
              {processedImage.originalInfo.frameCount && processedImage.originalInfo.frameCount > (processedImage.frameCount ?? 0) && (
                <span className="text-green-300"> (reduced from {processedImage.originalInfo.frameCount} frames)</span>
              )}
            </div>
          ) : processedImage.originalInfo.type === 'gif' && processedImage.convertedSize <= 50 * 1024 ? (
            <div className="mt-4 p-3 rounded-lg bg-blue-500/20 border border-blue-500/50 text-blue-400 text-sm">
              <strong>Small GIF detected!</strong> Sending original file unchanged ({(processedImage.convertedSize / 1024).toFixed(1)}KB).
              Small GIFs work best without conversion.
            </div>
          ) : null}
          
          {/* Size warning */}
          {processedImage.convertedSize > 50 * 1024 && (
            <div className="mt-4 p-3 rounded-lg bg-yellow-500/20 border border-yellow-500/50 text-yellow-400 text-sm">
              <strong>Warning:</strong> File is {Math.round(processedImage.convertedSize / 1024)}KB. 
              DOTT only has 256KB RAM - GIFs over ~50KB may not loop properly. Try a simpler animation.
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
