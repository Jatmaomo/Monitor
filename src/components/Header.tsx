import React from 'react';
import { ShieldCheck, LogOut, RefreshCw, User as UserIcon } from 'lucide-react';
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
    <header id="main-header" className="w-full bg-neutral-900 border-b border-neutral-800 sticky top-0 z-30 shadow-md">
      <div className="max-w-xl mx-auto px-4 py-3 flex items-center justify-between">
        <div
          className="flex items-center gap-2.5 cursor-pointer select-none"
          onClick={() => onSelectRole(null)}
          title="Back to Mode Selection"
        >
          <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-sm sm:text-base font-bold text-neutral-100 leading-tight tracking-tight">
              Monitor Your Home Yourself
            </h1>
            <p className="text-[11px] text-neutral-400">
              By Jat Maomo Tech
            </p>
          </div>
        </div>

        {user && (
          <div className="flex items-center gap-2">
            {/* User display badge */}
            <div className="hidden xs:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-neutral-950 border border-neutral-800 text-xs text-neutral-300">
              <UserIcon className="w-3 h-3 text-emerald-400" />
              <span className="max-w-[100px] truncate">{user.fullName || user.email?.split('@')[0]}</span>
            </div>

            {currentRole && (
              <button
                id="btn-switch-mode"
                type="button"
                onClick={() => onSelectRole(null)}
                className="px-2.5 py-1.5 rounded-lg text-xs font-medium text-neutral-300 bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 transition flex items-center gap-1.5 cursor-pointer"
                title="Change Mode"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Change Mode</span>
              </button>
            )}

            <button
              id="btn-sign-out"
              type="button"
              onClick={onSignOut}
              className="p-2 rounded-lg text-neutral-400 hover:text-red-400 hover:bg-neutral-800 transition cursor-pointer"
              title="Sign Out / Switch Account"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </header>
  );
};
