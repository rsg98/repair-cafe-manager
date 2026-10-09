import React from 'react';
import { WifiOff } from 'lucide-react';
import { useNetworkStatus } from '../../hooks/useNetworkStatus';

export const OfflineNotice: React.FC = () => {
  const { isOnline } = useNetworkStatus();

  if (isOnline) return null;

  return (
    <div className="bg-amber-600 text-white px-4 py-2 text-center text-xs sm:text-sm font-medium flex items-center justify-center gap-2 shadow-inner">
      <WifiOff className="h-4 w-4 animate-pulse" />
      <span>
        <strong>Offline Mode:</strong> Internet connection lost. All updates are safely stored on this tablet and will sync automatically when Wi-Fi reconnects.
      </span>
    </div>
  );
};
