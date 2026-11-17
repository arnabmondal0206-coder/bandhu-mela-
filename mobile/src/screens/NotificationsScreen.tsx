import React from 'react';
import { FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { PALETTE } from '../i18n/translations';
import { formatRelativeTime, markAllNotificationsRead } from '../services/api';
import { NotificationItem } from '../types/social';

interface NotificationsScreenProps {
  notifications: NotificationItem[];
  darkMode: boolean;
  onNavigate: (route: string) => void;
}

export const NotificationsScreen: React.FC<NotificationsScreenProps> = ({
  notifications,
  darkMode,
  onNavigate,
}) => {
  const c = darkMode ? PALETTE.dark : PALETTE.light;

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <View style={[styles.header, { backgroundColor: c.surface, borderBottomColor: c.border }]}>
        <Text style={{ color: c.text, fontSize: 16, fontWeight: '800' }}>Notifications</Text>
        <TouchableOpacity onPress={() => markAllNotificationsRead(notifications)}>
          <Text style={{ color: c.teal, fontSize: 12, fontWeight: '700' }}>Mark all read</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={notifications}
        keyExtractor={(n) => n.id}
        contentContainerStyle={{ padding: 14, gap: 10 }}
        ListEmptyComponent={
          <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border, alignItems: 'center' }]}>
            <Text style={{ color: c.muted }}>You are all caught up.</Text>
          </View>
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            style={[
              styles.card,
              { backgroundColor: c.surface, borderColor: item.read ? c.border : c.teal },
            ]}
            onPress={() => {
              if (item.type === 'message') onNavigate('Chat');
              else if (item.type === 'live') onNavigate('Live');
            }}
          >
            <Text style={{ color: c.text, fontSize: 13 }}>{item.message}</Text>
            <Text style={{ color: c.muted, fontSize: 11, marginTop: 4 }}>{formatRelativeTime(item.createdAt)}</Text>
          </TouchableOpacity>
        )}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  header: {
    height: 54,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  card: { borderRadius: 16, borderWidth: 1, padding: 14 },
});
