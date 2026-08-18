import React, { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
} from 'expo-audio';
import { useQueryClient } from '@tanstack/react-query';
import {
  useCreateEntry,
  useGetEntryStats,
  getGetEntryStatsQueryKey,
  getListEntriesQueryKey,
} from '@workspace/api-client-react';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { useColors } from '@/hooks/useColors';
import { apiUrl, getMockTranscript } from '@/lib/app-utils';

type Mode = 'idle' | 'recording' | 'transcribing' | 'editing' | 'text';

export default function CaptureScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [mode, setMode] = useState<Mode>('idle');
  const [content, setContent] = useState('');
  const [saveError, setSaveError] = useState(false);
  const submittingRef = useRef(false);
  const [isSaving, setIsSaving] = useState(false);

  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const createEntry = useCreateEntry();
  const { data: stats } = useGetEntryStats();

  const topPad = Platform.OS === 'web' ? 67 + 16 : insets.top + 16;

  // ── Recording (audio is discarded — transcript is mocked for now) ────────
  const startRecording = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setMode('recording');
    if (Platform.OS === 'web') return;
    try {
      const perm = await AudioModule.requestRecordingPermissionsAsync();
      if (!perm.granted) return;
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
    } catch (err) {
      console.warn('Recording unavailable, will use mock transcript', err);
    }
  };

  const stopRecording = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setMode('transcribing');
    try {
      if (recorder.isRecording) await recorder.stop();
      await setAudioModeAsync({ allowsRecording: false });
    } catch {
      // ignore — audio is discarded either way
    }
    setTimeout(() => {
      setContent(getMockTranscript());
      setMode('editing');
    }, 800);
  };

  // ── Save ──────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (submittingRef.current) return;
    if (!content.trim()) return;
    submittingRef.current = true;
    setIsSaving(true);
    setSaveError(false);
    try {
      const entry = await createEntry.mutateAsync({
        data: { content: content.trim(), captureType: mode === 'text' ? 'text' : 'voice' },
      });
      // Server-side AI categorization (non-fatal if it fails)
      try {
        await fetch(apiUrl(`/api/entries/${entry.id}/suggest-category`), { method: 'POST' });
      } catch (err) {
        console.warn('suggest-category failed (non-fatal)', err);
      }
      queryClient.invalidateQueries({ queryKey: getGetEntryStatsQueryKey() });
      queryClient.invalidateQueries({ queryKey: getListEntriesQueryKey({ category: 'inbox' }) });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setContent('');
      setMode('idle');
      setIsSaving(false);
      submittingRef.current = false;
      router.push('/(tabs)/inbox');
    } catch (err) {
      console.error('Save failed', err);
      setSaveError(true);
      setIsSaving(false);
      submittingRef.current = false;
    }
  };

  const cancelEditing = () => {
    setMode('idle');
    setContent('');
    setSaveError(false);
  };

  return (
    <KeyboardAwareScrollViewCompat
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={[styles.scroll, { paddingTop: topPad, paddingBottom: 120 }]}
      keyboardShouldPersistTaps="handled"
      bottomOffset={40}
    >
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.foreground }]}>Capture</Text>
        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
          What's on your mind?
        </Text>
      </View>

      {mode === 'idle' && (
        <View style={styles.centerBlock}>
          <Pressable
            testID="record-button"
            onPress={startRecording}
            style={({ pressed }) => [
              styles.micButton,
              { backgroundColor: colors.primary, transform: [{ scale: pressed ? 0.95 : 1 }] },
            ]}
          >
            <Feather name="mic" size={56} color={colors.primaryForeground} />
          </Pressable>

          <Pressable
            testID="write-instead"
            onPress={() => setMode('text')}
            style={({ pressed }) => [
              styles.writeButton,
              { backgroundColor: colors.secondary, opacity: pressed ? 0.8 : 1 },
            ]}
          >
            <Feather name="edit-3" size={18} color={colors.secondaryForeground} />
            <Text style={[styles.writeButtonText, { color: colors.secondaryForeground }]}>
              Write instead
            </Text>
          </Pressable>

          <View style={styles.statsRow}>
            {(
              [
                ['Journal', stats?.journal ?? 0],
                ['Tasks', stats?.task ?? 0],
                ['Ideas', stats?.idea ?? 0],
                ['Log', stats?.log ?? 0],
              ] as const
            ).map(([label, count]) => (
              <View key={label} style={styles.statItem}>
                <Text style={[styles.statCount, { color: colors.foreground }]}>{count}</Text>
                <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>{label}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {mode === 'recording' && (
        <View style={styles.centerBlock}>
          <View
            style={[
              styles.recordingHalo,
              { backgroundColor: `${colors.destructive}1A`, borderColor: `${colors.destructive}4D` },
            ]}
          >
            <Feather name="mic" size={40} color={colors.destructive} />
          </View>
          <Text style={[styles.listeningText, { color: colors.foreground }]}>Listening...</Text>
          <Pressable
            testID="stop-recording"
            onPress={stopRecording}
            style={({ pressed }) => [
              styles.stopButton,
              { backgroundColor: colors.foreground, transform: [{ scale: pressed ? 0.95 : 1 }] },
            ]}
          >
            <Feather name="square" size={28} color={colors.background} />
          </Pressable>
        </View>
      )}

      {mode === 'transcribing' && (
        <View style={styles.centerBlock}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={[styles.listeningText, { color: colors.mutedForeground }]}>
            Transcribing your thoughts...
          </Text>
        </View>
      )}

      {(mode === 'editing' || mode === 'text') && (
        <View style={styles.editBlock}>
          {mode === 'editing' && (
            <View style={[styles.badge, { backgroundColor: colors.secondary }]}>
              <Feather name="star" size={14} color={colors.primary} />
              <Text style={[styles.badgeText, { color: colors.secondaryForeground }]}>
                Mock transcript — edit if needed
              </Text>
            </View>
          )}

          <TextInput
            testID="capture-input"
            style={[
              styles.textInput,
              {
                backgroundColor: colors.card,
                color: colors.foreground,
                borderColor: colors.border,
              },
            ]}
            multiline
            autoFocus
            placeholder="Start typing..."
            placeholderTextColor={colors.mutedForeground}
            value={content}
            onChangeText={setContent}
            editable={!isSaving}
          />

          {saveError && (
            <View style={[styles.errorRow, { borderColor: `${colors.destructive}33` }]}>
              <Feather name="alert-circle" size={16} color={colors.destructive} />
              <Text style={{ color: colors.destructive, fontFamily: 'Outfit_500Medium' }}>
                Couldn't save — please try again.
              </Text>
            </View>
          )}

          <View style={styles.buttonRow}>
            <Pressable
              testID="cancel-capture"
              onPress={cancelEditing}
              disabled={isSaving}
              style={({ pressed }) => [styles.ghostButton, { opacity: pressed ? 0.6 : 1 }]}
            >
              <Text style={[styles.ghostButtonText, { color: colors.mutedForeground }]}>
                Cancel
              </Text>
            </Pressable>
            <Pressable
              testID="save-capture"
              onPress={handleSave}
              disabled={isSaving || !content.trim()}
              style={({ pressed }) => [
                styles.saveButton,
                {
                  backgroundColor: colors.primary,
                  opacity: isSaving || !content.trim() ? 0.5 : pressed ? 0.85 : 1,
                },
              ]}
            >
              {isSaving ? (
                <ActivityIndicator size="small" color={colors.primaryForeground} />
              ) : (
                <Text style={[styles.saveButtonText, { color: colors.primaryForeground }]}>
                  Save to Inbox
                </Text>
              )}
            </Pressable>
          </View>
        </View>
      )}
    </KeyboardAwareScrollViewCompat>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: 24, flexGrow: 1 },
  header: { marginBottom: 36 },
  title: { fontSize: 30, fontFamily: 'Outfit_600SemiBold', letterSpacing: -0.5 },
  subtitle: { fontSize: 16, fontFamily: 'Outfit_400Regular', marginTop: 4 },
  centerBlock: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 32 },
  micButton: {
    width: 152,
    height: 152,
    borderRadius: 76,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  writeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 28,
    height: 52,
    borderRadius: 26,
  },
  writeButtonText: { fontSize: 16, fontFamily: 'Outfit_500Medium' },
  statsRow: { flexDirection: 'row', gap: 28, marginTop: 12, opacity: 0.75 },
  statItem: { alignItems: 'center', gap: 2 },
  statCount: { fontSize: 20, fontFamily: 'Outfit_500Medium' },
  statLabel: {
    fontSize: 10,
    fontFamily: 'Outfit_600SemiBold',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  recordingHalo: {
    width: 96,
    height: 96,
    borderRadius: 48,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listeningText: { fontSize: 17, fontFamily: 'Outfit_500Medium' },
  stopButton: {
    width: 76,
    height: 76,
    borderRadius: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  editBlock: { gap: 14 },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 999,
  },
  badgeText: { fontSize: 13, fontFamily: 'Outfit_400Regular' },
  textInput: {
    minHeight: 180,
    borderRadius: 20,
    borderWidth: 1,
    padding: 18,
    fontSize: 17,
    lineHeight: 26,
    fontFamily: 'Outfit_400Regular',
    textAlignVertical: 'top',
  },
  errorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  buttonRow: { flexDirection: 'row', gap: 12 },
  ghostButton: { flex: 1, height: 54, borderRadius: 27, alignItems: 'center', justifyContent: 'center' },
  ghostButtonText: { fontSize: 16, fontFamily: 'Outfit_500Medium' },
  saveButton: { flex: 1, height: 54, borderRadius: 27, alignItems: 'center', justifyContent: 'center' },
  saveButtonText: { fontSize: 16, fontFamily: 'Outfit_600SemiBold' },
});
