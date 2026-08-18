import React, { useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useQueryClient } from '@tanstack/react-query';
import {
  useListEntries,
  useUpdateEntry,
  useDeleteEntry,
  useListPeople,
  useCreatePerson,
  useLinkPersonToEntry,
  getListEntriesQueryKey,
  getGetEntryStatsQueryKey,
  getListPeopleQueryKey,
  type Entry,
} from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { CATEGORIES, CATEGORY_META, formatDate, type Category } from '@/lib/app-utils';

export default function InboxScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { data: entries, isLoading, isError, refetch, isRefetching } = useListEntries({
    category: 'inbox',
  });

  const topPad = Platform.OS === 'web' ? 67 + 16 : insets.top + 16;

  if (isLoading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (isError) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background, gap: 14, padding: 32 }]}>
        <Feather name="alert-circle" size={36} color={colors.mutedForeground} />
        <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
          Couldn't load your Inbox
        </Text>
        <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
          Check your connection and try again.
        </Text>
        <Pressable
          testID="inbox-retry"
          onPress={() => refetch()}
          style={({ pressed }) => [
            styles.retryButton,
            { borderColor: colors.border, opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <Text style={{ color: colors.foreground, fontFamily: 'Outfit_500Medium' }}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <FlatList
        data={entries ?? []}
        keyExtractor={(item) => String(item.id)}
        scrollEnabled={(entries ?? []).length > 0}
        contentContainerStyle={{
          paddingTop: topPad,
          paddingHorizontal: 16,
          paddingBottom: 120,
          flexGrow: 1,
        }}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />
        }
        ListHeaderComponent={
          <View style={styles.header}>
            <Text style={[styles.title, { color: colors.foreground }]}>Inbox</Text>
            <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
              Process your recent captures
            </Text>
          </View>
        }
        ListEmptyComponent={
          <View style={[styles.center, { gap: 10, paddingTop: 60 }]}>
            <View style={[styles.emptyCircle, { backgroundColor: colors.secondary }]}>
              <Feather name="check" size={34} color={colors.mutedForeground} />
            </View>
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Inbox Zero</Text>
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
              You're all caught up. Take a deep breath.
            </Text>
          </View>
        }
        renderItem={({ item }) => <InboxCard entry={item} />}
      />
    </View>
  );
}

// ── InboxCard ───────────────────────────────────────────────────────────────

function InboxCard({ entry }: { entry: Entry }) {
  const colors = useColors();
  const queryClient = useQueryClient();
  const updateEntry = useUpdateEntry();
  const deleteEntry = useDeleteEntry();
  const [showAllCats, setShowAllCats] = useState(false);
  const [personModal, setPersonModal] = useState(false);

  const suggested = (entry.suggestedCategory ?? 'journal') as Category;
  const meta = CATEGORY_META[suggested];

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getListEntriesQueryKey({ category: 'inbox' }) });
    queryClient.invalidateQueries({ queryKey: getGetEntryStatsQueryKey() });
  };

  const processAs = (category: Category) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    updateEntry.mutate(
      { id: entry.id, data: { category } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListEntriesQueryKey({ category }) });
          invalidate();
        },
      },
    );
  };

  const remove = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    deleteEntry.mutate({ id: entry.id }, { onSuccess: invalidate });
  };

  const busy = updateEntry.isPending || deleteEntry.isPending;

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.cardTopRow}>
        <Text style={[styles.cardDate, { color: colors.mutedForeground }]}>
          {formatDate(entry.createdAt)}
        </Text>
        <View style={[styles.typeChip, { backgroundColor: colors.secondary }]}>
          <Feather
            name={entry.captureType === 'voice' ? 'mic' : 'edit-3'}
            size={11}
            color={colors.mutedForeground}
          />
          <Text style={[styles.typeChipText, { color: colors.mutedForeground }]}>
            {entry.captureType}
          </Text>
        </View>
      </View>

      <Text style={[styles.cardContent, { color: colors.foreground }]}>{entry.content}</Text>

      {!showAllCats ? (
        <View style={styles.actionRow}>
          <Pressable
            testID={`accept-${entry.id}`}
            disabled={busy}
            onPress={() => processAs(suggested)}
            style={({ pressed }) => [
              styles.acceptButton,
              { backgroundColor: colors.primary, opacity: busy ? 0.5 : pressed ? 0.85 : 1 },
            ]}
          >
            <Feather name={meta.icon} size={16} color={colors.primaryForeground} />
            <Text style={[styles.acceptText, { color: colors.primaryForeground }]}>
              {meta.title}
            </Text>
          </Pressable>
          <IconAction icon="grid" onPress={() => setShowAllCats(true)} testID={`change-${entry.id}`} />
          <IconAction icon="user-plus" onPress={() => setPersonModal(true)} testID={`link-${entry.id}`} />
          <IconAction icon="trash-2" onPress={remove} destructive testID={`delete-${entry.id}`} />
        </View>
      ) : (
        <View>
          <View style={styles.catGrid}>
            {CATEGORIES.map((cat) => (
              <Pressable
                key={cat.key}
                testID={`cat-${cat.key}-${entry.id}`}
                disabled={busy}
                onPress={() => processAs(cat.key)}
                style={({ pressed }) => [
                  styles.catButton,
                  {
                    backgroundColor: cat.key === suggested ? colors.primary : colors.secondary,
                    opacity: pressed ? 0.8 : 1,
                  },
                ]}
              >
                <Feather
                  name={cat.icon}
                  size={15}
                  color={cat.key === suggested ? colors.primaryForeground : colors.secondaryForeground}
                />
                <Text
                  style={[
                    styles.catButtonText,
                    { color: cat.key === suggested ? colors.primaryForeground : colors.secondaryForeground },
                  ]}
                >
                  {cat.title}
                </Text>
              </Pressable>
            ))}
          </View>
          <Pressable
            onPress={() => setShowAllCats(false)}
            style={({ pressed }) => [{ opacity: pressed ? 0.6 : 1, alignSelf: 'center', padding: 8 }]}
          >
            <Text style={{ color: colors.mutedForeground, fontFamily: 'Outfit_500Medium' }}>
              Cancel
            </Text>
          </Pressable>
        </View>
      )}

      <LinkPersonModal
        visible={personModal}
        onClose={() => setPersonModal(false)}
        entryId={entry.id}
      />
    </View>
  );
}

function IconAction({
  icon,
  onPress,
  destructive,
  testID,
}: {
  icon: React.ComponentProps<typeof Feather>['name'];
  onPress: () => void;
  destructive?: boolean;
  testID?: string;
}) {
  const colors = useColors();
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      style={({ pressed }) => [
        styles.iconAction,
        { backgroundColor: colors.secondary, opacity: pressed ? 0.7 : 1 },
      ]}
    >
      <Feather
        name={icon}
        size={17}
        color={destructive ? colors.destructive : colors.secondaryForeground}
      />
    </Pressable>
  );
}

// ── Link person modal ──────────────────────────────────────────────────────

export function LinkPersonModal({
  visible,
  onClose,
  entryId,
}: {
  visible: boolean;
  onClose: () => void;
  entryId: number;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { data: people } = useListPeople();
  const createPerson = useCreatePerson();
  const linkPerson = useLinkPersonToEntry();
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);

  const filtered = (people ?? []).filter((p) =>
    p.name.toLowerCase().includes(search.trim().toLowerCase()),
  );
  const exactMatch = filtered.some((p) => p.name.toLowerCase() === search.trim().toLowerCase());

  const linkExisting = async (personId: number) => {
    setBusy(true);
    try {
      await linkPerson.mutateAsync({ id: entryId, data: { personId } });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setSearch('');
      onClose();
    } catch (err) {
      console.error('Failed to link person', err);
    } finally {
      setBusy(false);
    }
  };

  const createAndLink = async () => {
    const name = search.trim();
    if (!name) return;
    setBusy(true);
    try {
      const person = await createPerson.mutateAsync({ data: { name } });
      queryClient.invalidateQueries({ queryKey: getListPeopleQueryKey() });
      await linkPerson.mutateAsync({ id: entryId, data: { personId: person.id } });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setSearch('');
      onClose();
    } catch (err) {
      console.error('Failed to create & link person', err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.modalBackdrop} onPress={onClose} />
      <View
        style={[
          styles.modalSheet,
          {
            backgroundColor: colors.background,
            paddingBottom: Platform.OS === 'web' ? 34 : Math.max(insets.bottom, 16),
          },
        ]}
      >
        <View style={styles.modalHeader}>
          <Text style={[styles.modalTitle, { color: colors.foreground }]}>Link a person</Text>
          <Pressable onPress={onClose} hitSlop={12}>
            <Feather name="x" size={22} color={colors.mutedForeground} />
          </Pressable>
        </View>

        <TextInput
          testID="person-search"
          style={[
            styles.searchInput,
            { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground },
          ]}
          placeholder="Search or type a new name..."
          placeholderTextColor={colors.mutedForeground}
          value={search}
          onChangeText={setSearch}
          editable={!busy}
        />

        <View style={{ gap: 8, maxHeight: 260 }}>
          {filtered.slice(0, 6).map((p) => (
            <Pressable
              key={p.id}
              testID={`person-option-${p.id}`}
              disabled={busy}
              onPress={() => linkExisting(p.id)}
              style={({ pressed }) => [
                styles.personRow,
                { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.7 : 1 },
              ]}
            >
              <View style={[styles.avatar, { backgroundColor: colors.secondary }]}>
                <Text style={{ color: colors.foreground, fontFamily: 'Outfit_600SemiBold' }}>
                  {p.name.charAt(0).toUpperCase()}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.foreground, fontFamily: 'Outfit_500Medium', fontSize: 15 }}>
                  {p.name}
                </Text>
                {!!p.descriptor && (
                  <Text style={{ color: colors.mutedForeground, fontSize: 12, fontFamily: 'Outfit_400Regular' }}>
                    {p.descriptor}
                  </Text>
                )}
              </View>
              <Feather name="link" size={16} color={colors.mutedForeground} />
            </Pressable>
          ))}

          {search.trim().length > 1 && !exactMatch && (
            <Pressable
              testID="create-person-inline"
              disabled={busy}
              onPress={createAndLink}
              style={({ pressed }) => [
                styles.personRow,
                { backgroundColor: colors.secondary, borderColor: colors.border, opacity: pressed ? 0.7 : 1 },
              ]}
            >
              {busy ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <Feather name="user-plus" size={18} color={colors.primary} />
              )}
              <Text style={{ color: colors.foreground, fontFamily: 'Outfit_500Medium', flex: 1 }}>
                Add "{search.trim()}" as a new person
              </Text>
            </Pressable>
          )}

          {filtered.length === 0 && search.trim().length <= 1 && (
            <Text style={{ color: colors.mutedForeground, textAlign: 'center', padding: 16, fontFamily: 'Outfit_400Regular' }}>
              Type a name to search or create someone new.
            </Text>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { marginBottom: 20, paddingHorizontal: 4 },
  title: { fontSize: 30, fontFamily: 'Outfit_600SemiBold', letterSpacing: -0.5 },
  subtitle: { fontSize: 16, fontFamily: 'Outfit_400Regular', marginTop: 4 },
  emptyCircle: { width: 88, height: 88, borderRadius: 44, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  emptyTitle: { fontSize: 20, fontFamily: 'Outfit_600SemiBold' },
  emptyText: { fontSize: 15, fontFamily: 'Outfit_400Regular', textAlign: 'center' },
  retryButton: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 24, paddingVertical: 10, marginTop: 6 },
  card: { borderRadius: 24, borderWidth: 1, padding: 18, marginBottom: 14 },
  cardTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  cardDate: { fontSize: 12, fontFamily: 'Outfit_500Medium' },
  typeChip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999 },
  typeChipText: { fontSize: 10, fontFamily: 'Outfit_600SemiBold', textTransform: 'uppercase', letterSpacing: 1 },
  cardContent: { fontSize: 16, lineHeight: 24, fontFamily: 'Outfit_400Regular', marginBottom: 16 },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  acceptButton: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, height: 44, borderRadius: 22 },
  acceptText: { fontSize: 14, fontFamily: 'Outfit_600SemiBold' },
  iconAction: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  catGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 6 },
  catButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, height: 42, borderRadius: 21, flexBasis: '48%', flexGrow: 1 },
  catButtonText: { fontSize: 14, fontFamily: 'Outfit_500Medium' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  modalSheet: { borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 20, gap: 14 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  modalTitle: { fontSize: 19, fontFamily: 'Outfit_600SemiBold' },
  searchInput: { borderWidth: 1, borderRadius: 16, paddingHorizontal: 16, height: 48, fontSize: 15, fontFamily: 'Outfit_400Regular' },
  personRow: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderRadius: 16, padding: 12 },
  avatar: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
});
