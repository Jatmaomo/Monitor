import React, { useState, useEffect } from 'react';
import { onAuthStateChanged, signInAnonymously } from 'firebase/auth';
import { doc, getDocFromServer } from 'firebase/firestore';
import { auth, db } from './firebase';
import { UserProfile, AppRole } from './types';
import { Header } from './components/Header';
import { RoleSelector } from './components/RoleSelector';
import { ControllerMode } from './components/ControllerMode';
import { MonitorMode } from './components/MonitorMode';
import { ShieldCheck } from 'lucide-react';

export default function App() {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [role, setRole] = useState<AppRole>(null);
  const [initialRoomCode, setInitialRoomCode] = useState<string>('');
  const [authLoading, setAuthLoading] = useState(true);

  // Parse URL search params for room code or direct role on initial load
  useEffect(() => {
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const urlRoom = urlParams.get('room');
      const urlRole = urlParams.get('role');

      if (urlRoom) {
        setInitialRoomCode(urlRoom.trim());
        setRole('monitor');
      } else if (urlRole === 'controller' || urlRole === 'monitor') {
        setRole(urlRole);
      }
    } catch (e) {
      console.warn('Could not parse URL query parameters:', e);
    }
  }, []);

  // Auto-authenticate seamlessly to skip the sign up page completely
  useEffect(() => {
    const initializeUser = async () => {
      // 1. Check local session storage
      const stored = localStorage.getItem('myhy_user');
      let localUser: UserProfile | null = null;
      if (stored) {
        try {
          localUser = JSON.parse(stored);
        } catch {
          localUser = null;
        }
      }

      if (!localUser) {
        const randomId = 'user_' + Math.random().toString(36).substring(2, 10);
        localUser = {
          uid: randomId,
          fullName: 'User',
          email: `${randomId}@jatmaomo.local`,
          createdAt: Date.now(),
        };
        localStorage.setItem('myhy_user', JSON.stringify(localUser));
      }

      setUser(localUser);

      // Try Firebase Auth in background without blocking UI
      try {
        await signInAnonymously(auth);
      } catch {
        // Continue with local session profile
      }

      setAuthLoading(false);
    };

    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      if (firebaseUser) {
        setUser((prev) => {
          const updated: UserProfile = {
            uid: firebaseUser.uid,
            fullName: prev?.fullName || firebaseUser.displayName || 'User',
            email: firebaseUser.email || prev?.email || 'user@jatmaomo.local',
            createdAt: prev?.createdAt || Date.now(),
          };
          localStorage.setItem('myhy_user', JSON.stringify(updated));
          return updated;
        });
      }
    });

    initializeUser();
    return () => unsubscribe();
  }, []);

  const handleRoleChange = (newRole: AppRole) => {
    setRole(newRole);
    // Update URL without reloading
    try {
      const url = new URL(window.location.href);
      if (newRole) {
        url.searchParams.set('role', newRole);
      } else {
        url.searchParams.delete('role');
        url.searchParams.delete('room');
      }
      window.history.replaceState({}, '', url.toString());
    } catch {
      // ignore
    }
  };

  if (authLoading || !user) {
    return (
      <div className="min-h-screen bg-neutral-950 flex flex-col items-center justify-center p-4">
        <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center mb-4 animate-pulse">
          <ShieldCheck className="w-6 h-6" />
        </div>
        <p className="text-sm font-medium text-neutral-400">
          Loading Monitor Your Home Yourself...
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 flex flex-col selection:bg-emerald-500 selection:text-black">
      <Header
        user={user}
        currentRole={role}
        onSelectRole={handleRoleChange}
        onSignOut={() => handleRoleChange(null)}
      />

      <main className="flex-1 flex flex-col justify-center py-4">
        {role === 'controller' ? (
          <ControllerMode user={user} />
        ) : role === 'monitor' ? (
          <MonitorMode user={user} initialRoomCode={initialRoomCode} />
        ) : (
          <RoleSelector user={user} onSelectRole={handleRoleChange} />
        )}
      </main>

      <footer className="py-4 text-center text-xs text-neutral-600 border-t border-neutral-900">
        <p>Monitor Your Home Yourself &bull; Jat Maomo Tech</p>
      </footer>
    </div>
  );
}
