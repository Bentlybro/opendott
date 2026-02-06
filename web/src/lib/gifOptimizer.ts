/**
 * GIF Optimizer using gifsicle-wasm-browser
 * 
 * CRITICAL RULE: Output must ALWAYS be smaller than input.
 * If optimization makes the file bigger, we reject it.
 */

// @ts-ignore - no types for gifsicle-wasm-browser
import gifsicle from 'gifsicle-wasm-browser';

export interface OptimizeOptions {
  lossy?: number;      // 0-200, higher = more compression, more artifacts
  colors?: number;     // 2-256, fewer colors = smaller file
  scale?: number;      // 0.1-1.0, scale down dimensions
  reduceFrames?: number; // Keep every Nth frame (2 = half frames, 3 = third, etc.)
}

export interface OptimizeResult {
  success: boolean;
  data?: Uint8Array;
  originalSize: number;
  optimizedSize: number;
  savedBytes: number;
  savedPercent: number;
  error?: string;
}

/**
 * Optimize a GIF file.
 * Returns the optimized data ONLY if it's smaller than the original.
 */
export async function optimizeGif(
  input: Uint8Array,
  options: OptimizeOptions = {}
): Promise<OptimizeResult> {
  const originalSize = input.length;
  
  // Build gifsicle command arguments
  const args: string[] = [
    '-O3',  // Maximum optimization
  ];
  
  // Lossy compression (if specified)
  if (options.lossy !== undefined) {
    args.push(`--lossy=${Math.min(200, Math.max(0, options.lossy))}`);
  } else {
    // Default to mild lossy compression
    args.push('--lossy=80');
  }
  
  // Color reduction
  if (options.colors !== undefined) {
    args.push(`--colors=${Math.min(256, Math.max(2, options.colors))}`);
  }
  
  // Scale down
  if (options.scale !== undefined && options.scale < 1) {
    const scale = Math.max(0.1, Math.min(1, options.scale));
    args.push(`--scale=${scale}`);
  }
  
  // Frame reduction (keep every Nth frame)
  // This is tricky with gifsicle - we need to specify which frames to keep
  // For now, we'll skip this and just use the other optimizations
  
  try {
    // Convert Uint8Array to ArrayBuffer for the library
    const inputBuffer = input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength);
    
    // Run gifsicle - returns File[] 
    const result = await gifsicle.run({
      input: [{
        file: inputBuffer,
        name: 'input.gif',
      }],
      command: [`${args.join(' ')} input.gif -o /output/output.gif`],
    }) as File[];
    
    // Get output file
    const outputFile = result[0];
    if (!outputFile) {
      return {
        success: false,
        originalSize,
        optimizedSize: originalSize,
        savedBytes: 0,
        savedPercent: 0,
        error: 'Optimization produced no output',
      };
    }
    
    // Convert File back to Uint8Array
    const outputBuffer = await outputFile.arrayBuffer();
    const output = new Uint8Array(outputBuffer);
    
    const optimizedSize = output.length;
    const savedBytes = originalSize - optimizedSize;
    const savedPercent = Math.round((savedBytes / originalSize) * 100);
    
    // CRITICAL: Only return success if file is SMALLER
    if (optimizedSize >= originalSize) {
      return {
        success: false,
        originalSize,
        optimizedSize,
        savedBytes: 0,
        savedPercent: 0,
        error: `Optimization made file larger (${originalSize} → ${optimizedSize} bytes). Try a different GIF.`,
      };
    }
    
    return {
      success: true,
      data: output,
      originalSize,
      optimizedSize,
      savedBytes,
      savedPercent,
    };
  } catch (err) {
    return {
      success: false,
      originalSize,
      optimizedSize: originalSize,
      savedBytes: 0,
      savedPercent: 0,
      error: `Optimization failed: ${(err as Error).message}`,
    };
  }
}

/**
 * Try multiple optimization strategies and return the smallest result.
 * Guaranteed to return something smaller than input, or fail.
 */
export async function optimizeGifAggressive(input: Uint8Array): Promise<OptimizeResult> {
  const originalSize = input.length;
  
  // Try increasingly aggressive optimization strategies
  const strategies: OptimizeOptions[] = [
    { lossy: 80 },                           // Mild
    { lossy: 120, colors: 128 },             // Medium
    { lossy: 150, colors: 64 },              // Aggressive
    { lossy: 200, colors: 32 },              // Very aggressive
    { lossy: 200, colors: 32, scale: 0.8 },  // Nuclear option
  ];
  
  let bestResult: OptimizeResult | null = null;
  
  for (const strategy of strategies) {
    const result = await optimizeGif(input, strategy);
    
    if (result.success && result.data) {
      // Keep the smallest successful result
      if (!bestResult || result.optimizedSize < bestResult.optimizedSize!) {
        bestResult = result;
      }
      
      // If we got it under 50KB, that's good enough
      if (result.optimizedSize < 50 * 1024) {
        break;
      }
    }
  }
  
  if (bestResult && bestResult.success) {
    return bestResult;
  }
  
  return {
    success: false,
    originalSize,
    optimizedSize: originalSize,
    savedBytes: 0,
    savedPercent: 0,
    error: 'Could not optimize this GIF. Try a simpler animation or use ezgif.com',
  };
}
