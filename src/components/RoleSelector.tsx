import React from 'react';
import { Camera, Tv, Shield, Radio, Sparkles, ExternalLink, ArrowRight } from 'lucide-react';
import { AppRole, UserProfile } from '../types';

interface RoleSelectorProps {
  user: UserProfile;
  onSelectRole: (role: AppRole) => void;
}

export const RoleSelector: React.FC<RoleSelectorProps> = ({ user, onSelectRole }) => {
  return (
    <div id="role-selector" className="w-full max-w-xl mx-auto p-4 sm:p-6">
      {/* Station Title */}
      <div className="text-center mb-6">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-950/60 border border-emerald-800/60 text-xs font-mono font-bold text-emerald-400 mb-2">
          <Shield className="w-3.5 h-3.5" />
          <span>SECURITY COMMAND STATION</span>
        </div>
        <h2 className="text-2xl font-bold text-neutral-100 tracking-tight">
          Welcome, {user.fullName || 'User'}
        </h2>
        <p className="text-sm text-neutral-400 mt-1">
          Select device role for this smartphone or computer:
        </p>
      </div>

      {/* Role Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* CONTROLLER CARD */}
        <button
          id="btn-role-controller"
          type="button"
          onClick={() => onSelectRole('controller')}
          className="w-full text-left p-5 rounded-2xl bg-neutral-900 border border-neutral-800 hover:border-emerald-500/50 hover:bg-neutral-850 transition duration-150 group flex flex-col justify-between shadow-xl cursor-pointer relative overflow-hidden"
        >
          <div className="absolute top-0 right-0 p-3 opacity-10 group-hover:opacity-20 transition">
            <Camera className="w-24 h-24 text-emerald-400" />
          </div>

          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 group-hover:scale-105 transition">
                <Camera className="w-6 h-6" />
              </div>
              <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                CAMERA TRANSMITTER
              </span>
            </div>

            <h3 className="text-lg font-bold text-neutral-100 group-hover:text-emerald-400 transition">
              CONTROLLER MODE
            </h3>
            <p className="text-xs text-neutral-400 mt-1.5 leading-relaxed">
              Turns this device into a 1080P HD home security camera with real-time video broadcasting and PIN generation.
            </p>
          </div>

          <div className="mt-5 pt-3 border-t border-neutral-800 flex items-center justify-between text-xs font-bold text-emerald-400 group-hover:translate-x-1 transition duration-150">
            <span>Start Camera Broadcast</span>
            <ArrowRight className="w-4 h-4" />
          </div>
        </button>

        {/* MONITOR CARD */}
        <button
          id="btn-role-monitor"
          type="button"
          onClick={() => onSelectRole('monitor')}
          className="w-full text-left p-5 rounded-2xl bg-neutral-900 border border-neutral-800 hover:border-blue-500/50 hover:bg-neutral-850 transition duration-150 group flex flex-col justify-between shadow-xl cursor-pointer relative overflow-hidden"
        >
          <div className="absolute top-0 right-0 p-3 opacity-10 group-hover:opacity-20 transition">
            <Tv className="w-24 h-24 text-blue-400" />
          </div>

          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="p-3 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-400 group-hover:scale-105 transition">
                <Tv className="w-6 h-6" />
              </div>
              <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300 border border-blue-500/30">
                LIVE VIEWER
              </span>
            </div>

            <h3 className="text-lg font-bold text-neutral-100 group-hover:text-blue-400 transition">
              MONITOR MODE
            </h3>
            <p className="text-xs text-neutral-400 mt-1.5 leading-relaxed">
              Watch your camera live with Night Vision filters, 3x digital zoom, instant snapshot tools, and telemetry logs.
            </p>
          </div>

          <div className="mt-5 pt-3 border-t border-neutral-800 flex items-center justify-between text-xs font-bold text-blue-400 group-hover:translate-x-1 transition duration-150">
            <span>Open Monitor Console</span>
            <ArrowRight className="w-4 h-4" />
          </div>
        </button>
      </div>

      {/* Instructions card */}
      <div className="mt-6 p-4 rounded-2xl bg-neutral-900/80 border border-neutral-800 text-xs text-neutral-400 flex items-start gap-3 shadow-md">
        <Radio className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
        <div className="leading-relaxed">
          <strong className="text-neutral-200">How It Works:</strong> Leave one phone stationed in <strong>Controller Mode</strong> to broadcast your room, then open this app on your second phone or laptop in <strong>Monitor Mode</strong> and enter the 6-digit PIN.
        </div>
      </div>
    </div>
  );
};
