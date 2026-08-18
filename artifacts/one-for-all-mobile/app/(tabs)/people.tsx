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
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useQueryClient } from '@tanstack/react-query';
import {
  useListPeople,
  useCreatePerson,
  getListPeopleQueryKey,
} from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';

export default function PeopleScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: people, isLoading, refetch, isRefetching } = useListPeople();
  const createPerson = useCreatePerson();

  const [addOpen, setAddOpen] = useState(false);
  const [name, setName] = useState('');
  const [descriptor, setDescriptor] = useState('');
  const [saving, setSaving] = useState(false);

  const topPad = Platform.OS === 'web' ? 67 + 16 : insets.top + 16;

  const handleCreate = async () => {
    const trimmed = name.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    try {
      await createPerson.mutateAsync({
        data: { name: trimmed, ...(descriptor.trim() ? { descriptor: descriptor.trim() } : {}) },
      });
      queryClient.invalidateQueries({ queryKey: getListPeopleQueryKey() });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setName('');
      setDescriptor('');
      setAddOpen(false);
    } catch (err) {
      console.error('Failed to create person', err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={people ?? []}
          keyExtractor={(item) => String(item.id)}
          scrollEnabled={(people ?? []).length > 0}
          contentContainerStyle={{ paddingTop: topPad, paddingHorizontal: 16, paddingBottom: 140, flexGrow: 1 }}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />
          }
          ListHeaderComponent={
            <View style={styles.headerRow}>
              <View>
                <Text style={[styles.title, { color: colors.foreground }]}>People</Text>
                <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
                  Everyone you've mentioned
                </Text>
              </View>
              <Pressable
                testID="add-person"
                onPress={() => setAddOpen(true)}
                style={({ pressed }) => [
                  styles.addButton,
                  { backgroundColor: colors.primary, transform: [{ scale: pressed ? 0.94 : 1 }] },
                ]}
              >
                <Feather name="plus" size={22} color={colors.primaryForeground} />
              </Pressable>
            </View>
          }
          ListEmptyComponent={
            <View style={[styles.center, { paddingTop: 70, gap: 10 }]}>
              <Feather name="users" size={34} color={colors.mutedForeground} />
              <Text style={{ color: colors.foreground, fontSize: 17, fontFamily: 'Outfit_600SemiBold' }}>
                No people yet
              </Text>
              <Text style={{ color: colors.mutedForeground, fontSize: 14, fontFamily: 'Outfit_400Regular', textAlign: 'center' }}>
                Add people to link them to your captures.
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <Pressable
              testID={`person-${item.id}`}
              onPress={() => router.push(`/person/${item.id}`)}
              style={({ pressed }) => [
                styles.personCard,
                { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.75 : 1 },
              ]}
            >
              <View style={[styles.avatar, { backgroundColor: colors.secondary }]}>
                <Text style={{ color: colors.foreground, fontFamily: 'Outfit_600SemiBold', fontSize: 17 }}>
                  {item.name.charAt(0).toUpperCase()}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.foreground, fontFamily: 'Outfit_500Medium', fontSize: 16 }}>
                  {item.name}
                </Text>
                {!!item.descriptor && (
                  <Text style={{ color: colors.mutedForeground, fontSize: 13, fontFamily: 'Outfit_400Regular' }}>
                    {item.descriptor}
                  </Text>
                )}
              </View>
              <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
            </Pressable>
          )}
        />
      )}

      <Modal visible={addOpen} animationType="slide" transparent onRequestClose={() => setAddOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setAddOpen(false)} />
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: colors.background,
              paddingBottom: Platform.OS === 'web' ? 34 : Math.max(insets.bottom, 16),
            },
          ]}
        >
          <View style={styles.sheetHeader}>
            <Text style={[styles.sheetTitle, { color: colors.foreground }]}>New person</Text>
            <Pressable onPress={() => setAddOpen(false)} hitSlop={12}>
              <Feather name="x" size={22} color={colors.mutedForeground} />
            </Pressable>
          </View>
          <TextInput
            testID="new-person-name"
            style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
            placeholder="Name"
            placeholderTextColor={colors.mutedForeground}
            value={name}
            onChangeText={setName}
            autoFocus
            editable={!saving}
          />
          <TextInput
            testID="new-person-descriptor"
            style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
            placeholder='Descriptor (optional) — e.g. "climbing gym"'
            placeholderTextColor={colors.mutedForeground}
            value={descriptor}
            onChangeText={setDescriptor}
            editable={!saving}
          />
          <Pressable
            testID="save-person"
            onPress={handleCreate}
            disabled={saving || !name.trim()}
            style={({ pressed }) => [
              styles.saveButton,
              { backgroundColor: colors.primary, opacity: saving || !name.trim() ? 0.5 : pressed ? 0.85 : 1 },
            ]}
          >
            {saving ? (
              <ActivityIndicator size="small" color={colors.primaryForeground} />
            ) : (
              <Text style={{ color: colors.primaryForeground, fontFamily: 'Outfit_600SemiBold', fontSize: 16 }}>
                Add person
              </Text>
            )}
          </Pressable>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, paddingHorizontal: 4 },
  title: { fontSize: 30, fontFamily: 'Outfit_600SemiBold', letterSpacing: -0.5 },
  subtitle: { fontSize: 16, fontFamily: 'Outfit_400Regular', marginTop: 4 },
  addButton: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  personCard: { flexDirection: 'row', alignItems: 'center', gap: 14, borderRadius: 22, borderWidth: 1, padding: 14, marginBottom: 10 },
  avatar: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: { borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 20, gap: 12 },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  sheetTitle: { fontSize: 19, fontFamily: 'Outfit_600SemiBold' },
  input: { borderWidth: 1, borderRadius: 16, paddingHorizontal: 16, height: 50, fontSize: 15, fontFamily: 'Outfit_400Regular' },
  saveButton: { height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
});
