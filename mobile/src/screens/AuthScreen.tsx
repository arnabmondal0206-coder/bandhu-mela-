import React, { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  createUserWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  User,
} from 'firebase/auth';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { BandhuLogo } from '../components/BandhuLogo';
import { auth } from '../config/firebase';
import { PALETTE, t } from '../i18n/translations';
import { LanguageCode } from '../types/social';

interface AuthScreenProps {
  unverifiedUser: User | null;
  lang: LanguageCode;
  darkMode: boolean;
  allowNewRegistrations: boolean;
  onToggleLang: () => void;
  onToggleTheme: () => void;
  onVerifiedRefresh: () => Promise<void>;
}

export const AuthScreen: React.FC<AuthScreenProps> = ({
  unverifiedUser,
  lang,
  darkMode,
  allowNewRegistrations,
  onToggleLang,
  onToggleTheme,
  onVerifiedRefresh,
}) => {
  const c = darkMode ? PALETTE.dark : PALETTE.light;
  const [mode, setMode] = useState<'login' | 'signup' | 'forgot'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    setError(null);
    setMessage(null);
    if (!email.trim()) {
      setError('Enter your email address.');
      return;
    }
    setBusy(true);
    try {
      if (mode === 'forgot') {
        await sendPasswordResetEmail(auth, email.trim());
        setMessage('Password reset email sent! Check your inbox.');
      } else if (mode === 'login') {
        await signInWithEmailAndPassword(auth, email.trim(), password);
      } else {
        if (!allowNewRegistrations) {
          throw new Error('New registrations are currently paused by the platform owner.');
        }
        if (password.length < 6) {
          throw new Error('Password must be at least 6 characters.');
        }
        await AsyncStorage.setItem(
          'bandhu_pending_signup',
          JSON.stringify({
            displayName: displayName.trim() || email.split('@')[0],
            username: username.trim().toLowerCase(),
            phoneNumber: phoneNumber.trim(),
          })
        );
        const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
        if (displayName.trim()) {
          await updateProfile(cred.user, { displayName: displayName.trim() });
        }
        await sendEmailVerification(cred.user);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed');
    } finally {
      setBusy(false);
    }
  };

  if (unverifiedUser) {
    return (
      <View style={[styles.container, { backgroundColor: c.bg, justifyContent: 'center', padding: 24 }]}>
        <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
          <View style={styles.brandRow}>
            <BandhuLogo size={40} />
            <Text style={[styles.title, { color: c.text }]}>{t(lang, 'brand')}</Text>
          </View>
          <Text style={[styles.sub, { color: c.text, fontWeight: '700', marginTop: 12 }]}>
            Verify Your Email
          </Text>
          <Text style={[styles.muted, { color: c.muted }]}>
            We sent a verification link to {unverifiedUser.email}. Open your inbox, verify your account, then tap below.
          </Text>
          {message && <Text style={{ color: c.teal, fontSize: 13 }}>{message}</Text>}
          <TouchableOpacity
            style={[styles.primaryBtn, { backgroundColor: c.teal }]}
            onPress={() => onVerifiedRefresh()}
          >
            <Text style={styles.primaryBtnText}>I Verified — Continue</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.outlineBtn, { borderColor: c.border }]}
            onPress={async () => {
              await sendEmailVerification(unverifiedUser);
              setMessage('Verification email resent!');
            }}
          >
            <Text style={{ color: c.text, fontWeight: '600' }}>Resend Link</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => signOut(auth)} style={{ paddingVertical: 8, alignItems: 'center' }}>
            <Text style={{ color: c.muted, fontSize: 13 }}>Use Another Account</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[styles.container, { backgroundColor: c.bg }]}
    >
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.topControls}>
          <TouchableOpacity
            style={[styles.chipBtn, { borderColor: c.border, backgroundColor: c.surface }]}
            onPress={onToggleTheme}
          >
            <Text style={{ color: c.text, fontSize: 12, fontWeight: '600' }}>
              {darkMode ? 'Light' : 'Dark'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.chipBtn, { borderColor: c.border, backgroundColor: c.surface }]}
            onPress={onToggleLang}
          >
            <Text style={{ color: c.teal, fontSize: 12, fontWeight: '700' }}>
              {lang === 'en' ? 'বাংলা' : 'English'}
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.hero}>
          <BandhuLogo size={56} />
          <Text style={[styles.brandText, { color: c.text }]}>{t(lang, 'brand')}</Text>
          <Text style={[styles.tagline, { color: c.teal }]}>{t(lang, 'tagline')}</Text>
        </View>

        <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
          <View style={[styles.tabsRow, { backgroundColor: c.bg }]}>
            {(['login', 'signup'] as const).map((m) => (
              <TouchableOpacity
                key={m}
                style={[styles.tabBtn, mode === m && { backgroundColor: c.teal }]}
                onPress={() => {
                  setMode(m);
                  setError(null);
                  setMessage(null);
                }}
              >
                <Text style={{ color: mode === m ? '#FFF' : c.muted, fontWeight: '700', fontSize: 13 }}>
                  {m === 'login' ? 'Sign In' : 'Create Account'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {mode === 'signup' && (
            <>
              <TextInput
                placeholder="Full Name"
                placeholderTextColor={c.muted}
                value={displayName}
                onChangeText={setDisplayName}
                style={[styles.input, { borderColor: c.border, color: c.text, backgroundColor: c.bg }]}
              />
              <TextInput
                placeholder="Username (e.g. arnab_kolkata)"
                placeholderTextColor={c.muted}
                autoCapitalize="none"
                value={username}
                onChangeText={setUsername}
                style={[styles.input, { borderColor: c.border, color: c.text, backgroundColor: c.bg }]}
              />
              <TextInput
                placeholder="Mobile Number (Private & Optional)"
                placeholderTextColor={c.muted}
                keyboardType="phone-pad"
                value={phoneNumber}
                onChangeText={setPhoneNumber}
                style={[styles.input, { borderColor: c.border, color: c.text, backgroundColor: c.bg }]}
              />
            </>
          )}

          <TextInput
            placeholder="Email Address"
            placeholderTextColor={c.muted}
            keyboardType="email-address"
            autoCapitalize="none"
            value={email}
            onChangeText={setEmail}
            style={[styles.input, { borderColor: c.border, color: c.text, backgroundColor: c.bg }]}
          />

          {mode !== 'forgot' && (
            <TextInput
              placeholder="Password"
              placeholderTextColor={c.muted}
              secureTextEntry
              value={password}
              onChangeText={setPassword}
              style={[styles.input, { borderColor: c.border, color: c.text, backgroundColor: c.bg }]}
            />
          )}

          {error && <Text style={{ color: c.danger, fontSize: 13 }}>{error}</Text>}
          {message && <Text style={{ color: c.teal, fontSize: 13 }}>{message}</Text>}

          <TouchableOpacity
            style={[styles.primaryBtn, { backgroundColor: c.teal }]}
            onPress={handleSubmit}
            disabled={busy}
          >
            {busy ? (
              <ActivityIndicator color="#FFF" />
            ) : (
              <Text style={styles.primaryBtnText}>
                {mode === 'login' ? 'Sign In' : mode === 'signup' ? 'Join BANDHU MELA' : 'Send Reset Email'}
              </Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => setMode(mode === 'forgot' ? 'login' : 'forgot')}
            style={{ alignItems: 'center', paddingVertical: 6 }}
          >
            <Text style={{ color: c.teal, fontSize: 13, fontWeight: '600' }}>
              {mode === 'forgot' ? 'Back to Sign In' : 'Forgot Password?'}
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { padding: 20, paddingTop: 48, flexGrow: 1, justifyContent: 'center' },
  topControls: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginBottom: 18 },
  chipBtn: { paddingHorizontal: 14, height: 36, borderRadius: 12, borderWidth: 1, justifyContent: 'center' },
  hero: { alignItems: 'center', marginBottom: 24 },
  brandText: { fontSize: 24, fontWeight: '800', marginTop: 10, letterSpacing: 0.5 },
  tagline: { fontSize: 12, fontWeight: '600', marginTop: 4 },
  card: { borderRadius: 24, borderWidth: 1, padding: 18, gap: 12 },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  title: { fontSize: 18, fontWeight: '800' },
  sub: { fontSize: 16 },
  muted: { fontSize: 13, lineHeight: 19 },
  tabsRow: { flexDirection: 'row', borderRadius: 14, padding: 4, gap: 4 },
  tabBtn: { flex: 1, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  input: { height: 48, borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, fontSize: 14 },
  primaryBtn: { height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  primaryBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 14 },
  outlineBtn: { height: 46, borderRadius: 14, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
});
