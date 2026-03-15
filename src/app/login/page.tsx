'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Mail, Lock, User, ArrowRight, AlertCircle } from 'lucide-react';
import { auth, cn } from '@/lib/api';
import { useStore } from '@/store';
import { Header } from '@/components/Header';

export default function LoginPage() {
  const router = useRouter();
  const { setUser } = useStore();
  
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (mode === 'login') {
        const { user } = await auth.login(email, password);
        setUser(user);
      } else {
        const { user } = await auth.register(email, password, username || undefined);
        setUser(user);
      }
      router.push('/');
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'An error occurred';
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-dark-primary">
      <Header />

      <main className="flex-1 flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-md">
          <div className="glass-card p-8">
            {/* Header */}
            <div className="text-center mb-8">
              <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-bulk-green to-bulk-red flex items-center justify-center">
                <span className="font-bold text-2xl text-white">B</span>
              </div>
              <h1 className="text-2xl font-bold text-text-primary">
                {mode === 'login' ? 'Welcome Back' : 'Create Account'}
              </h1>
              <p className="text-text-secondary text-sm mt-2">
                {mode === 'login' 
                  ? 'Sign in to access your watchlist and alerts' 
                  : 'Join the BULK Terminal community'}
              </p>
            </div>

            {/* Toggle */}
            <div className="flex gap-2 p-1 bg-dark-tertiary rounded-lg mb-6 border border-dark-border">
              <button
                onClick={() => setMode('login')}
                className={cn(
                  "flex-1 py-2 rounded-md text-sm font-medium transition-all",
                  mode === 'login'
                    ? "bg-bulk-green text-dark-primary"
                    : "text-text-secondary hover:text-text-primary"
                )}
              >
                Login
              </button>
              <button
                onClick={() => setMode('register')}
                className={cn(
                  "flex-1 py-2 rounded-md text-sm font-medium transition-all",
                  mode === 'register'
                    ? "bg-bulk-green text-dark-primary"
                    : "text-text-secondary hover:text-text-primary"
                )}
              >
                Register
              </button>
            </div>

            {/* Error */}
            {error && (
              <div className="flex items-center gap-2 p-3 mb-6 bg-bulk-red/10 border border-bulk-red/30 rounded-lg text-bulk-red text-sm">
                <AlertCircle className="w-4 h-4 shrink-0" />
                {error}
              </div>
            )}

            {/* Form */}
            <form onSubmit={handleSubmit} className="space-y-4">
              {mode === 'register' && (
                <div>
                  <label className="block text-xs uppercase tracking-wider text-text-secondary mb-2">
                    Username (optional)
                  </label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-text-secondary" />
                    <input
                      type="text"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      placeholder="satoshi"
                      className="w-full px-4 py-3 pl-11 bg-dark-tertiary border border-dark-border rounded-lg text-text-primary placeholder-text-secondary focus:outline-none focus:border-bulk-green transition-colors"
                    />
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs uppercase tracking-wider text-text-secondary mb-2">
                  Email
                </label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-text-secondary" />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    required
                    className="w-full px-4 py-3 pl-11 bg-dark-tertiary border border-dark-border rounded-lg text-text-primary placeholder-text-secondary focus:outline-none focus:border-bulk-green transition-colors"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs uppercase tracking-wider text-text-secondary mb-2">
                  Password
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-text-secondary" />
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                    minLength={8}
                    className="w-full px-4 py-3 pl-11 bg-dark-tertiary border border-dark-border rounded-lg text-text-primary placeholder-text-secondary focus:outline-none focus:border-bulk-green transition-colors"
                  />
                </div>
                {mode === 'register' && (
                  <p className="text-xs text-text-secondary mt-1">
                    Must be at least 8 characters
                  </p>
                )}
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full btn-primary py-3 flex items-center justify-center gap-2"
              >
                {loading ? (
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <>
                    {mode === 'login' ? 'Sign In' : 'Create Account'}
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </form>

            {/* Footer */}
            <p className="text-center text-sm text-text-secondary mt-6">
              {mode === 'login' ? (
                <>
                  Don&apos;t have an account?{' '}
                  <button
                    onClick={() => setMode('register')}
                    className="text-bulk-green hover:underline"
                  >
                    Sign up
                  </button>
                </>
              ) : (
                <>
                  Already have an account?{' '}
                  <button
                    onClick={() => setMode('login')}
                    className="text-bulk-green hover:underline"
                  >
                    Sign in
                  </button>
                </>
              )}
            </p>
          </div>

          <p className="text-center text-xs text-text-secondary mt-6">
            By signing up, you agree to track your favorite wallets and receive alerts.
          </p>
        </div>
      </main>
    </div>
  );
}
