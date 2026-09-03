import React, { useState, useEffect } from 'react';
import { Shield, LogOut, User as UserIcon, ExternalLink } from 'lucide-react';
import { UserProfile } from '../types';

interface HeaderProps {
  user: UserProfile | null;
  onLogout?: () => void;
  onGoHome?: () => void;
}

export const Header: React.FC<HeaderProps> = ({ user, onLogout, onGoHome }) => {
  const [isInIframe, setIsInIframe] = useState(false);

  useEffect(() => {
    try {
      setIsInIframe(window.self !== window.top);
    } catch {
      setIsInIframe(true);
    }
  }, []);

  const openInNewTab = () => {
    try {
      window.open(window.location.href, '_blank', 'noopener,noreferrer');
    } catch {
      // ignore
    }
  };

  return (
    <header className="w-full bg-neutral-900/90 backdrop-blur border-b border-neutral-800 sticky top-0 z-50">
      <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
        <button
          type="button"
          onClick={onGoHome}
          className="flex items-center gap-3 text-left focus:outline-none group cursor-pointer"
        >
          <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 group-hover:border-emerald-500/40 transition">
            <Shield className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-base font-semibold text-white tracking-tight leading-tight">
              Monitor Your Home Yourself
            </h1>
            <p className="text-xs text-neutral-400">
              By Jat Maomo Tech
            </p>
          </div>
        </button>

        <div className="flex items-center gap-2 sm:gap-3">
          {isInIframe && (
            <button
              type="button"
              onClick={openInNewTab}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 text-xs font-medium transition cursor-pointer"
              title="Open full camera in separate tab"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span className="hidden xs:inline">New Tab</span>
            </button>
          )}

          {user && (
            <div className="flex items-center gap-2 sm:gap-3">
              <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-neutral-800/80 border border-neutral-700/60 text-xs text-neutral-300">
                <UserIcon className="w-3.5 h-3.5 text-neutral-400" />
                <span className="font-medium truncate max-w-[140px]">{user.fullName || user.email}</span>
              </div>
              {onLogout && (
                <button
                  type="button"
                  onClick={onLogout}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 text-neutral-300 hover:text-white text-xs font-medium transition cursor-pointer"
                  title="Sign Out"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>Sign Out</span>
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
