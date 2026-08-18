import React from 'react';
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useQueryClient } from '@tanstack/react-query';
import {
  useListEntries,
  useUpdateEntry,
  useDeleteEntry,
  getListEntriesQueryKey,
  getGetEntryStatsQueryKey,
  type Entry,
} from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { CATEGORY_META, formatDate, type Category } from '@/lib/app-utils';

export default function CategoryScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { cat } = useLocalSearchParams<{ cat: string }>();
  const category = (['journal', 'task', 'idea', 'log'].includes(cat ?? '') ? cat : 'journal') as Category;
  const meta = CATEGORY_META[category];

  const { data: entries, isLoading, refetch, isRefetching } = useListEntries({ category });

  const topPad = Platform.OS === 'web' ? 67 + 12 : insets.top + 12;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={[styles.navRow, { paddingTop: topPad }]}>
        <Pressable
          testID="category-back"
          onPress={() => router.back()}
          hitSlop={12}
          style={({ pressed }) => [
            styles.backButton,
            { backgroundColor: colors.secondary, opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <Feather name="chevron-left" size={22} color={colors.foreground} />
        </Pressable>
        <View>
          <Text style={[styles.title, { color: colors.foreground }]}>{meta.title}</Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>{meta.subtitle}</Text>
        </View>
      </View>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={entries ?? []}
          keyExtractor={(item) => String(item.id)}
          scrollEnabled={(entries ?? []).length > 0}
          contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: 60, flexGrow: 1 }}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />
          }
          ListEmptyComponent={
            <View style={[styles.center, { paddingTop: 60, gap: 10 }]}>
              <Feather name={meta.icon} size={34} color={colors.mutedForeground} />
              <Text style={{ color: colors.mutedForeground, fontSize: 15, fontFamily: 'Outfit_400Regular' }}>
                Nothing in {meta.title} yet.
              </Text>
            </View>
          }
          renderItem={({ item }) => <CategoryEntryCard entry={item} category={category} />}
        />
      )}
    </View>
  );
}

function CategoryEntryCard({ entry, category }: { entry: Entry; category: Category }) {
  const colors = useColors();
  const queryClient = useQueryClient();
  const updateEntry = useUpdateEntry();
  const deleteEntry = useDeleteEntry();

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getListEntriesQueryKey({ category }) });
    queryClient.invalidateQueries({ queryKey: getGetEntryStatsQueryKey() });
  };

  const toggleDone = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    updateEntry.mutate(
      { id: entry.id, data: { isTaskDone: !entry.isTaskDone } },
      { onSuccess: invalidate },
    );
  };

  const backToInbox = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    updateEntry.mutate(
      { id: entry.id, data: { category: 'inbox' } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListEntriesQueryKey({ category: 'inbox' }) });
          invalidate();
        },
      },
    );
  };

  const remove = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    deleteEntry.mutate({ id: entry.id }, { onSuccess: invalidate });
  };

  const done = category === 'task' && entry.isTaskDone;

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.cardRow}>
        {category === 'task' && (
          <Pressable
            testID={`toggle-done-${entry.id}`}
            onPress={toggleDone}
            hitSlop={8}
            style={({ pressed }) => [
              styles.checkbox,
              {
                borderColor: done ? colors.primary : colors.border,
                backgroundColor: done ? colors.primary : 'transparent',
                opacity: pressed ? 0.7 : 1,
              },
            ]}
          >
            {done && <Feather name="check" size={14} color={colors.primaryForeground} />}
          </Pressable>
        )}
        <View style={{ flex: 1 }}>
          <Text
            style={[
              styles.cardContent,
              {
                color: done ? colors.mutedForeground : colors.foreground,
                textDecorationLine: done ? 'line-through' : 'none',
              },
            ]}
          >
            {entry.content}
          </Text>
          <Text style={[styles.cardDate, { color: colors.mutedForeground }]}>
            {formatDate(entry.createdAt)}
          </Text>
        </View>
      </View>
      <View style={styles.cardActions}>
        <Pressable
          testID={`to-inbox-${entry.id}`}
          onPress={backToInbox}
          hitSlop={8}
          style={({ pressed }) => [{ opacity: pressed ? 0.6 : 1 }]}
        >
          <Feather name="inbox" size={17} color={colors.mutedForeground} />
        </Pressable>
        <Pressable
          testID={`delete-cat-${entry.id}`}
          onPress={remove}
          hitSlop={8}
          style={({ pressed }) => [{ opacity: pressed ? 0.6 : 1 }]}
        >
          <Feather name="trash-2" size={17} color={colors.destructive} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  navRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingBottom: 6 },
  backButton: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 24, fontFamily: 'Outfit_600SemiBold', letterSpacing: -0.5 },
  subtitle: { fontSize: 13, fontFamily: 'Outfit_400Regular' },
  card: { borderRadius: 22, borderWidth: 1, padding: 16, marginBottom: 12 },
  cardRow: { flexDirection: 'row', gap: 12 },
  checkbox: { width: 24, height: 24, borderRadius: 8, borderWidth: 2, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  cardContent: { fontSize: 15, lineHeight: 22, fontFamily: 'Outfit_400Regular' },
  cardDate: { fontSize: 12, fontFamily: 'Outfit_500Medium', marginTop: 6 },
  cardActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 18, marginTop: 12 },
});
