import React from 'react';
import { ShieldCheck, LogOut, RefreshCw, User as UserIcon, Radio } from 'lucide-react';
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
    <header id="main-header" className="w-full bg-neutral-900/95 backdrop-blur-md border-b border-neutral-800 sticky top-0 z-30 shadow-lg">
      <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
        {/* Brand */}
        <div
          className="flex items-center gap-2.5 cursor-pointer select-none group"
          onClick={() => onSelectRole(null)}
          title="Back to Mode Selection"
        >
          <div className="w-9 h-9 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 group-hover:scale-105 transition shadow-inner">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-sm sm:text-base font-bold text-neutral-100 leading-tight tracking-tight group-hover:text-emerald-400 transition">
                Monitor Your Home Yourself
              </h1>
              <span className="hidden sm:inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-950 border border-emerald-800 text-[10px] font-mono font-bold text-emerald-300">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                SYSTEM ONLINE
              </span>
            </div>
            <p className="text-[11px] text-neutral-400">
              By Jat Maomo Tech
            </p>
          </div>
        </div>

        {/* User profile & quick role switcher */}
        {user && (
          <div className="flex items-center gap-2">
            {/* User display badge */}
            <div className="hidden sm:flex items-center gap-1.5 px-3 py-1 rounded-xl bg-neutral-950 border border-neutral-800 text-xs text-neutral-300 font-mono">
              <UserIcon className="w-3.5 h-3.5 text-emerald-400" />
              <span className="max-w-[120px] truncate">{user.fullName || user.email?.split('@')[0]}</span>
            </div>

            {currentRole && (
              <button
                id="btn-switch-mode"
                type="button"
                onClick={() => onSelectRole(null)}
                className="px-2.5 py-1.5 rounded-xl text-xs font-semibold text-neutral-200 bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 transition flex items-center gap-1.5 cursor-pointer shadow-sm"
                title="Change Mode"
              >
                <RefreshCw className="w-3.5 h-3.5 text-blue-400" />
                <span className="hidden xs:inline">Change Mode</span>
              </button>
            )}

            <button
              id="btn-sign-out"
              type="button"
              onClick={onSignOut}
              className="p-2 rounded-xl text-neutral-400 hover:text-red-400 hover:bg-neutral-800 border border-transparent hover:border-neutral-700 transition cursor-pointer"
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
