import { useCallback, useState } from 'react';
import { Upload, Image as ImageIcon, X, Check, Loader2 } from 'lucide-react';
import { cn } from '../lib/utils';
import { validateImage, processImageForDevice, formatFileSize, type ImageInfo } from '../lib/image';

interface ImageUploaderProps {
  isConnected: boolean;
  isUploading: boolean;
  progress: number;
  onUpload: (data: Uint8Array) => Promise<boolean>;
}

export function ImageUploader({ isConnected, isUploading, progress, onUpload }: ImageUploaderProps) {
  const [dragActive, setDragActive] = useState(false);
  const [imageInfo, setImageInfo] = useState<ImageInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState(false);

  const handleFile = useCallback(async (file: File) => {
    setError(null);
    setUploadSuccess(false);
    
    try {
      const info = await validateImage(file);
      setImageInfo(info);
    } catch (err) {
      setError((err as Error).message);
      setImageInfo(null);
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
    if (!imageInfo || !isConnected) return;
    
    setUploadSuccess(false);
    try {
      const data = await processImageForDevice(imageInfo.file);
      const success = await onUpload(data);
      setUploadSuccess(success);
      if (!success) {
        setError('Upload failed. Please try again.');
      }
    } catch (err) {
      setError((err as Error).message);
    }
  }, [imageInfo, isConnected, onUpload]);

  const clearImage = useCallback(() => {
    if (imageInfo?.dataUrl) {
      URL.revokeObjectURL(imageInfo.dataUrl);
    }
    setImageInfo(null);
    setError(null);
    setUploadSuccess(false);
  }, [imageInfo]);

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
          !isConnected && "opacity-50 pointer-events-none"
        )}
      >
        <input
          type="file"
          accept="image/gif,image/png,image/jpeg"
          onChange={handleChange}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          disabled={!isConnected || isUploading}
        />
        
        <Upload className="w-12 h-12 mx-auto mb-4 text-zinc-500" />
        <div className="text-lg font-medium text-white mb-2">
          Drop your image here
        </div>
        <div className="text-sm text-zinc-400">
          or click to browse • GIF, PNG, JPEG
        </div>
      </div>

      {/* Error message */}
      {error && (
        <div className="p-4 rounded-lg bg-red-500/20 border border-red-500/50 text-red-400">
          {error}
        </div>
      )}

      {/* Image preview */}
      {imageInfo && (
        <div className="p-4 rounded-xl bg-zinc-900 border border-zinc-800">
          <div className="flex gap-4">
            {/* Round preview (like the device) */}
            <div className="relative">
              <div className="w-32 h-32 rounded-full overflow-hidden bg-black border-4 border-zinc-700">
                <img
                  src={imageInfo.dataUrl}
                  alt="Preview"
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
                  {imageInfo.file.name}
                </span>
              </div>
              
              <div className="text-sm text-zinc-400 space-y-1">
                <div>{imageInfo.width} × {imageInfo.height} px</div>
                <div>{formatFileSize(imageInfo.file.size)}</div>
                <div className="flex items-center gap-2">
                  <span className={cn(
                    "px-2 py-0.5 rounded text-xs font-medium uppercase",
                    imageInfo.type === 'gif' ? "bg-purple-500/20 text-purple-400" :
                    imageInfo.type === 'png' ? "bg-blue-500/20 text-blue-400" :
                    "bg-yellow-500/20 text-yellow-400"
                  )}>
                    {imageInfo.type}
                  </span>
                  {imageInfo.isAnimated && (
                    <span className="px-2 py-0.5 rounded text-xs font-medium bg-green-500/20 text-green-400">
                      Animated
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
