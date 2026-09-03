import React from 'react';
import { Camera, Eye, ArrowRight, Shield } from 'lucide-react';
import { UserProfile } from '../types';

interface RoleSelectorProps {
  user: UserProfile;
  onSelectRole: (role: 'camera' | 'monitor') => void;
}

export const RoleSelector: React.FC<RoleSelectorProps> = ({ user, onSelectRole }) => {
  return (
    <div className="max-w-xl mx-auto px-4 py-8 sm:py-12">
      <div className="text-center mb-8">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-medium mb-3">
          <Shield className="w-3.5 h-3.5" />
          <span>Monitor Your Home Yourself &bull; Jat Maomo Tech</span>
        </div>
        <h2 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">
          Welcome, {user.fullName || 'Friend'}
        </h2>
        <p className="text-sm text-neutral-400 mt-1 max-w-sm mx-auto">
          Choose what you want this phone to do right now.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Choice 1: USE AS CAMERA */}
        <button
          type="button"
          onClick={() => onSelectRole('camera')}
          className="group relative p-6 rounded-2xl bg-neutral-900 hover:bg-neutral-850 border border-neutral-800 hover:border-emerald-500/50 text-left transition duration-200 flex flex-col justify-between cursor-pointer shadow-lg hover:shadow-emerald-500/5"
        >
          <div>
            <div className="w-12 h-12 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center mb-4 group-hover:scale-105 transition">
              <Camera className="w-6 h-6" />
            </div>
            <h3 className="text-lg font-bold text-white tracking-tight mb-1 flex items-center gap-2">
              <span>USE AS CAMERA</span>
            </h3>
            <p className="text-xs text-neutral-300 leading-relaxed">
              Use this phone as your home camera. Place it in the room you want to monitor.
            </p>
          </div>

          <div className="mt-6 pt-4 border-t border-neutral-800/80 flex items-center justify-between text-xs font-semibold text-emerald-400 group-hover:text-emerald-300">
            <span>Start Camera Phone</span>
            <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition" />
          </div>
        </button>

        {/* Choice 2: WATCH CAMERA */}
        <button
          type="button"
          onClick={() => onSelectRole('monitor')}
          className="group relative p-6 rounded-2xl bg-neutral-900 hover:bg-neutral-850 border border-neutral-800 hover:border-cyan-500/50 text-left transition duration-200 flex flex-col justify-between cursor-pointer shadow-lg hover:shadow-cyan-500/5"
        >
          <div>
            <div className="w-12 h-12 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 flex items-center justify-center mb-4 group-hover:scale-105 transition">
              <Eye className="w-6 h-6" />
            </div>
            <h3 className="text-lg font-bold text-white tracking-tight mb-1 flex items-center gap-2">
              <span>WATCH CAMERA</span>
            </h3>
            <p className="text-xs text-neutral-300 leading-relaxed">
              Use this phone to watch another camera. Watch the live camera stream from anywhere.
            </p>
          </div>

          <div className="mt-6 pt-4 border-t border-neutral-800/80 flex items-center justify-between text-xs font-semibold text-cyan-400 group-hover:text-cyan-300">
            <span>Open Monitor Mode</span>
            <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition" />
          </div>
        </button>
      </div>

      {/* Reassurance note */}
      <div className="mt-8 text-center text-xs text-neutral-500">
        You can switch between Camera and Monitor mode anytime using the same account.
      </div>
    </div>
  );
};
