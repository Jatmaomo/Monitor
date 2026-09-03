import React, { useState } from 'react';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  updateProfile,
} from 'firebase/auth';
import { doc, setDoc, getDoc } from 'firebase/firestore';
import { auth, googleProvider, db } from '../firebase';
import { UserProfile } from '../types';
import { Shield, Mail, Lock, User, ArrowRight, Video, Eye } from 'lucide-react';

interface AuthProps {
  onSuccess: (user: UserProfile) => void;
}

export const Auth: React.FC<AuthProps> = ({ onSuccess }) => {
  const [view, setView] = useState<'welcome' | 'signup' | 'login'>('welcome');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const saveUserProfile = async (uid: string, name: string, userEmail: string): Promise<UserProfile> => {
    const profile: UserProfile = {
      uid,
      fullName: name || 'Home Owner',
      email: userEmail || '',
      createdAt: Date.now(),
    };
    try {
      await setDoc(doc(db, 'users', uid), profile, { merge: true });
    } catch {
      // ignore
    }
    localStorage.setItem('myhy_user', JSON.stringify(profile));
    return profile;
  };

  const handleEmailSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!fullName.trim()) {
      setError('Please enter your full name.');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      const userCred = await createUserWithEmailAndPassword(auth, email.trim(), password);
      if (userCred.user) {
        await updateProfile(userCred.user, { displayName: fullName.trim() });
        const profile = await saveUserProfile(
          userCred.user.uid,
          fullName.trim(),
          userCred.user.email || email.trim()
        );
        onSuccess(profile);
      }
    } catch (err: any) {
      console.error('Sign up error:', err);
      if (err.code === 'auth/email-already-in-use') {
        setError('This email is already registered. Please login instead.');
      } else if (err.code === 'auth/invalid-email') {
        setError('Please enter a valid email address.');
      } else if (err.code === 'auth/weak-password') {
        setError('Password is too weak. Please use at least 6 characters.');
      } else {
        setError(err.message || 'Unable to sign up. Please check your connection.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!email.trim() || !password) {
      setError('Please enter your email and password.');
      return;
    }

    setLoading(true);
    try {
      const userCred = await signInWithEmailAndPassword(auth, email.trim(), password);
      if (userCred.user) {
        let name = userCred.user.displayName || '';
        try {
          const userDoc = await getDoc(doc(db, 'users', userCred.user.uid));
          if (userDoc.exists() && userDoc.data().fullName) {
            name = userDoc.data().fullName;
          }
        } catch {
          // ignore
        }
        const profile = await saveUserProfile(
          userCred.user.uid,
          name || 'Home Owner',
          userCred.user.email || email.trim()
        );
        onSuccess(profile);
      }
    } catch (err: any) {
      console.error('Login error:', err);
      if (
        err.code === 'auth/user-not-found' ||
        err.code === 'auth/wrong-password' ||
        err.code === 'auth/invalid-credential'
      ) {
        setError('Invalid email or password. Please try again.');
      } else if (err.code === 'auth/invalid-email') {
        setError('Please enter a valid email address.');
      } else {
        setError(err.message || 'Unable to sign in. Please check your connection.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setError(null);
    setLoading(true);
    try {
      const userCred = await signInWithPopup(auth, googleProvider);
      if (userCred.user) {
        const profile = await saveUserProfile(
          userCred.user.uid,
          userCred.user.displayName || 'Google User',
          userCred.user.email || ''
        );
        onSuccess(profile);
      }
    } catch (err: any) {
      console.error('Google sign in error:', err);
      if (err.code !== 'auth/popup-closed-by-user') {
        setError('Google sign in failed. Please try again or use email.');
      }
    } finally {
      setLoading(false);
    }
  };

  // 1. WELCOME PAGE
  if (view === 'welcome') {
    return (
      <div className="min-h-[85vh] flex flex-col items-center justify-center px-4 py-8">
        <div className="w-full max-w-md bg-neutral-900 border border-neutral-800 rounded-2xl p-6 sm:p-8 text-center shadow-xl">
          {/* Logo & Branding */}
          <div className="w-16 h-16 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 mx-auto flex items-center justify-center mb-5">
            <Shield className="w-8 h-8" />
          </div>

          <h1 className="text-2xl sm:text-3xl font-bold text-white tracking-tight mb-1">
            Monitor Your Home Yourself
          </h1>
          <p className="text-sm font-medium text-emerald-400 mb-3">
            By Jat Maomo Tech
          </p>

          <p className="text-neutral-300 text-sm sm:text-base leading-relaxed mb-8">
            &ldquo;Keep an eye on home, wherever you are.&rdquo;
          </p>

          {/* Feature highlights */}
          <div className="grid grid-cols-2 gap-3 mb-8 text-left">
            <div className="p-3.5 rounded-xl bg-neutral-950/70 border border-neutral-800/80 flex flex-col gap-1">
              <div className="flex items-center gap-1.5 text-neutral-200 text-xs font-semibold">
                <Video className="w-3.5 h-3.5 text-emerald-400" />
                <span>Camera Phone</span>
              </div>
              <p className="text-[11px] text-neutral-400 leading-tight">
                Place inside the room as your live CCTV camera.
              </p>
            </div>
            <div className="p-3.5 rounded-xl bg-neutral-950/70 border border-neutral-800/80 flex flex-col gap-1">
              <div className="flex items-center gap-1.5 text-neutral-200 text-xs font-semibold">
                <Eye className="w-3.5 h-3.5 text-cyan-400" />
                <span>Monitor Phone</span>
              </div>
              <p className="text-[11px] text-neutral-400 leading-tight">
                Watch live video securely from anywhere.
              </p>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="space-y-3">
            <button
              type="button"
              onClick={() => {
                setError(null);
                setView('signup');
              }}
              className="w-full py-3.5 px-4 rounded-xl bg-emerald-500 hover:bg-emerald-600 active:scale-[0.99] text-neutral-950 font-semibold text-sm transition flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-emerald-500/10"
            >
              <span>Sign Up</span>
              <ArrowRight className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={() => {
                setError(null);
                setView('login');
              }}
              className="w-full py-3.5 px-4 rounded-xl bg-neutral-800 hover:bg-neutral-700 active:scale-[0.99] border border-neutral-700 text-white font-medium text-sm transition cursor-pointer"
            >
              Login
            </button>

            <button
              type="button"
              onClick={handleGoogleSignIn}
              disabled={loading}
              className="w-full py-3 px-4 rounded-xl bg-neutral-950 hover:bg-neutral-800 border border-neutral-800 text-neutral-300 text-xs font-medium transition flex items-center justify-center gap-2.5 cursor-pointer mt-2"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24">
                <path
                  fill="#4285F4"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                />
                <path
                  fill="#EA4335"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                />
              </svg>
              <span>Continue with Google</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // 2. SIGN UP PAGE
  if (view === 'signup') {
    return (
      <div className="min-h-[85vh] flex flex-col items-center justify-center px-4 py-8">
        <div className="w-full max-w-md bg-neutral-900 border border-neutral-800 rounded-2xl p-6 sm:p-8 shadow-xl">
          <div className="text-center mb-6">
            <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight">Create an Account</h2>
            <p className="text-xs text-neutral-400 mt-1">
              Monitor Your Home Yourself &bull; Jat Maomo Tech
            </p>
          </div>

          {error && (
            <div className="p-3 mb-4 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-xs leading-relaxed">
              {error}
            </div>
          )}

          <form onSubmit={handleEmailSignUp} className="space-y-3.5">
            <div>
              <label className="block text-xs font-medium text-neutral-300 mb-1.5">Full Name</label>
              <div className="relative">
                <User className="w-4 h-4 text-neutral-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  required
                  placeholder="e.g. Alex Johnson"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="w-full pl-10 pr-3.5 py-2.5 rounded-xl bg-neutral-950 border border-neutral-800 text-neutral-100 placeholder-neutral-500 text-sm focus:outline-none focus:border-emerald-500 transition"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-neutral-300 mb-1.5">Email</label>
              <div className="relative">
                <Mail className="w-4 h-4 text-neutral-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="email"
                  required
                  placeholder="name@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full pl-10 pr-3.5 py-2.5 rounded-xl bg-neutral-950 border border-neutral-800 text-neutral-100 placeholder-neutral-500 text-sm focus:outline-none focus:border-emerald-500 transition"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-neutral-300 mb-1.5">Password</label>
              <div className="relative">
                <Lock className="w-4 h-4 text-neutral-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="password"
                  required
                  placeholder="At least 6 characters"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-10 pr-3.5 py-2.5 rounded-xl bg-neutral-950 border border-neutral-800 text-neutral-100 placeholder-neutral-500 text-sm focus:outline-none focus:border-emerald-500 transition"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-neutral-300 mb-1.5">Confirm Password</label>
              <div className="relative">
                <Lock className="w-4 h-4 text-neutral-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="password"
                  required
                  placeholder="Re-enter password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full pl-10 pr-3.5 py-2.5 rounded-xl bg-neutral-950 border border-neutral-800 text-neutral-100 placeholder-neutral-500 text-sm focus:outline-none focus:border-emerald-500 transition"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 px-4 rounded-xl bg-emerald-500 hover:bg-emerald-600 active:scale-[0.99] disabled:opacity-50 text-neutral-950 font-semibold text-sm transition flex items-center justify-center gap-2 cursor-pointer mt-2"
            >
              {loading ? 'Creating Account...' : 'Sign Up'}
            </button>
          </form>

          <div className="relative my-5">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-neutral-800" />
            </div>
            <div className="relative flex justify-center text-xs">
              <span className="bg-neutral-900 px-3 text-neutral-500 font-medium">Or continue with</span>
            </div>
          </div>

          <button
            type="button"
            onClick={handleGoogleSignIn}
            disabled={loading}
            className="w-full py-2.5 px-4 rounded-xl bg-neutral-950 hover:bg-neutral-800 border border-neutral-800 text-neutral-300 text-xs font-medium transition flex items-center justify-center gap-2.5 cursor-pointer"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24">
              <path
                fill="#4285F4"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="#34A853"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="#FBBC05"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
              />
              <path
                fill="#EA4335"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
              />
            </svg>
            <span>Continue with Google</span>
          </button>

          <div className="text-center mt-5 text-xs text-neutral-400">
            Already have an account?{' '}
            <button
              type="button"
              onClick={() => {
                setError(null);
                setView('login');
              }}
              className="text-emerald-400 hover:text-emerald-300 font-medium cursor-pointer underline underline-offset-2 ml-1"
            >
              Login
            </button>
          </div>
        </div>
      </div>
    );
  }

  // 3. LOGIN PAGE
  return (
    <div className="min-h-[85vh] flex flex-col items-center justify-center px-4 py-8">
      <div className="w-full max-w-md bg-neutral-900 border border-neutral-800 rounded-2xl p-6 sm:p-8 shadow-xl">
        <div className="text-center mb-6">
          <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight">Login</h2>
          <p className="text-xs text-neutral-400 mt-1">
            Monitor Your Home Yourself &bull; Jat Maomo Tech
          </p>
        </div>

        {error && (
          <div className="p-3 mb-4 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-xs leading-relaxed">
            {error}
          </div>
        )}

        <form onSubmit={handleEmailLogin} className="space-y-3.5">
          <div>
            <label className="block text-xs font-medium text-neutral-300 mb-1.5">Email</label>
            <div className="relative">
              <Mail className="w-4 h-4 text-neutral-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="email"
                required
                placeholder="name@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full pl-10 pr-3.5 py-2.5 rounded-xl bg-neutral-950 border border-neutral-800 text-neutral-100 placeholder-neutral-500 text-sm focus:outline-none focus:border-emerald-500 transition"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-neutral-300 mb-1.5">Password</label>
            <div className="relative">
              <Lock className="w-4 h-4 text-neutral-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="password"
                required
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full pl-10 pr-3.5 py-2.5 rounded-xl bg-neutral-950 border border-neutral-800 text-neutral-100 placeholder-neutral-500 text-sm focus:outline-none focus:border-emerald-500 transition"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 px-4 rounded-xl bg-emerald-500 hover:bg-emerald-600 active:scale-[0.99] disabled:opacity-50 text-neutral-950 font-semibold text-sm transition flex items-center justify-center gap-2 cursor-pointer mt-2"
          >
            {loading ? 'Logging in...' : 'Login'}
          </button>
        </form>

        <div className="relative my-5">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-neutral-800" />
          </div>
          <div className="relative flex justify-center text-xs">
            <span className="bg-neutral-900 px-3 text-neutral-500 font-medium">Or continue with</span>
          </div>
        </div>

        <button
          type="button"
          onClick={handleGoogleSignIn}
          disabled={loading}
          className="w-full py-2.5 px-4 rounded-xl bg-neutral-950 hover:bg-neutral-800 border border-neutral-800 text-neutral-300 text-xs font-medium transition flex items-center justify-center gap-2.5 cursor-pointer"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24">
            <path
              fill="#4285F4"
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
            />
            <path
              fill="#34A853"
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
            />
            <path
              fill="#FBBC05"
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
            />
            <path
              fill="#EA4335"
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
            />
          </svg>
          <span>Continue with Google</span>
        </button>

        <div className="text-center mt-5 text-xs text-neutral-400">
          Don&apos;t have an account?{' '}
          <button
            type="button"
            onClick={() => {
              setError(null);
              setView('signup');
            }}
            className="text-emerald-400 hover:text-emerald-300 font-medium cursor-pointer underline underline-offset-2 ml-1"
          >
            Sign Up
          </button>
        </div>
      </div>
    </div>
  );
};
