import React from 'react';
import { Image, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { resolveMediaUrl } from '../services/api';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const APP_ICON_SOURCE = require('../../assets/icon.png');

export const BandhuLogo: React.FC<{ size?: number }> = ({ size = 34 }) => {
  const radius = Math.round(size * 0.27);
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        overflow: 'hidden',
        backgroundColor: '#7C3AED',
        shadowColor: '#7C3AED',
        shadowOpacity: 0.22,
        shadowRadius: 6,
        shadowOffset: { width: 0, height: 2 },
        elevation: 3,
      }}
    >
      <Image
        source={APP_ICON_SOURCE}
        style={{ width: size, height: size, borderRadius: radius }}
        resizeMode="cover"
      />
    </View>
  );
};

export const VerifiedBadge: React.FC<{ size?: number }> = ({ size = 14 }) => (
  <Ionicons name="checkmark-circle" size={size} color="#7C3AED" />
);

export const AvatarFrame: React.FC<{
  uri?: string;
  name: string;
  size?: number;
  isVip?: boolean;
  vipColor?: string;
  isOnline?: boolean;
}> = ({ uri, name, size = 40, isVip = false, vipColor = '#F97316', isOnline = false }) => {
  const initial = (name || 'B').trim().charAt(0).toUpperCase();
  const radius = Math.round(size / 2);
  const resolvedUri = resolveMediaUrl(uri);
  const dotSize = Math.max(10, Math.round(size * 0.26));

  return (
    <View style={{ width: size, height: size, position: 'relative' }}>
      <View
        style={[
          {
            width: size,
            height: size,
            borderRadius: radius,
            overflow: 'hidden',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: '#7C3AED',
          },
          isVip && {
            borderWidth: size >= 56 ? 3 : 2,
            borderColor: vipColor,
          },
        ]}
      >
        {resolvedUri ? (
          <Image source={{ uri: resolvedUri }} style={{ width: size, height: size, borderRadius: radius }} resizeMode="cover" />
        ) : (
          <Text style={{ color: '#FFFFFF', fontWeight: '800', fontSize: Math.max(12, Math.round(size * 0.4)) }}>
            {initial}
          </Text>
        )}
      </View>
      {isOnline && (
        <View
          style={{
            position: 'absolute',
            right: 0,
            bottom: 0,
            width: dotSize,
            height: dotSize,
            borderRadius: dotSize / 2,
            backgroundColor: '#10B981',
            borderWidth: 2,
            borderColor: '#FFFFFF',
          }}
        />
      )}
    </View>
  );
};
