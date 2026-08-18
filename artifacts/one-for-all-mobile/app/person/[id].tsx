import React from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Platform,
  Pressable,
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
  useGetPerson,
  useDeletePerson,
  getListPeopleQueryKey,
} from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { CATEGORY_META, formatDate, type Category } from '@/lib/app-utils';

export default function PersonDetailScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const personId = Number(id);

  const { data: person, isLoading, isError } = useGetPerson(personId);
  const deletePerson = useDeletePerson();

  const topPad = Platform.OS === 'web' ? 67 + 12 : insets.top + 12;

  const confirmDelete = () => {
    const doDelete = () => {
      deletePerson.mutate(
        { id: personId },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getListPeopleQueryKey() });
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            router.back();
          },
        },
      );
    };
    Alert.alert(
      'Delete person?',
      `This removes ${person?.name ?? 'this person'} and their links to entries. Entries themselves are kept.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: doDelete },
      ],
    );
  };

  if (isLoading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (isError || !person) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background, gap: 12 }]}>
        <Feather name="alert-circle" size={32} color={colors.mutedForeground} />
        <Text style={{ color: colors.foreground, fontFamily: 'Outfit_500Medium' }}>
          Couldn't load this person.
        </Text>
        <Pressable onPress={() => router.back()} style={({ pressed }) => [{ opacity: pressed ? 0.6 : 1 }]}>
          <Text style={{ color: colors.primary, fontFamily: 'Outfit_500Medium' }}>Go back</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={[styles.navRow, { paddingTop: topPad }]}>
        <Pressable
          testID="person-back"
          onPress={() => router.back()}
          hitSlop={12}
          style={({ pressed }) => [
            styles.backButton,
            { backgroundColor: colors.secondary, opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <Feather name="chevron-left" size={22} color={colors.foreground} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: colors.foreground }]}>{person.name}</Text>
          {!!person.descriptor && (
            <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
              {person.descriptor}
            </Text>
          )}
        </View>
        <Pressable
          testID="delete-person"
          onPress={confirmDelete}
          hitSlop={10}
          style={({ pressed }) => [{ opacity: pressed ? 0.6 : 1, padding: 6 }]}
        >
          <Feather name="trash-2" size={19} color={colors.destructive} />
        </Pressable>
      </View>

      <FlatList
        data={person.entries ?? []}
        keyExtractor={(item) => String(item.id)}
        scrollEnabled={(person.entries ?? []).length > 0}
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: 60, flexGrow: 1 }}
        ListHeaderComponent={
          <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>
            Mentioned in {person.entries?.length ?? 0}{' '}
            {(person.entries?.length ?? 0) === 1 ? 'entry' : 'entries'}
          </Text>
        }
        ListEmptyComponent={
          <View style={[styles.center, { paddingTop: 50, gap: 8 }]}>
            <Feather name="file-text" size={30} color={colors.mutedForeground} />
            <Text style={{ color: colors.mutedForeground, fontFamily: 'Outfit_400Regular' }}>
              No linked entries yet.
            </Text>
          </View>
        }
        renderItem={({ item }) => {
          const catKey = (item.category === 'inbox' ? 'journal' : item.category) as Category;
          const meta = CATEGORY_META[catKey];
          return (
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={styles.cardTopRow}>
                <View style={[styles.catChip, { backgroundColor: colors.secondary }]}>
                  <Feather name={meta.icon} size={12} color={colors.primary} />
                  <Text style={[styles.catChipText, { color: colors.secondaryForeground }]}>
                    {item.category === 'inbox' ? 'Inbox' : meta.title}
                  </Text>
                </View>
                <Text style={{ color: colors.mutedForeground, fontSize: 12, fontFamily: 'Outfit_500Medium' }}>
                  {formatDate(item.createdAt)}
                </Text>
              </View>
              <Text style={[styles.cardContent, { color: colors.foreground }]}>{item.content}</Text>
            </View>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  navRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingBottom: 6 },
  backButton: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 24, fontFamily: 'Outfit_600SemiBold', letterSpacing: -0.5 },
  subtitle: { fontSize: 13, fontFamily: 'Outfit_400Regular' },
  sectionLabel: { fontSize: 12, fontFamily: 'Outfit_600SemiBold', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12, paddingHorizontal: 4 },
  card: { borderRadius: 22, borderWidth: 1, padding: 16, marginBottom: 12 },
  cardTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  catChip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  catChipText: { fontSize: 11, fontFamily: 'Outfit_600SemiBold' },
  cardContent: { fontSize: 15, lineHeight: 22, fontFamily: 'Outfit_400Regular' },
});
