import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../config/firebase';
import { PALETTE } from '../i18n/translations';
import {
  createCommunity,
  createEvent,
  subscribeCommunities,
  subscribeEvents,
  toggleCommunityMembership,
  toggleEventRsvp,
} from '../services/api';
import { CommunityEvent, CommunityGroup, UserProfile } from '../types/social';

interface CommunitiesEventsScreenProps {
  currentUser: UserProfile;
  darkMode: boolean;
  onToast: (msg: string) => void;
}

export const CommunitiesEventsScreen: React.FC<CommunitiesEventsScreenProps> = ({
  currentUser,
  darkMode,
  onToast,
}) => {
  const c = darkMode ? PALETTE.dark : PALETTE.light;
  const [tab, setTab] = useState<'groups' | 'events'>('groups');
  const [groups, setGroups] = useState<CommunityGroup[]>([]);
  const [events, setEvents] = useState<CommunityEvent[]>([]);
  const [joinedIds, setJoinedIds] = useState<Set<string>>(new Set());
  const [rsvpIds, setRsvpIds] = useState<Set<string>>(new Set());
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [location, setLocation] = useState('Kolkata / Online');

  useEffect(() => {
    const u1 = subscribeCommunities(setGroups);
    const u2 = subscribeEvents(setEvents);
    return () => {
      u1();
      u2();
    };
  }, []);

  useEffect(() => {
    if (!groups.length) return;
    void Promise.all(
      groups.slice(0, 30).map(async (g) => {
        const snap = await getDoc(doc(db, 'communities', g.id, 'members', currentUser.uid)).catch(() => null);
        return snap && snap.exists() ? g.id : null;
      })
    ).then((ids) => {
      setJoinedIds(new Set(ids.filter(Boolean) as string[]));
    });
  }, [groups, currentUser.uid]);

  useEffect(() => {
    if (!events.length) return;
    void Promise.all(
      events.slice(0, 30).map(async (ev) => {
        const snap = await getDoc(doc(db, 'events', ev.id, 'rsvps', currentUser.uid)).catch(() => null);
        return snap && snap.exists() ? ev.id : null;
      })
    ).then((ids) => {
      setRsvpIds(new Set(ids.filter(Boolean) as string[]));
    });
  }, [events, currentUser.uid]);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: c.bg }} contentContainerStyle={{ padding: 14, gap: 12 }}>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {(['groups', 'events'] as const).map((tb) => (
          <TouchableOpacity
            key={tb}
            style={[styles.tabBtn, { backgroundColor: tab === tb ? c.teal : c.surface, borderColor: c.border }]}
            onPress={() => setTab(tb)}
          >
            <Text style={{ color: tab === tb ? '#FFF' : c.text, fontWeight: '800', fontSize: 13 }}>
              {tb === 'groups' ? 'Communities' : 'Events'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border, gap: 8 }]}>
        <Text style={{ color: c.text, fontWeight: '800', fontSize: 14 }}>
          {tab === 'groups' ? 'Create Community Circle' : 'Host an Event'}
        </Text>
        <TextInput
          placeholder={tab === 'groups' ? 'Community Name' : 'Event Title'}
          placeholderTextColor={c.muted}
          value={title}
          onChangeText={setTitle}
          style={[styles.input, { borderColor: c.border, color: c.text, backgroundColor: c.bg }]}
        />
        <TextInput
          placeholder="Description"
          placeholderTextColor={c.muted}
          value={desc}
          onChangeText={setDesc}
          style={[styles.input, { borderColor: c.border, color: c.text, backgroundColor: c.bg }]}
        />
        {tab === 'events' && (
          <TextInput
            placeholder="Location"
            placeholderTextColor={c.muted}
            value={location}
            onChangeText={setLocation}
            style={[styles.input, { borderColor: c.border, color: c.text, backgroundColor: c.bg }]}
          />
        )}
        <TouchableOpacity
          style={{ height: 42, borderRadius: 12, backgroundColor: c.teal, alignItems: 'center', justifyContent: 'center' }}
          onPress={async () => {
            if (!title.trim()) return;
            if (tab === 'groups') {
              await createCommunity(currentUser, title, desc, 'General');
              onToast('Community created!');
            } else {
              await createEvent(currentUser, title, desc, location);
              onToast('Event created!');
            }
            setTitle('');
            setDesc('');
          }}
        >
          <Text style={{ color: '#FFF', fontWeight: '800' }}>Create</Text>
        </TouchableOpacity>
      </View>

      {tab === 'groups'
        ? groups.map((g) => {
            const joined = joinedIds.has(g.id);
            return (
              <View key={g.id} style={[styles.card, { backgroundColor: c.surface, borderColor: c.border, gap: 6 }]}>
                <Text style={{ color: c.text, fontWeight: '800', fontSize: 15 }}>{g.name}</Text>
                <Text style={{ color: c.muted, fontSize: 12 }}>{g.description}</Text>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
                  <Text style={{ color: c.teal, fontSize: 12, fontWeight: '700' }}>{g.membersCount} members</Text>
                  <TouchableOpacity
                    style={{ paddingHorizontal: 14, height: 34, borderRadius: 10, backgroundColor: joined ? c.bg : c.teal, justifyContent: 'center' }}
                    onPress={async () => {
                      const nextState = await toggleCommunityMembership(g.id, currentUser, joined);
                      setJoinedIds((prev) => {
                        const copy = new Set(prev);
                        if (nextState) copy.add(g.id);
                        else copy.delete(g.id);
                        return copy;
                      });
                    }}
                  >
                    <Text style={{ color: joined ? c.text : '#FFF', fontWeight: '700', fontSize: 12 }}>
                      {joined ? 'Leave' : 'Join'}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          })
        : events.map((ev) => {
            const going = rsvpIds.has(ev.id);
            return (
              <View key={ev.id} style={[styles.card, { backgroundColor: c.surface, borderColor: c.border, gap: 6 }]}>
                <Text style={{ color: c.text, fontWeight: '800', fontSize: 15 }}>{ev.title}</Text>
                <Text style={{ color: c.muted, fontSize: 12 }}>
                  {ev.location} · {ev.eventDate}
                </Text>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
                  <Text style={{ color: c.marigold, fontSize: 12, fontWeight: '700' }}>{ev.attendeesCount} going</Text>
                  <TouchableOpacity
                    style={{ paddingHorizontal: 14, height: 34, borderRadius: 10, backgroundColor: going ? c.bg : c.marigold, justifyContent: 'center' }}
                    onPress={async () => {
                      await toggleEventRsvp(ev.id, currentUser, going);
                      setRsvpIds((prev) => {
                        const copy = new Set(prev);
                        if (going) copy.delete(ev.id);
                        else copy.add(ev.id);
                        return copy;
                      });
                    }}
                  >
                    <Text style={{ color: '#14171A', fontWeight: '800', fontSize: 12 }}>
                      {going ? 'Going ✓' : 'RSVP Going'}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          })}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  card: { borderRadius: 18, borderWidth: 1, padding: 14 },
  tabBtn: { flex: 1, height: 40, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  input: { height: 44, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, fontSize: 13 },
});
