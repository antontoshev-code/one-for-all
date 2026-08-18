import React from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useGetEntryStats } from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { CATEGORIES } from '@/lib/app-utils';

export default function LibraryScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { data: stats } = useGetEntryStats();

  const topPad = Platform.OS === 'web' ? 67 + 16 : insets.top + 16;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ paddingTop: topPad, paddingHorizontal: 16, paddingBottom: 120 }}
    >
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.foreground }]}>Library</Text>
        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
          Everything you've captured, organized
        </Text>
      </View>

      <View style={styles.grid}>
        {CATEGORIES.map((cat) => {
          const count = stats ? stats[cat.key] : 0;
          return (
            <Pressable
              key={cat.key}
              testID={`library-${cat.key}`}
              onPress={() => router.push(`/category/${cat.key}`)}
              style={({ pressed }) => [
                styles.card,
                {
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                  transform: [{ scale: pressed ? 0.97 : 1 }],
                },
              ]}
            >
              <View style={[styles.iconCircle, { backgroundColor: colors.secondary }]}>
                <Feather name={cat.icon} size={22} color={colors.primary} />
              </View>
              <Text style={[styles.cardTitle, { color: colors.foreground }]}>{cat.title}</Text>
              <Text style={[styles.cardSubtitle, { color: colors.mutedForeground }]}>
                {cat.subtitle}
              </Text>
              <Text style={[styles.cardCount, { color: colors.primary }]}>
                {count} {count === 1 ? 'entry' : 'entries'}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  header: { marginBottom: 20, paddingHorizontal: 4 },
  title: { fontSize: 30, fontFamily: 'Outfit_600SemiBold', letterSpacing: -0.5 },
  subtitle: { fontSize: 16, fontFamily: 'Outfit_400Regular', marginTop: 4 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  card: {
    flexBasis: '47%',
    flexGrow: 1,
    borderRadius: 24,
    borderWidth: 1,
    padding: 18,
    gap: 4,
  },
  iconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  cardTitle: { fontSize: 17, fontFamily: 'Outfit_600SemiBold' },
  cardSubtitle: { fontSize: 12, fontFamily: 'Outfit_400Regular' },
  cardCount: { fontSize: 13, fontFamily: 'Outfit_500Medium', marginTop: 8 },
});
