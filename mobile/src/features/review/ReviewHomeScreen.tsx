import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  borders,
  colors,
  controls,
  radius,
  spacing,
  typography,
} from '../../theme/tokens.js';
import {
  AnimatedProgressBar,
  CSCButton,
  CSCChipBadge,
  ContentCard,
} from '../../components/CorePrimitives.js';
import {
  QuestionRepository,
  TopicSummary,
} from '../../application/ports/question_repository.js';
import {
  LocalLlmPort,
  ModelRuntimeStatus,
} from '../../application/ports/local_llm_port.js';

export type StudyMode = 'all' | 'unanswered' | 'weak_areas';

export interface ReviewHomeScreenProps {
  topicSummaries: TopicSummary[];
  selectedMode: StudyMode;
  modelStatus: ModelRuntimeStatus;
  isLoading?: boolean;
  onSelectMode: (mode: StudyMode) => void;
  onStartSession: (topicId?: string, mode?: StudyMode) => void;
  onRefresh?: () => void;
}

/**
 * Main Civil Service Reviewer Home Dashboard Screen.
 * Displays overall study progress, study mode selector, topic cards,
 * and offline AI model readiness status.
 */
export function ReviewHomeScreen({
  topicSummaries,
  selectedMode,
  modelStatus,
  isLoading = false,
  onSelectMode,
  onStartSession,
  onRefresh,
}: ReviewHomeScreenProps) {
  const totalQuestions = topicSummaries.reduce(
    (sum, t) => sum + t.totalQuestions,
    0
  );
  const totalAnswered = topicSummaries.reduce(
    (sum, t) => sum + t.answeredCount,
    0
  );
  const totalCorrect = topicSummaries.reduce(
    (sum, t) => sum + t.correctCount,
    0
  );
  const overallAccuracy =
    totalAnswered > 0 ? Math.round((totalCorrect / totalAnswered) * 100) : 0;

  const getModelBadgeVariant = () => {
    switch (modelStatus.state) {
      case 'ready':
      case 'loaded':
        return 'success' as const;
      case 'verifying':
      case 'loading':
        return 'warning' as const;
      case 'generating':
        return 'brand' as const;
      case 'missing':
      default:
        return 'neutral' as const;
    }
  };

  const getModelBadgeLabel = () => {
    switch (modelStatus.state) {
      case 'ready':
      case 'loaded':
        return 'Offline AI: Ready';
      case 'verifying':
        return 'Offline AI: Verifying Hash';
      case 'loading':
        return 'Offline AI: Loading weights';
      case 'generating':
        return 'Offline AI: Active';
      case 'missing':
      default:
        return 'Offline AI: Not Installed';
    }
  };

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.contentContainer}
    >
      {/* 1. Header & AI Model Readiness Pill */}
      <View style={styles.headerRow}>
        <View style={styles.headerTitles}>
          <Text style={styles.appTitle}>Civil Service Reviewer</Text>
          <Text style={styles.appSubtitle}>Philippine Civil Service Exam</Text>
        </View>
        <CSCChipBadge
          label={getModelBadgeLabel()}
          variant={getModelBadgeVariant()}
          indicatorDot
        />
      </View>

      {/* 2. Overall Progress Overview Card */}
      <ContentCard style={styles.overviewCard}>
        <View style={styles.overviewHeader}>
          <Text style={styles.sectionTitle}>Overall Progress</Text>
          <Text style={styles.accuracyLabel}>
            {totalAnswered > 0 ? `${overallAccuracy}% Accuracy` : 'Not Started'}
          </Text>
        </View>

        <AnimatedProgressBar
          current={totalAnswered}
          total={totalQuestions || 1}
          height={8}
        />

        <View style={styles.statsRow}>
          <View style={styles.statCol}>
            <Text style={styles.statValue}>{totalQuestions}</Text>
            <Text style={styles.statDescription}>Total Questions</Text>
          </View>
          <View style={styles.statCol}>
            <Text style={styles.statValue}>{totalAnswered}</Text>
            <Text style={styles.statDescription}>Answered</Text>
          </View>
          <View style={styles.statCol}>
            <Text style={styles.statValue}>{totalCorrect}</Text>
            <Text style={styles.statDescription}>Correct</Text>
          </View>
        </View>
      </ContentCard>

      {/* 3. Study Mode Selector */}
      <View style={styles.modeSection}>
        <Text style={styles.modeSectionTitle}>Study Mode</Text>
        <View style={styles.modeButtonGroup}>
          {(['all', 'unanswered', 'weak_areas'] as const).map((mode) => {
            const isSelected = selectedMode === mode;
            const label =
              mode === 'all'
                ? 'All Questions'
                : mode === 'unanswered'
                ? 'Unanswered'
                : 'Weak Areas';

            return (
              <Pressable
                key={mode}
                accessibilityRole="button"
                accessibilityState={{ selected: isSelected }}
                onPress={() => onSelectMode(mode)}
                style={[
                  styles.modeButton,
                  isSelected && styles.modeButtonSelected,
                ]}
              >
                <Text
                  style={[
                    styles.modeButtonText,
                    isSelected && styles.modeButtonTextSelected,
                  ]}
                >
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <CSCButton
          title="Start Comprehensive Review"
          variant="primary"
          onPress={() => onStartSession(undefined, selectedMode)}
          style={styles.quickStartButton}
        />
      </View>

      {/* 4. Topics Breakdown Cards */}
      <View style={styles.topicsSection}>
        <Text style={styles.topicsSectionTitle}>Topics & Subject Areas</Text>

        {isLoading && topicSummaries.length === 0 ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="small" color={colors.brand.primary} />
            <Text style={styles.loadingText}>Loading study topics...</Text>
          </View>
        ) : (
          topicSummaries.map((summary, idx) => {
            const topicAccuracy =
              summary.answeredCount > 0
                ? Math.round((summary.correctCount / summary.answeredCount) * 100)
                : null;

            return (
              <ContentCard
                key={summary.topic.id}
                delayMs={idx * 40}
                style={styles.topicCard}
              >
                <View style={styles.topicHeader}>
                  <Text style={styles.topicTitle}>{summary.topic.title}</Text>
                  {topicAccuracy !== null && (
                    <CSCChipBadge
                      label={`${topicAccuracy}%`}
                      variant={topicAccuracy >= 75 ? 'success' : 'warning'}
                    />
                  )}
                </View>

                <View style={styles.topicProgressContainer}>
                  <View style={styles.topicProgressMeta}>
                    <Text style={styles.topicProgressText}>
                      {summary.answeredCount} of {summary.totalQuestions} answered
                    </Text>
                  </View>
                  <AnimatedProgressBar
                    current={summary.answeredCount}
                    total={summary.totalQuestions || 1}
                    height={6}
                  />
                </View>

                <CSCButton
                  title="Practice Topic"
                  variant="secondary"
                  onPress={() => onStartSession(summary.topic.id, selectedMode)}
                  style={styles.topicPracticeButton}
                />
              </ContentCard>
            );
          })
        )}
      </View>
    </ScrollView>
  );
}

export interface ConnectedReviewHomeScreenProps {
  repository: QuestionRepository;
  llmPort?: LocalLlmPort;
  onStartSession: (topicId?: string, mode?: StudyMode) => void;
}

/**
 * Connected Container for ReviewHomeScreen.
 * Fetches topic summaries from QuestionRepository and monitors Local LLM status.
 */
export function ConnectedReviewHomeScreen({
  repository,
  llmPort,
  onStartSession,
}: ConnectedReviewHomeScreenProps) {
  const [topicSummaries, setTopicSummaries] = useState<TopicSummary[]>([]);
  const [selectedMode, setSelectedMode] = useState<StudyMode>('all');
  const [modelStatus, setModelStatus] = useState<ModelRuntimeStatus>({
    state: 'missing',
  });
  const [isLoading, setIsLoading] = useState(true);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const summaries = await repository.getTopicSummaries();
      setTopicSummaries(summaries);

      if (llmPort) {
        const status = await llmPort.getStatus();
        setModelStatus(status);
      }
    } catch {
      // Fallback empty data
    } finally {
      setIsLoading(false);
    }
  }, [repository, llmPort]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  return (
    <ReviewHomeScreen
      topicSummaries={topicSummaries}
      selectedMode={selectedMode}
      modelStatus={modelStatus}
      isLoading={isLoading}
      onSelectMode={setSelectedMode}
      onStartSession={onStartSession}
      onRefresh={loadData}
    />
  );
}

/**
 * Reusable alias matching architectural Pattern C.
 */
export const HomeDashboardScreen = ConnectedReviewHomeScreen;

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.neutral.surface,
  },
  contentContainer: {
    padding: spacing.base,
    paddingBottom: spacing.section,
    gap: spacing.lg,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
  },
  headerTitles: {
    flex: 1,
  },
  appTitle: {
    fontSize: typography.title2.fontSize,
    fontWeight: '700',
    color: colors.brand.primary,
  },
  appSubtitle: {
    fontSize: typography.footnote.fontSize,
    color: colors.neutral.textSecondary,
    marginTop: spacing.xs,
  },
  overviewCard: {
    gap: spacing.md,
  },
  overviewHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sectionTitle: {
    fontSize: typography.headline.fontSize,
    fontWeight: '600',
    color: colors.neutral.textPrimary,
  },
  accuracyLabel: {
    fontSize: typography.subheadline.fontSize,
    fontWeight: '600',
    color: colors.brand.primary,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: spacing.xs,
  },
  statCol: {
    alignItems: 'center',
    flex: 1,
  },
  statValue: {
    fontSize: typography.title2.fontSize,
    fontWeight: '700',
    color: colors.neutral.textPrimary,
  },
  statDescription: {
    fontSize: typography.caption.fontSize,
    color: colors.neutral.textSecondary,
    marginTop: spacing.xs,
  },
  modeSection: {
    gap: spacing.sm,
  },
  modeSectionTitle: {
    fontSize: typography.subheadline.fontSize,
    fontWeight: '600',
    color: colors.neutral.textPrimary,
  },
  modeButtonGroup: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  modeButton: {
    flex: 1,
    minHeight: controls.minTouchTarget,
    borderRadius: radius.md,
    borderWidth: borders.hairline,
    borderColor: colors.neutral.borderDefault,
    backgroundColor: colors.neutral.surfaceElevated,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  modeButtonSelected: {
    backgroundColor: colors.brand.tint,
    borderColor: colors.brand.primary,
    borderWidth: borders.emphasized,
  },
  modeButtonText: {
    fontSize: typography.footnote.fontSize,
    fontWeight: '500',
    color: colors.neutral.textPrimary,
  },
  modeButtonTextSelected: {
    fontWeight: '600',
    color: colors.brand.primary,
  },
  quickStartButton: {
    marginTop: spacing.xs,
  },
  topicsSection: {
    gap: spacing.md,
  },
  topicsSectionTitle: {
    fontSize: typography.headline.fontSize,
    fontWeight: '600',
    color: colors.neutral.textPrimary,
  },
  topicCard: {
    gap: spacing.sm,
  },
  topicHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  topicTitle: {
    fontSize: typography.headline.fontSize,
    fontWeight: '600',
    color: colors.neutral.textPrimary,
    flex: 1,
    marginRight: spacing.sm,
  },
  topicDescription: {
    fontSize: typography.footnote.fontSize,
    color: colors.neutral.textSecondary,
    lineHeight: typography.footnote.lineHeight,
  },
  topicProgressContainer: {
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  topicProgressMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  topicProgressText: {
    fontSize: typography.caption.fontSize,
    color: colors.neutral.textSecondary,
  },
  topicPracticeButton: {
    marginTop: spacing.xs,
  },
  loadingContainer: {
    padding: spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  loadingText: {
    fontSize: typography.subheadline.fontSize,
    color: colors.neutral.textSecondary,
  },
});
