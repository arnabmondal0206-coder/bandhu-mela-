import { LanguageCode } from '../types/social';

export const PALETTE = {
  light: {
    bg: '#F8F7FB',
    surface: '#FFFFFF',
    border: '#E7E3F0',
    text: '#14131A',
    muted: '#646273',
    teal: '#7C3AED',
    pink: '#EC4899',
    marigold: '#F97316',
    danger: '#DC2626',
  },
  dark: {
    bg: '#0B0B10',
    surface: '#14131D',
    border: '#252336',
    text: '#F4F3FA',
    muted: '#9E9BB3',
    teal: '#A78BFA',
    pink: '#F472B6',
    marigold: '#FB923C',
    danger: '#EF4444',
  },
};

const DICT: Record<LanguageCode, Record<string, string>> = {
  en: {
    brand: 'BANDHU MELA',
    tagline: 'Connect • Share • Chat • Make Friends',
    home: 'Home',
    friends: 'Friends',
    reels: 'Reels',
    notifications: 'Alerts',
    profile: 'Profile',
    audioParty: 'Audio Party',
    wallet: 'Wallet & Coins',
    live: 'Live',
    chat: 'Messages',
    communities: 'Circles & Events',
    privacy: 'Privacy & Help',
    ownerPanel: 'Owner Control',
    moderation: 'Admin Panel',
    whatsOnMind: "What's on your mind? Share photo, video, or #tag...",
    createPost: 'Publish',
    noPosts: 'No posts yet. Be the first to share!',
    signOut: 'Sign Out',
    raiseHand: 'Raise Hand',
    sendGift: 'Send Gift',
  },
  bn: {
    brand: 'বন্ধু মেলা',
    tagline: 'সংযুক্ত হোন • শেয়ার করুন • চ্যাট করুন • বন্ধু বানান',
    home: 'হোম',
    friends: 'বন্ধুরা',
    reels: 'রিলস',
    notifications: 'নোটিফিকেশন',
    profile: 'প্রোফাইল',
    audioParty: 'অডিও পার্টি',
    wallet: 'ওয়ালেট ও কয়েন',
    live: 'লাইভ',
    chat: 'মেসেজ',
    communities: 'গ্রুপ ও ইভেন্ট',
    privacy: 'প্রাইভেসি ও সহায়তা',
    ownerPanel: 'ওনার কন্ট্রোল',
    moderation: 'অ্যাডমিন প্যানেল',
    whatsOnMind: 'আপনার মনে কী চলছে? ছবি, ভিডিও বা #ট্যাগ শেয়ার করুন...',
    createPost: 'পোস্ট করুন',
    noPosts: 'এখনও কোনো পোস্ট নেই। আপনার প্রথম পোস্ট শেয়ার করুন!',
    signOut: 'লগ আউট',
    raiseHand: 'হাত তুলুন',
    sendGift: 'উপহার পাঠান',
  },
};

export function t(lang: LanguageCode, key: string): string {
  return DICT[lang]?.[key] || DICT.en[key] || key;
}
