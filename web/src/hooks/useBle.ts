import { useState, useEffect, useCallback } from 'react';
import { bleService, type ConnectionState } from '../lib/ble';

export interface UseBleReturn {
  state: ConnectionState;
  isConnected: boolean;
  isUploading: boolean;
  deviceName: string | undefined;
  progress: number;
  error: Error | null;
  connect: () => Promise<boolean>;
  disconnect: () => Promise<void>;
  uploadImage: (data: Uint8Array) => Promise<boolean>;
  clearError: () => void;
}

export function useBle(): UseBleReturn {
  const [state, setState] = useState<ConnectionState>('disconnected');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<Error | null>(null);
  const [deviceName, setDeviceName] = useState<string | undefined>();

  useEffect(() => {
    bleService.setCallbacks({
      onConnectionChange: (newState) => {
        setState(newState);
        if (newState === 'connected') {
          setDeviceName(bleService.deviceName);
        } else if (newState === 'disconnected') {
          setDeviceName(undefined);
          setProgress(0);
        }
      },
      onProgress: (progressPercent) => {
        setProgress(progressPercent);
      },
      onError: (err) => {
        setError(err);
      },
      onUploadComplete: (success) => {
        if (!success) {
          setError(new Error('Upload failed'));
        }
        setProgress(success ? 100 : 0);
      },
    });

    return () => {
      bleService.setCallbacks({});
    };
  }, []);

  const connect = useCallback(async () => {
    setError(null);
    return bleService.connect();
  }, []);

  const disconnect = useCallback(async () => {
    setError(null);
    return bleService.disconnect();
  }, []);

  const uploadImage = useCallback(async (data: Uint8Array) => {
    setError(null);
    setProgress(0);
    return bleService.uploadImage(data);
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return {
    state,
    isConnected: state === 'connected' || state === 'uploading',
    isUploading: state === 'uploading',
    deviceName,
    progress,
    error,
    connect,
    disconnect,
    uploadImage,
    clearError,
  };
}
