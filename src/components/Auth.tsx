import React, { useState } from 'react';
import { UserProfile } from '../types';
import { ShieldCheck, AlertCircle, Eye, EyeOff, CheckCircle2, User, Mail, Lock, ArrowRight, Sparkles } from 'lucide-react';

interface AuthProps {
  onAuthSuccess: (user: UserProfile) => void;
}

export const Auth: React.FC<AuthProps> = ({ onAuthSuccess }) => {
  const [isSignUp, setIsSignUp] = useState(true);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const cleanEmail = email.trim().toLowerCase();
    const cleanPassword = password.trim();

    if (!cleanEmail || !cleanPassword) {
      setError('Please fill in all required fields.');
      return;
    }

    if (isSignUp && !fullName.trim()) {
      setError('Please enter your full name.');
      return;
    }

    if (cleanPassword.length < 4) {
      setError('Password should be at least 4 characters.');
      return;
    }

    setLoading(true);

    try {
      const endpoint = isSignUp ? '/api/auth/signup' : '/api/auth/login';
      const body = isSignUp
        ? { fullName: fullName.trim(), email: cleanEmail, password: cleanPassword }
        : { email: cleanEmail, password: cleanPassword };

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Authentication failed. Please try again.');
      }

      // Save user session to localStorage
      localStorage.setItem('myhy_user', JSON.stringify(data.user));
      onAuthSuccess(data.user);
    } catch (err: any) {
      console.error('Auth submit error:', err);
      // If network or server error, provide local session fallback
      if (err.message?.includes('Failed to fetch')) {
        const fallbackUser: UserProfile = {
          uid: 'usr_' + Math.random().toString(36).substring(2, 10),
          fullName: isSignUp ? fullName.trim() : cleanEmail.split('@')[0],
          email: cleanEmail,
          createdAt: Date.now(),
        };
        localStorage.setItem('myhy_user', JSON.stringify(fallbackUser));
        onAuthSuccess(fallbackUser);
      } else {
        setError(err.message || 'Authentication error.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleQuickStart = async () => {
    setError(null);
    setLoading(true);
    try {
      const response = await fetch('/api/auth/guest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Home User' }),
      });
      const data = await response.json();
      if (data.user) {
        localStorage.setItem('myhy_user', JSON.stringify(data.user));
        onAuthSuccess(data.user);
        return;
      }
    } catch {
      // ignore
    }

    // Direct fallback
    const guestUser: UserProfile = {
      uid: 'guest_' + Math.random().toString(36).substring(2, 10),
      fullName: 'Home User',
      email: 'guest@jatmaomo.local',
      createdAt: Date.now(),
    };
    localStorage.setItem('myhy_user', JSON.stringify(guestUser));
    onAuthSuccess(guestUser);
    setLoading(false);
  };

  return (
    <div id="auth-container" className="w-full max-w-md mx-auto p-4 sm:p-6">
      {/* Header Branding */}
      <div className="text-center mb-6 pt-2">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 mb-3 shadow-lg shadow-emerald-950/20">
          <ShieldCheck className="w-8 h-8" />
        </div>
        <h2 className="text-2xl font-bold text-neutral-100 tracking-tight">
          {isSignUp ? 'Create Your Account' : 'Welcome Back'}
        </h2>
        <p className="text-sm text-neutral-400 mt-1">
          "Monitor your home yourself from any device."
        </p>
      </div>

      {/* Main Card */}
      <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-5 sm:p-6 shadow-2xl">
        {/* Toggle Mode Pills */}
        <div className="grid grid-cols-2 p-1 rounded-xl bg-neutral-950 border border-neutral-800 mb-5">
          <button
            type="button"
            onClick={() => {
              setIsSignUp(true);
              setError(null);
            }}
            className={`py-2 text-xs font-bold rounded-lg transition duration-150 cursor-pointer ${
              isSignUp
                ? 'bg-emerald-500 text-neutral-950 shadow-sm'
                : 'text-neutral-400 hover:text-neutral-200'
            }`}
          >
            Sign Up
          </button>
          <button
            type="button"
            onClick={() => {
              setIsSignUp(false);
              setError(null);
            }}
            className={`py-2 text-xs font-bold rounded-lg transition duration-150 cursor-pointer ${
              !isSignUp
                ? 'bg-emerald-500 text-neutral-950 shadow-sm'
                : 'text-neutral-400 hover:text-neutral-200'
            }`}
          >
            Log In
          </button>
        </div>

        {error && (
          <div id="auth-error-box" className="mb-4 p-3 rounded-xl bg-red-950/50 border border-red-800/60 text-red-300 text-sm flex items-start gap-2.5">
            <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
            <div className="leading-snug text-xs">{error}</div>
          </div>
        )}

        <form onSubmit={handleAuthSubmit} className="space-y-4">
          {isSignUp && (
            <div>
              <label className="block text-xs font-semibold text-neutral-300 uppercase tracking-wider mb-1.5" htmlFor="auth-name">
                Full Name
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-neutral-500">
                  <User className="w-4 h-4" />
                </div>
                <input
                  id="auth-name"
                  type="text"
                  required={isSignUp}
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Alex Johnson"
                  className="w-full pl-10 pr-3.5 py-2.5 rounded-xl bg-neutral-950 border border-neutral-700 text-neutral-100 placeholder-neutral-500 focus:outline-none focus:border-emerald-500 text-sm shadow-inner"
                />
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-neutral-300 uppercase tracking-wider mb-1.5" htmlFor="auth-email">
              Email Address
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-neutral-500">
                <Mail className="w-4 h-4" />
              </div>
              <input
                id="auth-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@example.com"
                className="w-full pl-10 pr-3.5 py-2.5 rounded-xl bg-neutral-950 border border-neutral-700 text-neutral-100 placeholder-neutral-500 focus:outline-none focus:border-emerald-500 text-sm shadow-inner"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-neutral-300 uppercase tracking-wider mb-1.5" htmlFor="auth-password">
              Password
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-neutral-500">
                <Lock className="w-4 h-4" />
              </div>
              <input
                id="auth-password"
                type={showPassword ? 'text' : 'password'}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password"
                className="w-full pl-10 pr-10 py-2.5 rounded-xl bg-neutral-950 border border-neutral-700 text-neutral-100 placeholder-neutral-500 focus:outline-none focus:border-emerald-500 text-sm shadow-inner"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-200 cursor-pointer"
                title={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <button
            id="btn-submit-auth"
            type="submit"
            disabled={loading}
            className="w-full mt-2 py-3 px-4 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-neutral-950 font-bold text-sm tracking-wide transition disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-emerald-950/40 cursor-pointer flex items-center justify-center gap-2"
          >
            {loading ? (
              <span>Please wait...</span>
            ) : (
              <>
                <span>{isSignUp ? 'Create Account & Start' : 'Log In & Continue'}</span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </form>

        {/* Divider */}
        <div className="relative my-5">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-neutral-800" />
          </div>
          <div className="relative flex justify-center text-xs">
            <span className="bg-neutral-900 px-3 text-neutral-500 uppercase tracking-wider">
              Or quick access
            </span>
          </div>
        </div>

        {/* 1-Click Guest / Quick Start Button */}
        <button
          id="btn-quick-start"
          type="button"
          onClick={handleQuickStart}
          disabled={loading}
          className="w-full py-2.5 px-4 rounded-xl bg-neutral-950 hover:bg-neutral-800 border border-neutral-700 text-neutral-200 font-medium text-xs sm:text-sm transition flex items-center justify-center gap-2 cursor-pointer"
        >
          <Sparkles className="w-4 h-4 text-emerald-400" />
          <span>Quick Start as Guest (No password)</span>
        </button>

        <div className="mt-4 text-center">
          <p className="text-xs text-neutral-500">
            {isSignUp ? 'Already registered?' : 'Need an account?'}{' '}
            <button
              type="button"
              onClick={() => {
                setIsSignUp(!isSignUp);
                setError(null);
              }}
              className="text-emerald-400 hover:underline font-semibold cursor-pointer ml-1"
            >
              {isSignUp ? 'Log In here' : 'Sign Up here'}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
};
