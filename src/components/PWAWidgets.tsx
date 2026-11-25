import React, { useState } from 'react';
import { Download, Smartphone, WifiOff, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { useOnlineStatus } from '../hooks/useOnlineStatus';

export const PWAInstallButton: React.FC = () => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled) return null;

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={() => void install()}
        className="ios-btn-secondary inline-flex items-center gap-2 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 whitespace-nowrap shrink-0"
      >
        <Download className="w-3.5 h-3.5" />
        Installer l'app
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowIOSGuide(true)}
          className="ios-btn-secondary inline-flex items-center gap-2 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 whitespace-nowrap shrink-0"
        >
          <Smartphone className="w-3.5 h-3.5" />
          Installer sur iOS
        </button>

        {showIOSGuide && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/45 backdrop-blur-md p-0 sm:p-4">
            <div className="ios-glass-modal w-full max-w-sm rounded-t-[28px] sm:rounded-[28px] p-6 space-y-4">
              <div className="w-10 h-1 rounded-full bg-slate-400/40 mx-auto sm:hidden" />
              <div className="flex items-center justify-between">
                <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  Installer sur iPhone / iPad
                </h3>
                <button
                  type="button"
                  onClick={() => setShowIOSGuide(false)}
                  aria-label="Fermer"
                  className="p-2 rounded-full text-slate-500 hover:bg-slate-900/5 dark:hover:bg-white/10 ios-press"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <ol className="text-sm text-slate-600 dark:text-slate-300 space-y-2 list-decimal list-inside">
                <li>Appuyez sur le bouton Partager dans la barre Safari.</li>
                <li>Faites défiler et touchez Sur l'écran d'accueil.</li>
              </ol>
              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="ios-btn-primary w-full py-2.5 text-sm"
              >
                Fermer
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
};

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();
  if (isOnline) return null;

  return (
    <div className="fixed bottom-20 md:bottom-4 left-4 z-50 flex items-center gap-2 rounded-[16px] border border-amber-400/40 bg-amber-50/85 dark:bg-amber-950/80 backdrop-blur-xl px-3.5 py-2 text-xs font-medium text-amber-900 dark:text-amber-200 shadow-lg">
      <WifiOff className="w-3.5 h-3.5 shrink-0" />
      <span>Mode hors ligne — Données locales actives</span>
    </div>
  );
};
