import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useQueryClient } from '@tanstack/react-query';
import { useColors } from '@/hooks/useColors';
import { apiUrl } from '@/lib/app-utils';

interface AIStatus {
  transcription: { provider: string; active: boolean };
  categorization: { provider: string; active: boolean };
}

export default function SettingsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();

  const [aiStatus, setAiStatus] = useState<AIStatus | null>(null);
  const [aiStatusError, setAiStatusError] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isClearing, setIsClearing] = useState(false);

  const topPad = Platform.OS === 'web' ? 67 + 16 : insets.top + 16;

  useEffect(() => {
    fetch(apiUrl('/api/ai/status'))
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then(setAiStatus)
      .catch(() => setAiStatusError(true));
  }, []);

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const res = await fetch(apiUrl('/api/data/export'));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      await Share.share({
        title: 'One for All export',
        message: JSON.stringify(data, null, 2),
      });
    } catch (err) {
      console.error('Export failed', err);
      Alert.alert('Export failed', 'Please try again.');
    } finally {
      setIsExporting(false);
    }
  };

  const handleClearData = () => {
    Alert.alert(
      'Delete everything?',
      'Permanently deletes every entry, every person profile, and all associated data. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete all data',
          style: 'destructive',
          onPress: async () => {
            setIsClearing(true);
            try {
              const res = await fetch(apiUrl('/api/data/clear'), { method: 'POST' });
              if (!res.ok) throw new Error(`HTTP ${res.status}`);
              queryClient.clear();
              queryClient.invalidateQueries();
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            } catch (err) {
              console.error('Clear failed', err);
              Alert.alert('Something went wrong', 'Please try again.');
            } finally {
              setIsClearing(false);
            }
          },
        },
      ],
    );
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ paddingTop: topPad, paddingHorizontal: 16, paddingBottom: 120 }}
    >
      <Text style={[styles.title, { color: colors.foreground }]}>Settings</Text>

      {/* AI Processing */}
      <Section icon="star" title="AI Processing">
        {aiStatusError ? (
          <Text style={[styles.body, { color: colors.mutedForeground }]}>
            Could not load AI status.
          </Text>
        ) : aiStatus === null ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={[styles.body, { color: colors.mutedForeground }]}>Checking…</Text>
          </View>
        ) : (
          <View style={{ gap: 10 }}>
            <StatusRow
              label="Voice transcription"
              active={aiStatus.transcription.active}
              activeText="OpenAI Whisper — real transcription active"
              inactiveText="Using placeholder text for now"
            />
            <StatusRow
              label="Categorization"
              active={aiStatus.categorization.active}
              activeText="Real AI categorization active"
              inactiveText="Using keyword heuristics for now"
            />
          </View>
        )}
      </Section>

      {/* Voice recordings */}
      <Section icon="mic" title="Voice Recordings">
        <Text style={[styles.body, { color: colors.mutedForeground }]}>
          When you record audio, it is used for transcription (if configured) and then immediately
          discarded. <Text style={{ color: colors.foreground, fontFamily: 'Outfit_600SemiBold' }}>No audio is stored</Text> —
          only the resulting text is saved.
        </Text>
      </Section>

      {/* Privacy */}
      <Section icon="shield" title="Privacy">
        <Text style={[styles.body, { color: colors.mutedForeground }]}>
          <Text style={styles.bold(colors.foreground)}>What's stored: </Text>
          your text entries and optional notes about people you mention. Nothing else is collected.
          {'\n\n'}
          <Text style={styles.bold(colors.foreground)}>People profiles: </Text>
          created only by you, manually. The app never silently creates profiles.
          {'\n\n'}
          <Text style={styles.bold(colors.foreground)}>Your control: </Text>
          export all your data or delete everything below, at any time.
        </Text>
      </Section>

      {/* Export */}
      <Section icon="download" title="Export My Data">
        <Text style={[styles.body, { color: colors.mutedForeground, marginBottom: 14 }]}>
          Shares a complete JSON copy of all your entries, people, and their links.
        </Text>
        <Pressable
          testID="export-data"
          onPress={handleExport}
          disabled={isExporting}
          style={({ pressed }) => [
            styles.outlineButton,
            { borderColor: colors.border, opacity: isExporting ? 0.5 : pressed ? 0.7 : 1 },
          ]}
        >
          {isExporting ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <Feather name="share" size={16} color={colors.foreground} />
          )}
          <Text style={{ color: colors.foreground, fontFamily: 'Outfit_500Medium', fontSize: 15 }}>
            {isExporting ? 'Preparing…' : 'Export data'}
          </Text>
        </Pressable>
      </Section>

      {/* Danger zone */}
      <View
        style={[
          styles.section,
          { backgroundColor: `${useColorsStatic(colors.destructive)}0D`, borderColor: `${colors.destructive}33` },
        ]}
      >
        <View style={styles.sectionHeader}>
          <Feather name="alert-triangle" size={18} color={colors.destructive} />
          <Text style={[styles.sectionTitle, { color: colors.destructive }]}>Danger Zone</Text>
        </View>
        <Text style={[styles.body, { color: colors.mutedForeground, marginBottom: 14 }]}>
          Permanently deletes every entry, person profile, and all associated data. This cannot be
          undone. Export first if you want a copy.
        </Text>
        <Pressable
          testID="clear-data"
          onPress={handleClearData}
          disabled={isClearing}
          style={({ pressed }) => [
            styles.dangerButton,
            { backgroundColor: colors.destructive, opacity: isClearing ? 0.5 : pressed ? 0.85 : 1 },
          ]}
        >
          {isClearing ? (
            <ActivityIndicator size="small" color={colors.destructiveForeground} />
          ) : (
            <Feather name="trash-2" size={16} color={colors.destructiveForeground} />
          )}
          <Text style={{ color: colors.destructiveForeground, fontFamily: 'Outfit_600SemiBold', fontSize: 15 }}>
            Delete all data
          </Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

// helper — hex passthrough (keeps style expression readable)
function useColorsStatic(hex: string) {
  return hex;
}

function Section({
  icon,
  title,
  children,
}: {
  icon: React.ComponentProps<typeof Feather>['name'];
  title: string;
  children: React.ReactNode;
}) {
  const colors = useColors();
  return (
    <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.sectionHeader}>
        <Feather name={icon} size={18} color={colors.primary} />
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>{title}</Text>
      </View>
      {children}
    </View>
  );
}

function StatusRow({
  label,
  active,
  activeText,
  inactiveText,
}: {
  label: string;
  active: boolean;
  activeText: string;
  inactiveText: string;
}) {
  const colors = useColors();
  return (
    <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
      <Feather
        name={active ? 'check-circle' : 'x-circle'}
        size={15}
        color={active ? colors.primary : colors.mutedForeground}
        style={{ marginTop: 2 }}
      />
      <Text style={[styles.body, { color: colors.mutedForeground, flex: 1 }]}>
        <Text style={{ color: colors.foreground, fontFamily: 'Outfit_600SemiBold' }}>{label}: </Text>
        {active ? activeText : inactiveText}
      </Text>
    </View>
  );
}

const styles = {
  ...StyleSheet.create({
    title: { fontSize: 30, fontFamily: 'Outfit_600SemiBold', letterSpacing: -0.5, marginBottom: 20, paddingHorizontal: 4 },
    section: { borderRadius: 24, borderWidth: 1, padding: 18, marginBottom: 14 },
    sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
    sectionTitle: { fontSize: 16, fontFamily: 'Outfit_600SemiBold' },
    body: { fontSize: 14, lineHeight: 21, fontFamily: 'Outfit_400Regular' },
    outlineButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 48, borderRadius: 24, borderWidth: 1 },
    dangerButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 48, borderRadius: 24 },
  }),
  bold: (color: string) => ({ color, fontFamily: 'Outfit_600SemiBold' as const }),
};
