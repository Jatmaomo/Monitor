import React from 'react';
import { ShieldCheck, LogOut, RefreshCw } from 'lucide-react';
import { UserProfile, AppRole } from '../types';

interface HeaderProps {
  user: UserProfile | null;
  currentRole: AppRole;
  onSelectRole: (role: AppRole) => void;
  onSignOut: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  user,
  currentRole,
  onSelectRole,
  onSignOut,
}) => {
  return (
    <header id="main-header" className="w-full bg-neutral-900 border-b border-neutral-800 sticky top-0 z-30">
      <div className="max-w-xl mx-auto px-4 py-3.5 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-base font-bold text-neutral-100 leading-tight tracking-tight">
              Monitor Your Home Yourself
            </h1>
            <p className="text-xs text-neutral-400">
              By Jat Maomo Tech
            </p>
          </div>
        </div>

        {user && (
          <div className="flex items-center gap-2">
            {currentRole && (
              <button
                id="btn-switch-mode"
                onClick={() => onSelectRole(null)}
                className="px-2.5 py-1.5 rounded-md text-xs font-medium text-neutral-300 bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 transition flex items-center gap-1.5"
                title="Change Mode"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Change Mode</span>
              </button>
            )}
            <button
              id="btn-sign-out"
              onClick={onSignOut}
              className="p-2 rounded-md text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800 transition"
              title="Sign Out"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </header>
  );
};
