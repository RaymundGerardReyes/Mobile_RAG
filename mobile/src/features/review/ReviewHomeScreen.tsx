import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
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
  EmptyState,
  ScreenContainer,
  SectionHeader,
  SubjectRow,
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
export type SessionFormat = 'quiz' | 'flashcards';

export interface ReviewHomeScreenProps {
  topicSummaries: TopicSummary[];
  selectedMode: StudyMode;
  modelStatus: ModelRuntimeStatus;
  isLoading?: boolean;
  onSelectMode: (mode: StudyMode) => void;
  onStartSession: (
    topicId?: string,
    mode?: StudyMode,
    format?: SessionFormat
  ) => void;
  onRefresh?: () => void;
}

/**
 * Editorial, content-first Home / Today's Study Screen for iPhone 16.
 * Prioritizes starting a study session and selecting a subject over dashboard widgets.
 */
export function ReviewHomeScreen({
  topicSummaries,
  selectedMode,
  modelStatus,
  isLoading = false,
  onSelectMode,
  onStartSession,
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
  const remainingQuestions = Math.max(totalQuestions - totalAnswered, 0);

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
        return 'Offline AI Ready';
      case 'verifying':
        return 'Verifying Model';
      case 'loading':
        return 'Loading Model';
      case 'generating':
        return 'AI Active';
      case 'missing':
      default:
        return 'Rule-Based Mode';
    }
  };

  return (
    <ScreenContainer>
      {/* 1. Editorial Page Heading & Restrained Status Pill */}
      <View style={styles.pageHeader}>
        <View style={styles.headerTitleBlock}>
          <Text style={styles.overline}>PHILIPPINE CIVIL SERVICE EXAM</Text>
          <Text style={styles.pageTitle}>Today’s Study</Text>
        </View>
        <CSCChipBadge
          label={getModelBadgeLabel()}
          variant={getModelBadgeVariant()}
          indicatorDot
        />
      </View>

      {/* 2. Primary Study Task: Mode Selection + Prominent Start Action */}
      <View style={styles.primaryTaskSurface}>
        <View style={styles.taskHeaderRow}>
          <Text style={styles.taskHeading}>Continue Studying</Text>
          {remainingQuestions > 0 && (
            <CSCChipBadge
              label={`${remainingQuestions} left`}
              variant="accentRed"
              indicatorDot
            />
          )}
        </View>
        <Text style={styles.taskSubheading}>
          Select your focus filter and begin a distraction-free practice quiz or
          flashcard recall session.
        </Text>

        {/* Segmented Filter Control */}
        <View style={styles.segmentedControl}>
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
                  styles.segmentButton,
                  isSelected && styles.segmentButtonSelected,
                ]}
              >
                <Text
                  style={[
                    styles.segmentButtonText,
                    isSelected && styles.segmentButtonTextSelected,
                  ]}
                >
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/* Primary & Secondary Session Starters */}
        <View style={styles.primaryActionsGroup}>
          <CSCButton
            title="Start Practice Quiz"
            variant="primary"
            onPress={() => onStartSession(undefined, selectedMode, 'quiz')}
          />
          <CSCButton
            title="Study Flashcards"
            variant="secondary"
            onPress={() =>
              onStartSession(undefined, selectedMode, 'flashcards')
            }
          />
        </View>
      </View>

      {/* 3. Subject & Topic List (Clean iOS Grouped List Rows) */}
      <View style={styles.sectionBlock}>
        <SectionHeader
          title="Subjects & Coverage"
          rightText={`${topicSummaries.length} subjects`}
        />
        {isLoading && topicSummaries.length === 0 ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator size="small" color={colors.brand.primary} />
            <Text style={styles.loadingText}>Loading subjects...</Text>
          </View>
        ) : topicSummaries.length === 0 ? (
          <EmptyState
            title="No Subjects Available"
            message="Import a Civil Service content pack to begin studying."
          />
        ) : (
          <View style={styles.listGroup}>
            {topicSummaries.map((summary, idx) => {
              const topicAccuracy =
                summary.answeredCount > 0
                  ? Math.round(
                      (summary.correctCount / summary.answeredCount) * 100
                    )
                  : null;

              return (
                <SubjectRow
                  key={summary.topic.id}
                  title={summary.topic.title}
                  answeredCount={summary.answeredCount}
                  totalQuestions={summary.totalQuestions}
                  accuracyPercent={topicAccuracy}
                  isLast={idx === topicSummaries.length - 1}
                  onPress={() =>
                    onStartSession(summary.topic.id, selectedMode, 'quiz')
                  }
                />
              );
            })}
          </View>
        )}
      </View>

      {/* 4. Secondary Progress Summary (Placed Below Main Study Tasks) */}
      <View style={styles.sectionBlock}>
        <SectionHeader
          title="Study Progress"
          rightText={
            totalAnswered > 0 ? `${overallAccuracy}% Accuracy` : 'Not Started'
          }
        />
        <View style={styles.progressSummarySurface}>
          <View style={styles.progressCountLine}>
            <Text style={styles.progressCountText}>
              {totalAnswered} of {totalQuestions} total questions completed
            </Text>
          </View>
          <AnimatedProgressBar
            current={totalAnswered}
            total={totalQuestions || 1}
            height={6}
          />
          <View style={styles.metricsRow}>
            <View style={styles.metricItem}>
              <Text style={styles.metricValue}>{totalQuestions}</Text>
              <Text style={styles.metricLabel}>Total</Text>
            </View>
            <View style={styles.metricDivider} />
            <View style={styles.metricItem}>
              <Text style={styles.metricValue}>{totalAnswered}</Text>
              <Text style={styles.metricLabel}>Reviewed</Text>
            </View>
            <View style={styles.metricDivider} />
            <View style={styles.metricItem}>
              <Text style={styles.metricValue}>{totalCorrect}</Text>
              <Text style={styles.metricLabel}>Correct</Text>
            </View>
          </View>
        </View>
      </View>
    </ScreenContainer>
  );
}

export interface ConnectedReviewHomeScreenProps {
  repository: QuestionRepository;
  llmPort?: LocalLlmPort;
  onStartSession: (
    topicId?: string,
    mode?: StudyMode,
    format?: SessionFormat
  ) => void;
}

/**
 * Connected Container for ReviewHomeScreen.
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

export const HomeDashboardScreen = ConnectedReviewHomeScreen;

const styles = StyleSheet.create({
  pageHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: spacing.sm,
    paddingTop: spacing.xs,
  },
  headerTitleBlock: {
    flex: 1,
    gap: 2,
  },
  overline: {
    fontSize: typography.caption.fontSize,
    fontWeight: '600',
    color: colors.neutral.textSecondary,
    letterSpacing: 0.6,
  },
  pageTitle: {
    fontSize: typography.title1.fontSize, // 28pt strong screen heading
    lineHeight: typography.title1.lineHeight,
    fontWeight: '700',
    color: colors.neutral.textPrimary,
  },
  primaryTaskSurface: {
    backgroundColor: colors.neutral.surfaceElevated,
    borderRadius: radius.lg,
    borderWidth: borders.hairline,
    borderColor: colors.neutral.borderSubtle,
    padding: spacing.xl,
    gap: spacing.md,
  },
  taskHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  taskHeading: {
    fontSize: typography.headline.fontSize,
    fontWeight: '700',
    color: colors.neutral.textPrimary,
  },
  taskSubheading: {
    fontSize: typography.subheadline.fontSize,
    lineHeight: typography.subheadline.lineHeight,
    color: colors.neutral.textSecondary,
  },
  segmentedControl: {
    flexDirection: 'row',
    backgroundColor: colors.neutral.surfaceMuted,
    padding: spacing.xs,
    borderRadius: radius.md,
    gap: spacing.xs,
  },
  segmentButton: {
    flex: 1,
    minHeight: controls.minTouchTarget,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
  },
  segmentButtonSelected: {
    backgroundColor: colors.neutral.surfaceElevated,
    borderWidth: borders.hairline,
    borderColor: colors.brand.border,
  },
  segmentButtonText: {
    fontSize: typography.footnote.fontSize,
    fontWeight: '500',
    color: colors.neutral.textSecondary,
  },
  segmentButtonTextSelected: {
    fontWeight: '700',
    color: colors.brand.primary,
  },
  primaryActionsGroup: {
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  sectionBlock: {
    gap: spacing.sm,
  },
  listGroup: {
    borderRadius: radius.lg,
    borderWidth: borders.hairline,
    borderColor: colors.neutral.borderSubtle,
    backgroundColor: colors.neutral.surfaceElevated,
    overflow: 'hidden',
  },
  progressSummarySurface: {
    backgroundColor: colors.neutral.surfaceElevated,
    borderRadius: radius.lg,
    borderWidth: borders.hairline,
    borderColor: colors.neutral.borderSubtle,
    padding: spacing.base,
    gap: spacing.md,
  },
  progressCountLine: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  progressCountText: {
    fontSize: typography.subheadline.fontSize,
    color: colors.neutral.textSecondary,
    fontWeight: '500',
  },
  metricsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingTop: spacing.xs,
  },
  metricItem: {
    alignItems: 'center',
    flex: 1,
  },
  metricDivider: {
    width: borders.hairline,
    height: 28,
    backgroundColor: colors.neutral.divider,
  },
  metricValue: {
    fontSize: typography.headline.fontSize,
    fontWeight: '700',
    color: colors.neutral.textPrimary,
  },
  metricLabel: {
    fontSize: typography.caption.fontSize,
    color: colors.neutral.textSecondary,
    marginTop: 2,
  },
  loadingBox: {
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

