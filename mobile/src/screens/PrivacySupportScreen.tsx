import React, { useEffect, useState } from 'react';
import { Alert, ScrollView, Share, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { sendPasswordResetEmail } from 'firebase/auth';
import { auth } from '../config/firebase';
import { PALETTE } from '../i18n/translations';
import {
  deleteUserAccountData,
  exportMyPersonalData,
  submitSupportTicket,
  subscribeMySupportTickets,
  unblockUser,
  updateUserProfile,
} from '../services/api';
import { SupportTicket, UserProfile } from '../types/social';

interface PrivacySupportScreenProps {
  currentUser: UserProfile;
  allUsers: UserProfile[];
  blockedByMe: Set<string>;
  darkMode: boolean;
  onProfileUpdated: (next: UserProfile) => void;
  onToast: (msg: string) => void;
}

export const PrivacySupportScreen: React.FC<PrivacySupportScreenProps> = ({
  currentUser,
  allUsers,
  blockedByMe,
  darkMode,
  onProfileUpdated,
  onToast,
}) => {
  const c = darkMode ? PALETTE.dark : PALETTE.light;
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    return subscribeMySupportTickets(currentUser.uid, setTickets);
  }, [currentUser.uid]);

  const updatePrivacy = async (
    patch: Partial<Pick<UserProfile, 'profileVisibility' | 'messagePrivacy' | 'showOnlineStatus'>>
  ) => {
    try {
      await updateUserProfile(currentUser.uid, patch);
      onProfileUpdated({ ...currentUser, ...patch });
      onToast('Privacy settings updated.');
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Unable to update privacy');
    }
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: c.bg }} contentContainerStyle={{ padding: 14, gap: 12 }}>
      {/* Privacy Preferences */}
      <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border, gap: 10 }]}>
        <Text style={{ color: c.text, fontWeight: '800', fontSize: 15 }}>Privacy Controls</Text>
        <View style={{ gap: 6 }}>
          <Text style={{ color: c.muted, fontSize: 12, fontWeight: '700' }}>Profile Visibility</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {(['public', 'friends'] as const).map((vis) => (
              <TouchableOpacity
                key={vis}
                style={[
                  styles.btn,
                  {
                    flex: 1,
                    backgroundColor: currentUser.profileVisibility === vis ? c.teal : c.bg,
                    borderWidth: 1,
                    borderColor: c.border,
                  },
                ]}
                onPress={() => updatePrivacy({ profileVisibility: vis })}
              >
                <Text style={{ color: currentUser.profileVisibility === vis ? '#FFF' : c.text, fontWeight: '700', fontSize: 12 }}>
                  {vis === 'public' ? 'Everyone' : 'Friends Only'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={{ gap: 6 }}>
          <Text style={{ color: c.muted, fontSize: 12, fontWeight: '700' }}>Direct Message Privacy</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {(['everyone', 'friends'] as const).map((mp) => (
              <TouchableOpacity
                key={mp}
                style={[
                  styles.btn,
                  {
                    flex: 1,
                    backgroundColor: currentUser.messagePrivacy === mp ? c.teal : c.bg,
                    borderWidth: 1,
                    borderColor: c.border,
                  },
                ]}
                onPress={() => updatePrivacy({ messagePrivacy: mp })}
              >
                <Text style={{ color: currentUser.messagePrivacy === mp ? '#FFF' : c.text, fontWeight: '700', fontSize: 12 }}>
                  {mp === 'everyone' ? 'Everyone' : 'Friends Only'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={{ color: c.text, fontSize: 13, fontWeight: '600' }}>Show Online &amp; Last Seen Status</Text>
          <Switch
            value={currentUser.showOnlineStatus}
            onValueChange={(val) => updatePrivacy({ showOnlineStatus: val })}
          />
        </View>
      </View>

      {/* Account Security & Recovery */}
      <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border, gap: 8 }]}>
        <Text style={{ color: c.text, fontWeight: '800', fontSize: 15 }}>Security &amp; Password Recovery</Text>
        <TouchableOpacity
          style={[styles.btn, { backgroundColor: c.teal }]}
          onPress={async () => {
            const email = auth.currentUser?.email;
            if (!email) {
              onToast('No verified email attached to this session.');
              return;
            }
            await sendPasswordResetEmail(auth, email);
            onToast('Password reset email sent!');
          }}
        >
          <Text style={{ color: '#FFF', fontWeight: '700' }}>Send Password Reset Email</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.btn, { borderWidth: 1, borderColor: c.border }]}
          onPress={async () => {
            const json = await exportMyPersonalData(currentUser.uid);
            await Share.share({ message: json, title: 'BANDHU MELA Data Export' });
          }}
        >
          <Text style={{ color: c.text, fontWeight: '700' }}>Export My Personal Data (JSON)</Text>
        </TouchableOpacity>
      </View>

      {/* Help Center */}
      <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border, gap: 8 }]}>
        <Text style={{ color: c.text, fontWeight: '800', fontSize: 15 }}>Help Center &amp; Customer Support</Text>
        <TextInput
          placeholder="Subject"
          placeholderTextColor={c.muted}
          value={subject}
          onChangeText={setSubject}
          style={[styles.input, { borderColor: c.border, color: c.text, backgroundColor: c.bg }]}
        />
        <TextInput
          placeholder="Describe your question or issue..."
          placeholderTextColor={c.muted}
          multiline
          value={message}
          onChangeText={setMessage}
          style={[styles.input, { height: 80, borderColor: c.border, color: c.text, backgroundColor: c.bg }]}
        />
        <TouchableOpacity
          style={[styles.btn, { backgroundColor: c.teal }]}
          onPress={async () => {
            if (!subject.trim() || !message.trim()) return;
            await submitSupportTicket({ user: currentUser, subject, category: 'other', message });
            setSubject('');
            setMessage('');
            onToast('Support ticket submitted!');
          }}
        >
          <Text style={{ color: '#FFF', fontWeight: '700' }}>Submit Support Ticket</Text>
        </TouchableOpacity>
        {tickets.map((tk) => (
          <View key={tk.id} style={{ padding: 10, borderRadius: 12, backgroundColor: c.bg }}>
            <Text style={{ color: c.text, fontWeight: '700', fontSize: 12 }}>
              @{tk.username} · {tk.subject} · {tk.status.toUpperCase()}
            </Text>
            {!!tk.adminReply && (
              <Text style={{ color: c.teal, fontSize: 12, marginTop: 2 }}>Reply: {tk.adminReply}</Text>
            )}
          </View>
        ))}
      </View>

      {/* Blocked Users */}
      {blockedByMe.size > 0 && (
        <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border, gap: 8 }]}>
          <Text style={{ color: c.text, fontWeight: '800', fontSize: 14 }}>Blocked Users</Text>
          {Array.from(blockedByMe).map((uid) => {
            const u = allUsers.find((x) => x.uid === uid);
            return (
              <View key={uid} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={{ color: c.text }}>{u?.displayName || uid}</Text>
                <TouchableOpacity onPress={() => unblockUser(currentUser.uid, uid)}>
                  <Text style={{ color: c.teal, fontWeight: '700' }}>Unblock</Text>
                </TouchableOpacity>
              </View>
            );
          })}
        </View>
      )}

      {/* Privacy Policy & Permanent Deletion */}
      <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border, gap: 8 }]}>
        <Text style={{ color: c.text, fontWeight: '800', fontSize: 14 }}>Privacy Policy &amp; Terms</Text>
        <Text style={{ color: c.muted, fontSize: 12, lineHeight: 18 }}>
          BANDHU MELA stores only the profile, posts, messages, speaking stats, and wallet transactions you create. Private contact information is isolated from public profiles. You can export your JSON data or permanently delete your account at any time.
        </Text>
        <TouchableOpacity
          style={[styles.btn, { backgroundColor: c.danger }]}
          onPress={() =>
            Alert.alert('Permanent Account Deletion', 'Delete your profile, posts, and account forever?', [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Delete Forever',
                style: 'destructive',
                onPress: async () => {
                  if (auth.currentUser) await deleteUserAccountData(auth.currentUser);
                },
              },
            ])
          }
        >
          <Text style={{ color: '#FFF', fontWeight: '800' }}>Permanently Delete Account</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  card: { borderRadius: 18, borderWidth: 1, padding: 14 },
  btn: { height: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  input: { height: 44, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, fontSize: 13 },
});
