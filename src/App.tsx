import React, { useState, useEffect } from 'react';
import { UserProfile, AppRole } from './types';
import { Header } from './components/Header';
import { RoleSelector } from './components/RoleSelector';
import { ControllerMode } from './components/ControllerMode';
import { MonitorMode } from './components/MonitorMode';
import { Auth } from './components/Auth';
import { ShieldCheck } from 'lucide-react';

export default function App() {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [role, setRole] = useState<AppRole>(null);
  const [initialRoomCode, setInitialRoomCode] = useState<string>('');
  const [loading, setLoading] = useState(true);

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

  // Check for existing session
  useEffect(() => {
    const checkSession = () => {
      const stored = localStorage.getItem('myhy_user');
      if (stored) {
        try {
          const parsed = JSON.parse(stored);
          if (parsed && parsed.uid) {
            setUser(parsed);
          }
        } catch {
          // ignore
        }
      }
      setLoading(false);
    };

    checkSession();
  }, []);

  const handleAuthSuccess = (authenticatedUser: UserProfile) => {
    setUser(authenticatedUser);
  };

  const handleSignOut = () => {
    localStorage.removeItem('myhy_user');
    setUser(null);
    setRole(null);
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete('role');
      url.searchParams.delete('room');
      window.history.replaceState({}, '', url.toString());
    } catch {
      // ignore
    }
  };

  const handleRoleChange = (newRole: AppRole) => {
    setRole(newRole);
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

  if (loading) {
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
        onSignOut={handleSignOut}
      />

      <main className="flex-1 flex flex-col justify-center py-4">
        {!user ? (
          <Auth onAuthSuccess={handleAuthSuccess} />
        ) : role === 'controller' ? (
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
