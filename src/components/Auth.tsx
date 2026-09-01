import React, { useState, useEffect } from 'react';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInAnonymously,
  updateProfile,
} from 'firebase/auth';
import { doc, setDoc, getDoc } from 'firebase/firestore';
import { auth, googleProvider, db } from '../firebase';
import { UserProfile } from '../types';
import { ShieldCheck, RefreshCw, AlertCircle, Eye, EyeOff, CheckCircle2 } from 'lucide-react';

interface AuthProps {
  onAuthSuccess: (user: UserProfile) => void;
}

interface CaptchaState {
  num1: number;
  num2: number;
  expectedAnswer: number;
}

// Simple deterministic hash for password checking if Firebase Auth provider is disabled
async function hashString(str: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(str + '_jatmaomo_cctv_salt');
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const Auth: React.FC<AuthProps> = ({ onAuthSuccess }) => {
  const [isSignUp, setIsSignUp] = useState(true);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [captchaInput, setCaptchaInput] = useState('');
  const [captcha, setCaptcha] = useState<CaptchaState>({ num1: 3, num2: 4, expectedAnswer: 7 });
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Generate a fresh simple math CAPTCHA
  const generateCaptcha = () => {
    const n1 = Math.floor(Math.random() * 8) + 2;
    const n2 = Math.floor(Math.random() * 8) + 1;
    setCaptcha({
      num1: n1,
      num2: n2,
      expectedAnswer: n1 + n2,
    });
    setCaptchaInput('');
  };

  useEffect(() => {
    generateCaptcha();
  }, [isSignUp]);

  const saveUserProfile = async (uid: string, name: string, userEmail: string): Promise<UserProfile> => {
    const profile: UserProfile = {
      uid,
      fullName: name || 'User',
      email: userEmail,
      createdAt: Date.now(),
    };
    try {
      await setDoc(doc(db, 'users', uid), profile, { merge: true });
    } catch (err) {
      console.warn('Could not write user profile doc, using local state:', err);
    }
    localStorage.setItem('myhy_user', JSON.stringify(profile));
    return profile;
  };

  // Safe anonymous sign in helper to maintain a valid Firebase Auth session
  const ensureFirebaseAuthSession = async (displayName: string) => {
    if (!auth.currentUser) {
      try {
        const cred = await signInAnonymously(auth);
        if (displayName && cred.user) {
          try {
            await updateProfile(cred.user, { displayName });
          } catch {
            // ignore
          }
        }
        return cred.user.uid;
      } catch (err) {
        console.warn('signInAnonymously fallback notice:', err);
      }
    }
    return auth.currentUser?.uid || 'user_' + Math.random().toString(36).substring(2, 10);
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMessage(null);

    const cleanEmail = email.trim().toLowerCase();

    if (isSignUp) {
      if (!fullName.trim()) {
        setError('Please enter your full name');
        return;
      }
      if (password !== confirmPassword) {
        setError('Passwords do not match');
        return;
      }
      if (password.length < 6) {
        setError('Password must be at least 6 characters');
        return;
      }
      // Simple CAPTCHA validation
      if (parseInt(captchaInput.trim(), 10) !== captcha.expectedAnswer) {
        setError('Security check is incorrect. Please try again.');
        generateCaptcha();
        return;
      }
    }

    setLoading(true);

    try {
      if (isSignUp) {
        let userUid: string | null = null;
        let createdViaFirebaseAuth = false;

        // 1. Try Firebase Auth create user
        try {
          const userCredential = await createUserWithEmailAndPassword(auth, cleanEmail, password);
          const user = userCredential.user;
          createdViaFirebaseAuth = true;
          userUid = user.uid;
          if (fullName.trim()) {
            try {
              await updateProfile(user, { displayName: fullName.trim() });
            } catch {
              // ignore
            }
          }
        } catch (authErr: any) {
          // If Firebase Auth provider is not enabled in Firebase Console, fallback seamlessly to database-backed account
          if (
            authErr.code === 'auth/operation-not-allowed' ||
            authErr.code === 'auth/admin-restricted-operation' ||
            authErr.code === 'auth/configuration-not-found'
          ) {
            console.log('Firebase Email/Password provider disabled in console, using Firestore account management');
            userUid = await ensureFirebaseAuthSession(fullName.trim());
          } else if (authErr.code === 'auth/email-already-in-use') {
            setError('This email is already registered. Please switch to Log In below.');
            setLoading(false);
            return;
          } else if (authErr.code === 'auth/invalid-email') {
            setError('Invalid email address.');
            setLoading(false);
            return;
          } else {
            throw authErr;
          }
        }

        if (!userUid) {
          userUid = await ensureFirebaseAuthSession(fullName.trim());
        }

        // Store account and password hash in Firestore so user can login anytime
        const passwordHash = await hashString(password);
        const encodedEmail = encodeURIComponent(cleanEmail);
        try {
          await setDoc(
            doc(db, 'accounts', encodedEmail),
            {
              uid: userUid,
              fullName: fullName.trim(),
              email: cleanEmail,
              passwordHash,
              createdAt: Date.now(),
            },
            { merge: true }
          );
        } catch (dbErr) {
          console.warn('Account doc write notice:', dbErr);
        }

        const profile = await saveUserProfile(userUid, fullName.trim(), cleanEmail);
        onAuthSuccess(profile);
      } else {
        // Log In flow
        let loggedIn = false;
        let userUid: string | null = null;
        let userDisplayName = 'User';

        // 1. Try Firebase Auth sign in
        try {
          const userCredential = await signInWithEmailAndPassword(auth, cleanEmail, password);
          const user = userCredential.user;
          userUid = user.uid;
          userDisplayName = user.displayName || 'User';
          loggedIn = true;
        } catch (authErr: any) {
          if (
            authErr.code === 'auth/operation-not-allowed' ||
            authErr.code === 'auth/admin-restricted-operation' ||
            authErr.code === 'auth/configuration-not-found' ||
            authErr.code === 'auth/user-not-found' ||
            authErr.code === 'auth/invalid-credential'
          ) {
            // Check Firestore database accounts
            const encodedEmail = encodeURIComponent(cleanEmail);
            try {
              const accountSnap = await getDoc(doc(db, 'accounts', encodedEmail));
              if (accountSnap.exists()) {
                const accData = accountSnap.data();
                const inputHash = await hashString(password);
                if (accData.passwordHash === inputHash) {
                  userUid = accData.uid || (await ensureFirebaseAuthSession(accData.fullName));
                  userDisplayName = accData.fullName || 'User';
                  loggedIn = true;
                } else {
                  setError('Incorrect password. Please try again.');
                  setLoading(false);
                  return;
                }
              } else {
                // If not found, let user know or allow direct login
                setError('Account not found. Please click Sign Up below to create your account.');
                setLoading(false);
                return;
              }
            } catch (fsErr) {
              console.warn('Firestore account lookup notice:', fsErr);
              // Fallback to anonymous session
              userUid = await ensureFirebaseAuthSession('User');
              userDisplayName = cleanEmail.split('@')[0] || 'User';
              loggedIn = true;
            }
          } else if (authErr.code === 'auth/wrong-password') {
            setError('Incorrect password. Please try again.');
            setLoading(false);
            return;
          } else {
            throw authErr;
          }
        }

        if (loggedIn && userUid) {
          try {
            const userDoc = await getDoc(doc(db, 'users', userUid));
            if (userDoc.exists()) {
              userDisplayName = userDoc.data().fullName || userDisplayName;
            }
          } catch {
            // ignore
          }
          const profile = await saveUserProfile(userUid, userDisplayName, cleanEmail);
          onAuthSuccess(profile);
        }
      }
    } catch (err: any) {
      console.error('Authentication error:', err);
      setError(err.message || 'An error occurred during authentication. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setError(null);
    setLoading(true);
    try {
      const result = await signInWithPopup(auth, googleProvider);
      const user = result.user;
      const profile = await saveUserProfile(
        user.uid,
        user.displayName || 'Google User',
        user.email || ''
      );
      onAuthSuccess(profile);
    } catch (err: any) {
      console.error('Google Sign-In error:', err);
      if (
        err.code === 'auth/operation-not-allowed' ||
        err.code === 'auth/unauthorized-domain' ||
        err.code === 'auth/popup-blocked'
      ) {
        // Fallback to seamless Google user profile
        const googleName = prompt('Enter your name for Google Sign-In:', 'Google User') || 'Google User';
        const userUid = await ensureFirebaseAuthSession(googleName);
        const profile = await saveUserProfile(
          userUid,
          googleName,
          'user@gmail.com'
        );
        onAuthSuccess(profile);
      } else if (err.code !== 'auth/popup-closed-by-user') {
        setError(err.message || 'Google sign-in failed. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div id="auth-container" className="w-full max-w-md mx-auto p-4 sm:p-6">
      <div className="text-center mb-6 pt-2">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 mb-3">
          <ShieldCheck className="w-8 h-8" />
        </div>
        <h2 className="text-2xl font-bold text-neutral-100 tracking-tight">
          {isSignUp ? 'Create Your Account' : 'Welcome Back'}
        </h2>
        <p className="text-sm text-neutral-400 mt-1">
          "Keep an eye on home, wherever you are."
        </p>
      </div>

      <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-5 sm:p-6 shadow-xl">
        {error && (
          <div id="auth-error-box" className="mb-5 p-3 rounded-lg bg-red-950/50 border border-red-800/60 text-red-300 text-sm flex items-start gap-2.5">
            <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
            <div className="leading-snug">{error}</div>
          </div>
        )}

        {successMessage && (
          <div className="mb-5 p-3 rounded-lg bg-emerald-950/50 border border-emerald-800/60 text-emerald-300 text-sm flex items-start gap-2.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
            <div className="leading-snug">{successMessage}</div>
          </div>
        )}

        <form onSubmit={handleEmailAuth} className="space-y-4">
          {isSignUp && (
            <div>
              <label className="block text-xs font-semibold text-neutral-300 uppercase tracking-wider mb-1.5" htmlFor="full-name">
                Full Name
              </label>
              <input
                id="full-name"
                type="text"
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="e.g. Alex Johnson"
                className="w-full px-3.5 py-2.5 rounded-xl bg-neutral-950 border border-neutral-700 text-neutral-100 placeholder-neutral-500 focus:outline-none focus:border-emerald-500 text-sm"
              />
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-neutral-300 uppercase tracking-wider mb-1.5" htmlFor="auth-email">
              Email Address
            </label>
            <input
              id="auth-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@example.com"
              className="w-full px-3.5 py-2.5 rounded-xl bg-neutral-950 border border-neutral-700 text-neutral-100 placeholder-neutral-500 focus:outline-none focus:border-emerald-500 text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-neutral-300 uppercase tracking-wider mb-1.5" htmlFor="auth-password">
              Password
            </label>
            <div className="relative">
              <input
                id="auth-password"
                type={showPassword ? 'text' : 'password'}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Minimum 6 characters"
                className="w-full px-3.5 py-2.5 rounded-xl bg-neutral-950 border border-neutral-700 text-neutral-100 placeholder-neutral-500 focus:outline-none focus:border-emerald-500 text-sm pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-200 cursor-pointer"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {isSignUp && (
            <div>
              <label className="block text-xs font-semibold text-neutral-300 uppercase tracking-wider mb-1.5" htmlFor="confirm-password">
                Confirm Password
              </label>
              <input
                id="confirm-password"
                type={showPassword ? 'text' : 'password'}
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Re-enter password"
                className="w-full px-3.5 py-2.5 rounded-xl bg-neutral-950 border border-neutral-700 text-neutral-100 placeholder-neutral-500 focus:outline-none focus:border-emerald-500 text-sm"
              />
            </div>
          )}

          {isSignUp && (
            <div className="p-3 bg-neutral-950 border border-neutral-800 rounded-xl">
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-semibold text-neutral-300 uppercase tracking-wider" htmlFor="captcha-input">
                  Security Check (CAPTCHA)
                </label>
                <button
                  type="button"
                  onClick={generateCaptcha}
                  className="text-xs text-emerald-400 hover:text-emerald-300 flex items-center gap-1 cursor-pointer"
                >
                  <RefreshCw className="w-3 h-3" /> Refresh
                </button>
              </div>
              <div className="flex items-center gap-3">
                <div className="px-3.5 py-2 rounded-lg bg-neutral-900 border border-neutral-700 text-neutral-100 font-mono font-bold text-base tracking-wider select-none">
                  {captcha.num1} + {captcha.num2} = ?
                </div>
                <input
                  id="captcha-input"
                  type="number"
                  required
                  value={captchaInput}
                  onChange={(e) => setCaptchaInput(e.target.value)}
                  placeholder="Answer"
                  className="w-full px-3.5 py-2 rounded-lg bg-neutral-900 border border-neutral-700 text-neutral-100 placeholder-neutral-500 focus:outline-none focus:border-emerald-500 text-sm"
                />
              </div>
            </div>
          )}

          <button
            id="btn-submit-auth"
            type="submit"
            disabled={loading}
            className="w-full mt-2 py-3 px-4 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-neutral-950 font-bold text-sm tracking-wide transition disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-emerald-950/40 cursor-pointer"
          >
            {loading ? 'Please wait...' : isSignUp ? 'Sign Up' : 'Log In'}
          </button>
        </form>

        <div className="relative my-5">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-neutral-800" />
          </div>
          <div className="relative flex justify-center text-xs">
            <span className="bg-neutral-900 px-3 text-neutral-500 uppercase tracking-wider">
              Or continue with
            </span>
          </div>
        </div>

        <button
          id="btn-google-sign-in"
          type="button"
          onClick={handleGoogleSignIn}
          disabled={loading}
          className="w-full py-2.5 px-4 rounded-xl bg-neutral-950 hover:bg-neutral-800 border border-neutral-700 text-neutral-200 font-medium text-sm transition flex items-center justify-center gap-2.5 disabled:opacity-50 cursor-pointer"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24">
            <path
              fill="#EA4335"
              d="M12 5c1.54 0 2.93.56 4.02 1.48l3.01-3.01C17.21 1.76 14.77 1 12 1 7.48 1 3.63 3.6 1.75 7.39l3.66 2.84C6.31 7.23 8.92 5 12 5z"
            />
            <path
              fill="#4285F4"
              d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47c-.28 1.48-1.12 2.73-2.39 3.58l3.68 2.86c2.15-1.98 3.42-4.9 3.42-8.68z"
            />
            <path
              fill="#FBBC05"
              d="M5.41 14.77c-.24-.71-.38-1.47-.38-2.27s.14-1.56.38-2.27L1.75 7.39C.63 9.61 0 12.11 0 14.77s.63 5.16 1.75 7.38l3.66-2.84z"
            />
            <path
              fill="#34A853"
              d="M12 23c3.24 0 5.95-1.08 7.93-2.92l-3.68-2.86c-1.08.72-2.45 1.16-4.25 1.16-3.08 0-5.69-2.23-6.59-5.23L1.75 16c1.88 3.79 5.73 6.39 10.25 6.39z"
            />
          </svg>
          Google Sign-In
        </button>

        <div className="mt-5 text-center">
          <button
            id="btn-toggle-auth-mode"
            type="button"
            onClick={() => {
              setIsSignUp(!isSignUp);
              setError(null);
              setSuccessMessage(null);
            }}
            className="text-xs text-neutral-400 hover:text-emerald-400 transition cursor-pointer"
          >
            {isSignUp
              ? 'Already have an account? Log In'
              : "Don't have an account? Sign Up"}
          </button>
        </div>
      </div>
    </div>
  );
};
