import React from 'react';
import { Camera, Tv } from 'lucide-react';
import { AppRole, UserProfile } from '../types';

interface RoleSelectorProps {
  user: UserProfile;
  onSelectRole: (role: AppRole) => void;
}

export const RoleSelector: React.FC<RoleSelectorProps> = ({ user, onSelectRole }) => {
  return (
    <div id="role-selector" className="w-full max-w-md mx-auto p-4 sm:p-6">
      <div className="text-center mb-6">
        <h2 className="text-xl font-bold text-neutral-100 tracking-tight">
          Welcome, {user.fullName || 'User'}
        </h2>
        <p className="text-sm text-neutral-400 mt-1">
          Choose how you want to use this phone:
        </p>
      </div>

      <div className="space-y-4">
        {/* CONTROLLER CARD */}
        <button
          id="btn-role-controller"
          type="button"
          onClick={() => onSelectRole('controller')}
          className="w-full text-left p-5 rounded-2xl bg-neutral-900 border border-neutral-800 hover:border-emerald-500/50 hover:bg-neutral-850 transition duration-150 group flex items-start gap-4 shadow-lg cursor-pointer"
        >
          <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 group-hover:scale-105 transition">
            <Camera className="w-7 h-7" />
          </div>
          <div className="flex-1">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-neutral-100 group-hover:text-emerald-400 transition">
                CONTROLLER
              </h3>
              <span className="text-xs font-semibold px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300">
                Camera
              </span>
            </div>
            <p className="text-sm text-neutral-400 mt-1 leading-relaxed">
              Use this phone as the camera.
            </p>
          </div>
        </button>

        {/* MONITOR CARD */}
        <button
          id="btn-role-monitor"
          type="button"
          onClick={() => onSelectRole('monitor')}
          className="w-full text-left p-5 rounded-2xl bg-neutral-900 border border-neutral-800 hover:border-blue-500/50 hover:bg-neutral-850 transition duration-150 group flex items-start gap-4 shadow-lg cursor-pointer"
        >
          <div className="p-3.5 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-400 group-hover:scale-105 transition">
            <Tv className="w-7 h-7" />
          </div>
          <div className="flex-1">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-neutral-100 group-hover:text-blue-400 transition">
                MONITOR
              </h3>
              <span className="text-xs font-semibold px-2 py-0.5 rounded bg-blue-500/20 text-blue-300">
                Viewer
              </span>
            </div>
            <p className="text-sm text-neutral-400 mt-1 leading-relaxed">
              Use this phone to watch the camera.
            </p>
          </div>
        </button>
      </div>

      <div className="mt-8 p-4 rounded-xl bg-neutral-900/60 border border-neutral-800 text-center">
        <p className="text-xs text-neutral-400 leading-normal">
          Tip: Set up one device as the <strong>Controller</strong> at home, then use a second device as the <strong>Monitor</strong> from anywhere.
        </p>
      </div>
    </div>
  );
};
