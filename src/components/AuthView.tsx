import React, { useEffect, useState } from 'react';
import {
  createUserWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
  User,
} from 'firebase/auth';
import {
  ArrowRight,
  CheckCircle2,
  Coins,
  Globe,
  KeyRound,
  Mail,
  Moon,
  Phone,
  RefreshCw,
  ShieldCheck,
  Sun,
  X,
} from 'lucide-react';
import { DEFAULT_COIN_PACKAGES } from '../lib/audioPartyApi';
import { auth, googleProvider } from '../lib/firebase';
import { t } from '../lib/i18n';
import { CoinPackage, LanguageCode } from '../types/social';
import { BandhuLogo } from './BandhuLogo';

interface AuthViewProps {
  unverifiedUser: User | null;
  lang: LanguageCode;
  darkMode?: boolean;
  allowNewRegistrations?: boolean;
  onToggleLang: () => void;
  onToggleTheme?: () => void;
  onVerifiedRefresh: () => Promise<void>;
}

const HERO_IMAGE = '/src/assets/images/bandhu_hero_community_1794810238569.jpg';

function evaluatePasswordStrength(pw: string): { score: number; label: string; valid: boolean } {
  if (!pw) return { score: 0, label: 'Enter a strong password', valid: false };
  let score = 0;
  if (pw.length >= 8) score += 1;
  if (/[A-Za-z]/.test(pw)) score += 1;
  if (/[0-9]/.test(pw)) score += 1;
  if (/[^A-Za-z0-9]/.test(pw) || pw.length >= 12) score += 1;

  if (score <= 1) return { score, label: 'Weak · use 8+ characters with letters & numbers', valid: false };
  if (score === 2) return { score, label: 'Fair · add numbers or symbols for stronger security', valid: pw.length >= 8 };
  if (score === 3) return { score, label: 'Strong password', valid: true };
  return { score, label: 'Very strong password', valid: true };
}

export const AuthView: React.FC<AuthViewProps> = ({
  unverifiedUser,
  lang,
  darkMode = false,
  allowNewRegistrations = true,
  onToggleLang,
  onToggleTheme,
  onVerifiedRefresh,
}) => {
  const [mode, setMode] = useState<'login' | 'register' | 'reset'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [agreedTerms, setAgreedTerms] = useState(true);
  const [showLegalModal, setShowLegalModal] = useState(false);
  const [showCoinStoreModal, setShowCoinStoreModal] = useState(false);
  const [storePackages, setStorePackages] = useState<Omit<CoinPackage, 'createdAt' | 'updatedAt'>[]>(
    DEFAULT_COIN_PACKAGES
  );
  const [storeNotice, setStoreNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!showCoinStoreModal) return;
    void fetch('/api/coins/packages')
      .then((r) => r.json())
      .then((data: { packages?: CoinPackage[] }) => {
        if (Array.isArray(data.packages) && data.packages.length > 0) {
          setStorePackages(data.packages.filter((p) => p.active !== false));
        }
      })
      .catch(() => {});
  }, [showCoinStoreModal]);

  const pwStrength = evaluatePasswordStrength(password);

  const handleGoogleSignIn = async () => {
    setError(null);
    setLoading(true);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Google Sign-In failed');
    } finally {
      setLoading(false);
    }
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfoMessage(null);
    setLoading(true);
    try {
      if (mode === 'reset') {
        if (!email.trim()) throw new Error('Enter your account email to receive a password reset link.');
        await sendPasswordResetEmail(auth, email.trim());
        setInfoMessage(`Password recovery email sent to ${email.trim()}. Check your inbox or spam folder.`);
      } else if (mode === 'login') {
        await signInWithEmailAndPassword(auth, email.trim(), password);
      } else {
        if (!allowNewRegistrations) {
          throw new Error('New registrations are temporarily paused by the platform owner.');
        }
        if (!displayName.trim()) {
          throw new Error('Please enter your full name.');
        }
        if (!pwStrength.valid) {
          throw new Error('Please choose a stronger password (at least 8 characters with letters and numbers).');
        }
        if (!agreedTerms) {
          throw new Error('Please accept the Privacy Policy and Terms of Service to create an account.');
        }
        const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
        await updateProfile(cred.user, { displayName: displayName.trim() });
        localStorage.setItem(
          'bandhu_pending_signup',
          JSON.stringify({
            displayName: displayName.trim(),
            username: username.trim(),
            phoneNumber: phoneNumber.trim(),
          })
        );
        await sendEmailVerification(cred.user);
        setInfoMessage('Verification link sent to your email. Please verify to continue.');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Authentication failed';
      if (msg.includes('operation-not-allowed')) {
        setError(
          'Email/Password sign-in is not enabled yet in Firebase Console. Use Google Sign-In below, or enable Email/Password under Firebase Console → Authentication → Sign-in method (free).'
        );
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleResendVerification = async () => {
    if (!unverifiedUser) return;
    setError(null);
    setLoading(true);
    try {
      await sendEmailVerification(unverifiedUser);
      setInfoMessage(`Verification email resent to ${unverifiedUser.email}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not resend verification email.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F8F7FB] dark:bg-[#0B0B10] text-zinc-900 dark:text-zinc-100 flex flex-col">
      <header className="w-full max-w-7xl mx-auto px-6 py-4 flex items-center justify-between gap-8 border-b border-[#E7E3F0] dark:border-[#252336]">
        <div className="flex items-center gap-3 shrink-0">
          <BandhuLogo size={36} useIconAsset />
          <span className="font-display text-xl font-extrabold tracking-tight bandhu-gradient-text whitespace-nowrap shrink-0">
            {t(lang, 'brand')}
          </span>
        </div>

        <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-zinc-600 dark:text-zinc-400">
          <a href="#auth-card" className="hover:text-violet-600 dark:hover:text-violet-400 transition-colors whitespace-nowrap shrink-0">
            {t(lang, 'stories')}
          </a>
          <a href="#auth-card" className="hover:text-violet-600 dark:hover:text-violet-400 transition-colors whitespace-nowrap shrink-0">
            {t(lang, 'reels')}
          </a>
          <a href="#auth-card" className="hover:text-violet-600 dark:hover:text-violet-400 transition-colors whitespace-nowrap shrink-0">
            {t(lang, 'live')}
          </a>
          <button
            type="button"
            onClick={() => setShowLegalModal(true)}
            className="hover:text-violet-600 dark:hover:text-violet-400 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            {t(lang, 'legalCenter')}
          </button>
        </nav>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => {
              setStoreNotice(null);
              setShowCoinStoreModal(true);
            }}
            className="h-10 px-3.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-zinc-950 text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <Coins className="w-3.5 h-3.5" />
            <span>Coin Store (₹)</span>
          </button>
          {onToggleTheme && (
            <button
              type="button"
              onClick={onToggleTheme}
              aria-label="Toggle theme"
              className="w-10 h-10 rounded-xl border border-[#E7E3F0] dark:border-[#252336] bg-white dark:bg-[#14131D] flex items-center justify-center hover:border-violet-500 transition-colors cursor-pointer"
            >
              {darkMode ? <Sun className="w-4 h-4 text-orange-400" /> : <Moon className="w-4 h-4 text-zinc-700" />}
            </button>
          )}
          <button
            type="button"
            onClick={onToggleLang}
            className="h-10 px-3.5 rounded-xl border border-[#E7E3F0] dark:border-[#252336] bg-white dark:bg-[#14131D] text-xs font-semibold flex items-center gap-1.5 hover:border-violet-500 transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <Globe className="w-3.5 h-3.5 text-violet-600 dark:text-violet-400" />
            <span>{t(lang, 'language')}</span>
          </button>
        </div>
      </header>

      <main className="flex-1 w-full max-w-7xl mx-auto px-6 py-8 lg:py-12 grid grid-cols-1 lg:grid-cols-12 gap-10 items-stretch">
        <section className="lg:col-span-6 flex flex-col justify-between gap-8">
          <div className="space-y-3">
            <p className="text-sm font-bold text-violet-600 dark:text-violet-400">
              {t(lang, 'tagline')}
            </p>
            <h1 className="font-display text-4xl sm:text-5xl font-bold tracking-tight text-zinc-950 dark:text-white leading-[1.08] [text-wrap:balance]">
              {lang === 'bn'
                ? 'গল্প, রিলস, লাইভ আড্ডা ও প্রিয় বন্ধুদের একান্ত মঞ্চ।'
                : 'A living courtyard for stories, live broadcasts, and real friendships.'}
            </h1>
            <p className="text-base text-zinc-600 dark:text-zinc-400 max-w-xl leading-relaxed">
              {lang === 'bn'
                ? '২৪ ঘণ্টার স্টোরি, শর্ট ভিডিও রিলস, লাইভ স্ট্রিমিং, কমিউনিটি, ইভেন্ট ও ভয়েস-ভিডিও কল — ওয়েব এবং অ্যান্ড্রয়েডে একসাথে।'
                : 'Share 24-hour stories, vertical reels, real-time live broadcasts, communities, events, and voice/video calls across web and Android.'}
            </p>
          </div>

          <div
            id="auth-card"
            className="bg-white dark:bg-[#14131D] border border-[#E7E3F0] dark:border-[#252336] rounded-3xl p-6 sm:p-8 shadow-sm"
          >
            {unverifiedUser ? (
              <div className="space-y-5">
                <div className="flex items-start gap-3">
                  <Mail className="w-6 h-6 text-[#0D6E6E] dark:text-teal-400 shrink-0 mt-0.5" />
                  <div>
                    <h2 className="font-display text-xl font-bold">Verify your email address</h2>
                    <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-1">
                      We sent a verification link to{' '}
                      <span className="font-semibold text-zinc-900 dark:text-white">{unverifiedUser.email}</span>. Click the link, then continue.
                    </p>
                  </div>
                </div>

                {error && (
                  <p className="text-sm text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 rounded-xl px-4 py-3">
                    {error}
                  </p>
                )}
                {infoMessage && (
                  <p className="text-sm text-teal-800 dark:text-teal-200 bg-teal-50 dark:bg-teal-950/40 border border-teal-200 dark:border-teal-900 rounded-xl px-4 py-3">
                    {infoMessage}
                  </p>
                )}

                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={onVerifiedRefresh}
                    disabled={loading}
                    className="flex-1 min-w-[180px] h-11 px-4 rounded-xl bandhu-gradient text-white text-sm font-semibold hover:opacity-95 transition-opacity flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    I&apos;ve Verified — Enter
                  </button>
                  <button
                    type="button"
                    onClick={handleResendVerification}
                    disabled={loading}
                    className="h-11 px-4 rounded-xl border border-[#E4DFD5] dark:border-[#262C30] text-sm font-medium hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors flex items-center gap-2 cursor-pointer"
                  >
                    <RefreshCw className="w-4 h-4" />
                    Resend
                  </button>
                  <button
                    type="button"
                    onClick={() => signOut(auth)}
                    className="h-11 px-4 rounded-xl text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white cursor-pointer"
                  >
                    {t(lang, 'signOut')}
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-5">
                <div className="flex items-center gap-1 p-1 bg-[#F8F7FB] dark:bg-[#0B0B10] rounded-xl">
                  <button
                    type="button"
                    onClick={() => {
                      setMode('login');
                      setError(null);
                      setInfoMessage(null);
                    }}
                    className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-colors cursor-pointer ${
                      mode === 'login'
                        ? 'bg-white dark:bg-[#14131D] text-zinc-950 dark:text-white shadow-sm'
                        : 'text-zinc-600 dark:text-zinc-400'
                    }`}
                  >
                    {lang === 'bn' ? 'সাইন ইন' : 'Sign In'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMode('register');
                      setError(null);
                      setInfoMessage(null);
                    }}
                    className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-colors cursor-pointer ${
                      mode === 'register'
                        ? 'bg-white dark:bg-[#14131D] text-zinc-950 dark:text-white shadow-sm'
                        : 'text-zinc-600 dark:text-zinc-400'
                    }`}
                  >
                    {lang === 'bn' ? 'নতুন অ্যাকাউন্ট' : 'Create Account'}
                  </button>
                </div>

                {mode !== 'reset' && (
                  <>
                    <button
                      type="button"
                      onClick={handleGoogleSignIn}
                      disabled={loading}
                      className="w-full h-11 rounded-xl border border-[#E7E3F0] dark:border-[#252336] bg-white dark:bg-[#0B0B10] hover:border-violet-500 text-sm font-semibold flex items-center justify-center gap-2.5 transition-colors cursor-pointer disabled:opacity-60"
                    >
                      <ShieldCheck className="w-4 h-4 text-violet-600 dark:text-violet-400" />
                      <span>{lang === 'bn' ? 'গুগল দিয়ে তাৎক্ষণিক প্রবেশ করুন' : 'Continue with Google (Instant Verified)'}</span>
                    </button>

                    <div className="flex items-center gap-3 text-xs text-zinc-400">
                      <div className="h-px flex-1 bg-[#E7E3F0] dark:bg-[#252336]" />
                      <span>{lang === 'bn' ? 'অথবা ইমেইল ও মোবাইল' : 'or Email & Mobile'}</span>
                      <div className="h-px flex-1 bg-[#E7E3F0] dark:bg-[#252336]" />
                    </div>
                  </>
                )}

                <form onSubmit={handleEmailAuth} className="space-y-3.5">
                  {mode === 'reset' && (
                    <div className="flex items-center gap-2 text-sm font-semibold text-[#0D6E6E] dark:text-teal-400">
                      <KeyRound className="w-4 h-4" />
                      <span>Password Recovery</span>
                    </div>
                  )}

                  {mode === 'register' && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">
                          Full Name
                        </label>
                        <input
                          type="text"
                          required
                          value={displayName}
                          onChange={(e) => setDisplayName(e.target.value)}
                          placeholder="Aarav Sen"
                          className="w-full h-11 px-3.5 rounded-xl border border-[#E4DFD5] dark:border-[#262C30] bg-[#F7F5F0] dark:bg-[#0E1113] text-sm focus:outline-none focus:ring-2 focus:ring-[#0D6E6E]/30"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">
                          Username
                        </label>
                        <input
                          type="text"
                          value={username}
                          onChange={(e) => setUsername(e.target.value)}
                          placeholder="aarav_sen"
                          className="w-full h-11 px-3.5 rounded-xl border border-[#E4DFD5] dark:border-[#262C30] bg-[#F7F5F0] dark:bg-[#0E1113] text-sm focus:outline-none focus:ring-2 focus:ring-[#0D6E6E]/30"
                        />
                      </div>
                    </div>
                  )}

                  {mode === 'register' && (
                    <div>
                      <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">
                        Mobile Number (Stored privately)
                      </label>
                      <div className="relative">
                        <Phone className="w-4 h-4 text-zinc-400 absolute left-3.5 top-3.5" />
                        <input
                          type="tel"
                          value={phoneNumber}
                          onChange={(e) => setPhoneNumber(e.target.value)}
                          placeholder="+91 98765 43210"
                          className="w-full h-11 pl-10 pr-3.5 rounded-xl border border-[#E4DFD5] dark:border-[#262C30] bg-[#F7F5F0] dark:bg-[#0E1113] text-sm focus:outline-none focus:ring-2 focus:ring-[#0D6E6E]/30"
                        />
                      </div>
                    </div>
                  )}

                  <div>
                    <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">
                      Email Address
                    </label>
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@example.com"
                      className="w-full h-11 px-3.5 rounded-xl border border-[#E4DFD5] dark:border-[#262C30] bg-[#F7F5F0] dark:bg-[#0E1113] text-sm focus:outline-none focus:ring-2 focus:ring-[#0D6E6E]/30"
                    />
                  </div>

                  {mode !== 'reset' && (
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                          Password
                        </label>
                        {mode === 'login' && (
                          <button
                            type="button"
                            onClick={() => {
                              setMode('reset');
                              setError(null);
                              setInfoMessage(null);
                            }}
                            className="text-xs font-semibold text-[#0D6E6E] dark:text-teal-400 hover:underline cursor-pointer"
                          >
                            Forgot password?
                          </button>
                        )}
                      </div>
                      <input
                        type="password"
                        required
                        minLength={mode === 'register' ? 8 : 6}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder={mode === 'register' ? 'Min 8 characters with letter & number' : 'Enter password'}
                        className="w-full h-11 px-3.5 rounded-xl border border-[#E4DFD5] dark:border-[#262C30] bg-[#F7F5F0] dark:bg-[#0E1113] text-sm focus:outline-none focus:ring-2 focus:ring-[#0D6E6E]/30"
                      />
                      {mode === 'register' && password && (
                        <div className="mt-2 space-y-1">
                          <div className="grid grid-cols-4 gap-1 h-1.5">
                            {[1, 2, 3, 4].map((step) => (
                              <div
                                key={step}
                                className={`rounded-full ${
                                  pwStrength.score >= step
                                    ? pwStrength.score >= 3
                                      ? 'bg-[#0D6E6E]'
                                      : 'bg-amber-500'
                                    : 'bg-zinc-200 dark:bg-zinc-800'
                                }`}
                              />
                            ))}
                          </div>
                          <p className="text-[11px] text-zinc-500">{pwStrength.label}</p>
                        </div>
                      )}
                    </div>
                  )}

                  {mode === 'register' && (
                    <label className="flex items-start gap-2.5 text-xs text-zinc-600 dark:text-zinc-400 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={agreedTerms}
                        onChange={(e) => setAgreedTerms(e.target.checked)}
                        className="mt-0.5 accent-[#0D6E6E]"
                      />
                      <span>
                        I agree to the BANDHU MELA{' '}
                        <button
                          type="button"
                          onClick={() => setShowLegalModal(true)}
                          className="text-[#0D6E6E] dark:text-teal-400 font-semibold hover:underline cursor-pointer"
                        >
                          Privacy Policy &amp; Terms of Service
                        </button>
                        .
                      </span>
                    </label>
                  )}

                  {error && (
                    <p className="text-xs sm:text-sm text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 rounded-xl px-3.5 py-2.5">
                      {error}
                    </p>
                  )}

                  {infoMessage && (
                    <p className="text-xs sm:text-sm text-teal-800 dark:text-teal-200 bg-teal-50 dark:bg-teal-950/40 border border-teal-200 dark:border-teal-900 rounded-xl px-3.5 py-2.5">
                      {infoMessage}
                    </p>
                  )}

                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full h-11 rounded-xl bandhu-gradient text-white text-sm font-semibold hover:opacity-95 transition-opacity flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
                  >
                    <span>
                      {mode === 'reset'
                        ? 'Send Password Recovery Email'
                        : mode === 'login'
                          ? lang === 'bn'
                            ? 'বন্ধু মেলায় প্রবেশ করুন'
                            : 'Enter BANDHU MELA'
                          : lang === 'bn'
                            ? 'ফ্রি অ্যাকাউন্ট তৈরি করুন'
                            : 'Create Free Account'}
                    </span>
                    <ArrowRight className="w-4 h-4" />
                  </button>

                  {mode === 'reset' && (
                    <button
                      type="button"
                      onClick={() => {
                        setMode('login');
                        setError(null);
                      }}
                      className="w-full h-10 text-xs font-semibold text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white cursor-pointer"
                    >
                      Back to Sign In
                    </button>
                  )}
                </form>
              </div>
            )}
          </div>
        </section>

        <section className="lg:col-span-6 flex">
          <div className="relative w-full min-h-[380px] lg:h-full rounded-3xl overflow-hidden border border-[#E4DFD5] dark:border-[#262C30] bg-zinc-900">
            <img
              src={HERO_IMAGE}
              alt="Friends gathering together at golden hour on BANDHU MELA"
              referrerPolicy="no-referrer"
              className="w-full h-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-[#0A1414]/90 via-black/30 to-transparent flex flex-col justify-end p-8">
              <div className="flex items-center gap-2.5 mb-2">
                <BandhuLogo size={28} />
                <span className="text-xs font-semibold text-amber-300">BANDHU MELA · Web &amp; Android</span>
              </div>
              <h2 className="font-display text-2xl sm:text-3xl font-bold text-white [text-wrap:balance]">
                {lang === 'bn'
                  ? 'বাংলা ও ইংরেজিতে আপনার প্রিয়জনদের সাথে যুক্ত থাকুন।'
                  : 'Designed from the ground up for authentic circles, live moments, and bilingual joy.'}
              </h2>
              <p className="text-sm text-zinc-200 mt-2 max-w-md">
                {lang === 'bn'
                  ? 'স্টোরি, রিলস, লাইভ ব্রডকাস্ট, কমিউনিটি, ইভেন্ট ও ভয়েস-ভিডিও কল — সব এক প্ল্যাটফর্মে।'
                  : 'Unified Firebase accounts, WebRTC live video & calls, communities, events, and full Android Expo source ready for Play Store.'}
              </p>
            </div>
          </div>
        </section>
      </main>

      {showLegalModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-xl bg-white dark:bg-[#171B1E] border border-[#E4DFD5] dark:border-[#262C30] rounded-3xl overflow-hidden shadow-xl">
            <div className="px-6 py-4 border-b border-[#E4DFD5] dark:border-[#262C30] flex items-center justify-between">
              <h3 className="font-display text-lg font-bold">BANDHU MELA Privacy Policy &amp; Terms</h3>
              <button
                type="button"
                onClick={() => setShowLegalModal(false)}
                className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto text-sm text-zinc-600 dark:text-zinc-300 leading-relaxed">
              <div>
                <h4 className="font-semibold text-zinc-950 dark:text-white">1. Privacy &amp; PII Isolation</h4>
                <p>
                  Email addresses and mobile numbers are isolated in private user subcollections readable only by the account owner and authorized platform administrators. Public profiles never expose private contact details.
                </p>
              </div>
              <div>
                <h4 className="font-semibold text-zinc-950 dark:text-white">2. User Rights, Export &amp; Permanent Deletion</h4>
                <p>
                  You can export your data as JSON or permanently delete your account, posts, stories, and profile records anytime from your Profile or Privacy Center.
                </p>
              </div>
              <div>
                <h4 className="font-semibold text-zinc-950 dark:text-white">3. Community Safety &amp; Anti-Abuse</h4>
                <p>
                  Harassment, spam flooding, impersonation, and harmful content are prohibited. Members can block users, report violations, and contact support directly.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
      {showCoinStoreModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-xl bg-white dark:bg-[#171B1E] border border-[#E4DFD5] dark:border-[#262C30] rounded-3xl overflow-hidden shadow-2xl">
            <div className="px-6 py-4 border-b border-[#E4DFD5] dark:border-[#262C30] flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-amber-500 text-zinc-950 flex items-center justify-center">
                  <Coins className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-display text-base font-bold">BANDHU MELA Coin Store (₹ INR)</h3>
                  <p className="text-xs text-zinc-500">Official Indian Rupee pricing · Verified checkout</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowCoinStoreModal(false)}
                className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4 max-h-[75vh] overflow-y-auto">
              {storeNotice && (
                <div className="rounded-xl border border-teal-200 dark:border-teal-900 bg-teal-50 dark:bg-teal-950/40 px-4 py-3 text-xs font-medium text-teal-800 dark:text-teal-200 flex items-center justify-between gap-2">
                  <span>{storeNotice}</span>
                  <button
                    type="button"
                    onClick={() => setShowCoinStoreModal(false)}
                    className="font-bold underline shrink-0 cursor-pointer"
                  >
                    Sign In
                  </button>
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {storePackages.map((pkg) => (
                  <div
                    key={pkg.id}
                    className="rounded-2xl border border-[#E4DFD5] dark:border-[#262C30] p-4 flex items-center justify-between gap-3"
                  >
                    <div>
                      <p className="text-xs font-bold text-[#0D6E6E] dark:text-teal-400">{pkg.name}</p>
                      <p className="font-display text-lg font-bold tabular-nums mt-0.5">
                        {pkg.coins.toLocaleString('en-IN')} Coins
                      </p>
                      <p className="text-[11px] text-zinc-500 tabular-nums">
                        ₹{pkg.priceInr.toLocaleString('en-IN')} INR
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setStoreNotice(
                          `Sign in to purchase ${pkg.coins.toLocaleString('en-IN')} Coins for ₹${pkg.priceInr.toLocaleString('en-IN')}.`
                        )
                      }
                      className="h-10 px-4 rounded-xl bg-amber-500 hover:bg-amber-400 text-zinc-950 text-xs font-bold shrink-0 cursor-pointer tabular-nums"
                    >
                      ₹{pkg.priceInr.toLocaleString('en-IN')}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
