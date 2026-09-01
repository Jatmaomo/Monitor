import React, { useState, useEffect } from 'react';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { doc, getDoc, getDocFromServer } from 'firebase/firestore';
import { auth, db } from './firebase';
import { UserProfile, AppRole } from './types';
import { Header } from './components/Header';
import { Auth } from './components/Auth';
import { RoleSelector } from './components/RoleSelector';
import { ControllerMode } from './components/ControllerMode';
import { MonitorMode } from './components/MonitorMode';
import { ShieldCheck } from 'lucide-react';

export default function App() {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [role, setRole] = useState<AppRole>(null);
  const [authLoading, setAuthLoading] = useState(true);

  // Validate connection to Firestore on boot
  useEffect(() => {
    async function testConnection() {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (error) {
        if (error instanceof Error && error.message.includes('the client is offline')) {
          console.warn('Please check your Firebase configuration or network status.');
        }
      }
    }
    testConnection();
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        let fullName = firebaseUser.displayName || 'User';
        try {
          const userDoc = await getDoc(doc(db, 'users', firebaseUser.uid));
          if (userDoc.exists()) {
            fullName = userDoc.data().fullName || fullName;
          }
        } catch {
          // Firestore read error fallback
        }

        setUser({
          uid: firebaseUser.uid,
          fullName,
          email: firebaseUser.email || '',
          createdAt: Date.now(),
        });
      } else {
        // Check if there is a local session profile stored
        const stored = localStorage.getItem('myhy_user');
        if (stored) {
          try {
            setUser(JSON.parse(stored));
          } catch {
            setUser(null);
          }
        } else {
          setUser(null);
        }
        setRole(null);
      }
      setAuthLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const handleSignOut = async () => {
    try {
      localStorage.removeItem('myhy_user');
      await signOut(auth);
      setUser(null);
      setRole(null);
    } catch (err) {
      console.error('Sign out error:', err);
      localStorage.removeItem('myhy_user');
      setUser(null);
      setRole(null);
    }
  };

  if (authLoading) {
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
        onSelectRole={setRole}
        onSignOut={handleSignOut}
      />

      <main className="flex-1 flex flex-col justify-center py-4">
        {!user ? (
          <Auth onAuthSuccess={(profile) => setUser(profile)} />
        ) : role === 'controller' ? (
          <ControllerMode user={user} />
        ) : role === 'monitor' ? (
          <MonitorMode user={user} />
        ) : (
          <RoleSelector user={user} onSelectRole={setRole} />
        )}
      </main>

      <footer className="py-4 text-center text-xs text-neutral-600 border-t border-neutral-900">
        <p>Monitor Your Home Yourself &bull; Jat Maomo Tech</p>
      </footer>
    </div>
  );
}
