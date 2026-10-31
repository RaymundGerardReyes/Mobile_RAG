# Current UI/UX Design & Interaction Specification: `ai-tutor-mobile`

**Target Codebase:** [`D:\MobileApp Rag\mobile`](file:///d:/MobileApp%20Rag/mobile)  
**Package:** `ai-tutor-mobile` (v0.3.0)  
**Design Standard:** Philippine Civil Service Commission (CSC) Brand Guidelines & Apple Human Interface Guidelines (HIG)  
**Primary Device Target:** iPhone 16 (402 x 874 pt @3x, Dynamic Island, Home Indicator safe areas)  
**Implementation Source:** [`src/theme/tokens.ts`](file:///d:/MobileApp%20Rag/mobile/src/theme/tokens.ts), [`src/components/CorePrimitives.tsx`](file:///d:/MobileApp%20Rag/mobile/src/components/CorePrimitives.tsx), [`src/features/review/ReviewHomeScreen.tsx`](file:///d:/MobileApp%20Rag/mobile/src/features/review/ReviewHomeScreen.tsx), [`src/features/quiz/QuizReviewScreen.tsx`](file:///d:/MobileApp%20Rag/mobile/src/features/quiz/QuizReviewScreen.tsx)

---

## 1. Visual Identity & Design Tokens

The mobile application is built on an editorial, distraction-free design language tailored for high-stakes exam review. It uses **zero external UI component libraries** (pure React Native primitives) to maintain strict control over contrast ratios, animations, and memory footprint.

### 1.1. The Strict 80/15/5 Visual Weight Philosophy

The interface strictly adheres to the **80/15/5 distribution rule** to maximize readability during prolonged study sessions:

```
+-------------------------------------------------------------------------+
|  80% CALMING NEUTRALS                                                   |
|  Canvas (#FFFFFF), Surface (#F7F8FC), Text Primary (#191D2E),           |
|  Subtle Borders (#E4E7EF)                                               |
+---------------------------------------------------+---------------------+
|  15% CSC BRAND BLUE                               |  5% ACCENT RED      |
|  Primary Actions, Active States, Progress         |  Badges & Priority  |
|  (#2A338F)                                        |  (#EC1C2D)          |
+---------------------------------------------------+---------------------+
```

- **80% Calming Neutrals:** Provides an expansive, non-fatiguing reading canvas. Surfaces are layered gently using subtle 1pt borders rather than heavy drop shadows.
- **15% Brand Deep Blue (`#2A338F`):** Anchors visual hierarchy. Used for primary buttons, active segmented tabs, progress bar fills, and key headers. Delivers an **10.67:1 contrast ratio** against white (far exceeding WCAG AAA's 7:1 requirement).
- **5% Focal Accent Red (`#EC1C2D`):** Strictly reserved for urgency indicators (e.g. `"105 left"` unreviewed items) and dot markers.  
  *WCAG Invariant:* Because pure red on white yields only 4.40:1 (failing WCAG AA for body text), red badges strictly combine dark primary text (`#191D2E`) on an ultra-light red tint surface (`#FFF5F5`) with a 6pt solid red dot indicator.

---

### 1.2. Complete Color Palette Specification

```typescript
// Defined in mobile/src/theme/tokens.ts
```

| Token Path | Hex Value | Purpose & Usage in Code | Contrast against White |
| :--- | :--- | :--- | :--- |
| **`colors.neutral.canvas`** | `#FFFFFF` | Primary screen canvas and elevated card background. | 1.00:1 (Base) |
| **`colors.neutral.surface`** | `#F7F8FC` | Safe-area screen background; subdued container fill. | 1.05:1 |
| **`colors.neutral.surfaceElevated`** | `#FFFFFF` | Cards, choice rows, and bottom action bar surface. | 1.00:1 |
| **`colors.neutral.surfaceMuted`** | `#F1F3F9` | Segmented control track, disabled buttons, subtle chips. | 1.11:1 |
| **`colors.neutral.textPrimary`** | `#191D2E` | Question stems, card titles, primary body copy. | **14.20:1 (WCAG AAA)** |
| **`colors.neutral.textSecondary`**| `#62697B` | Subheadings, section overlines, passage metadata. | **5.45:1 (WCAG AA)** |
| **`colors.neutral.textMuted`** | `#868E96` | Input placeholders, trailing chevrons, disabled text. | 3.25:1 (Non-text/UI) |
| **`colors.neutral.borderSubtle`** | `#E4E7EF` | Default 1pt card borders, screen container dividers. | UI Border |
| **`colors.neutral.borderDefault`**| `#DEE2E6` | Choice row borders, unselected control outlines. | UI Border |
| **`colors.neutral.divider`** | `#E8EAF1` | Hairline dividers inside cards and lists. | UI Divider |
| **`colors.brand.primary`** | `#2A338F` | Primary button fill, progress fill, active text. | **10.67:1 (WCAG AAA)** |
| **`colors.brand.dark`** | `#1F266D` | Deep pressed state for primary buttons. | **13.50:1 (WCAG AAA)** |
| **`colors.brand.light`** | `#E8EAF6` | Light brand accent. | UI Accent |
| **`colors.brand.tint`** | `#F0F2FA` | Selected choice row surface, active tab highlight. | UI Surface |
| **`colors.brand.border`** | `#C5CAE9` | Secondary button border, active segment border. | UI Border |
| **`colors.brand.contrastText`** | `#FFFFFF` | Text rendered on `brand.primary` buttons. | **10.67:1 (WCAG AAA)** |
| **`colors.accent.primary`** | `#EC1C2D` | Focal red badge dot, urgent count highlights. | 4.40:1 |
| **`colors.accent.light`** | `#FDE8E9` | Border for red emphasis badges. | UI Border |
| **`colors.accent.tint`** | `#FFF5F5` | Surface background for `"X left"` badge. | UI Surface |
| **`colors.semantic.correct.text`**| `#166534` | Correct feedback title, score text, badge text. | **6.10:1 (WCAG AA)** |
| **`colors.semantic.correct.surface`**|`#EBF6F0`| Correct feedback banner background, correct choice row. | UI Surface |
| **`colors.semantic.correct.border`** |`#A3D9B8`| Border for correct verdict elements. | UI Border |
| **`colors.semantic.incorrect.text`**|`#B42318`| Incorrect feedback title, error banner copy. | **5.80:1 (WCAG AA)** |
| **`colors.semantic.incorrect.surface`**|`#FEE4E2`| Incorrect feedback banner background, error box surface.| UI Surface |
| **`colors.semantic.incorrect.border`**|`#FECDCA`| Border for incorrect feedback elements. | UI Border |
| **`colors.semantic.warning.text`**| `#92400E` | Partial credit text, unverified model warnings. | **5.20:1 (WCAG AA)** |
| **`colors.semantic.warning.surface`**|`#FEF7EA`| Warning badge surface, partial credit banner. | UI Surface |
| **`colors.semantic.warning.border`**|`#F6D090` | Border for warning chips and banners. | UI Border |

---

### 1.3. Typography Scale (San Francisco / System Font)

Typography follows iOS Human Interface Guidelines with increased line heights (24–30pt) for enhanced reading comfort:

| Style Token | Font Size | Line Height | Weight | Application in Current UI |
| :--- | :--- | :--- | :--- | :--- |
| **`typography.largeTitle`** | 32pt | 38pt | Bold (700) | Major celebratory headers. |
| **`typography.title1`** | 28pt | 34pt | Bold (700) | Session Complete title (`4 of 4 Completed`). |
| **`typography.title2`** | 21pt | 26pt | Semibold (600) | Section titles, Flashcard front prompt (30pt line height). |
| **`typography.headline`** | 18pt | 24pt | Semibold (600) | Screen header title, Flashcard back answer, AI headings. |
| **`typography.body`** | 17pt | 24pt | Regular (400/600) | Choice option text (58pt rows), canonical explanation body. |
| **`typography.callout`** | 15pt | 21pt | Regular (400) | Verified textbook passage text, back button label. |
| **`typography.subheadline`** | 14pt | 20pt | Regular/Semibold | Section actions (`rightText`), segmented button labels. |
| **`typography.footnote`** | 12pt | 16pt | Medium (500) | Subject meta text (`45 of 150 answered`), passage citations. |
| **`typography.caption`** | 11pt | 14pt | Medium/Bold | Chip badge labels, overline text (`PHILIPPINE CSC`), state labels. |

---

### 1.4. Spacing Scale & Layout Grid

- `spacing.xs` (**4pt**): Micro-spacing between icon/dot and text label.
- `spacing.sm` (**8pt**): Tight padding inside compact chips, gaps between segmented buttons.
- `spacing.md` (**12pt**): Vertical padding inside choice rows, passage cards, and input fields.
- `spacing.base` / `lg` (**16pt**): Standard padding inside cards, default margin bottom.
- `spacing.xl` (**20pt**): **Standard iPhone 16 horizontal screen padding (`paddingHorizontal: 20`)**. Form groups separation.
- `spacing.xxl` (**24pt**): Major section separation, flashcard internal padding.
- `spacing.xxxl` (**32pt**): ScrollView bottom padding ensuring clearance above home indicator.
- `spacing.huge` (**48pt**): Spacious hero separation.

---

### 1.5. Corner Radii & Elevation Architecture

The UI eliminates heavy blurred drop shadows (`shadowRadius: 10`, `elevation: 8`) in favor of crisp, structural hairline borders (`borders.hairline = 1pt`):

| Radius Token | Value | Applied Components |
| :--- | :--- | :--- |
| **`radius.sm`** | 8pt | Small status chips (`CSCChipBadge`), choice key badge (`32x32pt`), indicator boxes. |
| **`radius.md`** | 12pt | Buttons (`CSCButton`), choice rows (`AnimatedChoiceRow`), text inputs, feedback banners. |
| **`radius.lg`** | 16pt | Content cards (`ContentCard`), subject group lists, flashcard surfaces (`Flashcard`). |
| **`radius.xl`** | 24pt | Bottom sheets and modal presentation containers. |
| **`radius.pill`**| 999pt | Progress bar tracks, circular indicator dots, segmented controls. |

---

### 1.6. Apple HIG Motion & Animation Tokens

Interactive components use subtle, deterministic spring and scale animations:
- **Button Press Scale:** `1.00 -> 0.98` (`motion.scale.pressed: 0.98`).
- **Button Press Opacity:** `1.00 -> 0.88` (`motion.opacity.pressed: 0.88`).
- **Spring Parameters:**
  - `motion.spring.snappy`: `stiffness: 300, damping: 22, mass: 0.7` (Buttons & choice selections).
  - `motion.spring.gentle`: `stiffness: 200, damping: 25, mass: 1` (Progress bar interpolation).
- **Durations:**
  - `instant`: `120ms` (Tap feedback, button highlights).
  - `normal`: `200ms` (Progress bar width transitions).
  - `deliberate`: `350ms` (Card reveals).

---

## 2. Core Primitives & Interactive States

Every visual element in [`src/components/CorePrimitives.tsx`](file:///d:/MobileApp%20Rag/mobile/src/components/CorePrimitives.tsx) implements strict accessibility roles and deterministic states.

### 2.1. `CSCButton`
Enforces a minimum height of **50pt** (exceeding Apple's 44pt touch guideline).

```
+----------------------------------------------------------------+
|                   Start Practice Quiz                          |  <- 50pt
+----------------------------------------------------------------+
```

- **Variants:**
  - `primary`: Background `#2A338F`, text `#FFFFFF`, bold 17pt.
  - `secondary`: Background `#FFFFFF`, 1pt border `#C5CAE9`, text `#2A338F`, bold 17pt.
  - `subtle`: Background `#F1F3F9`, text `#191D2E`.
- **States:**
  - `Normal`: Fully opaque.
  - `Pressed`: `opacity: 0.88`, `transform: [{ scale: 0.98 }]`.
  - `Disabled`: Background `#F1F3F9`, border `#E4E7EF`, text `#868E96`.
  - `Loading`: Displays embedded `ActivityIndicator` (white for primary, blue for secondary).

---

### 2.2. `AnimatedChoiceRow`
The primary multiple-choice interaction component, engineered for effortless thumb tapping.

```
+----------------------------------------------------------------+
|  +----+                                                        |
|  | A  |  Serve and protect the people                          |  <- 58pt
|  +----+                                                        |
+----------------------------------------------------------------+
```

- **Dimensions:** `minHeight: 58pt`, `paddingHorizontal: 16pt`, `paddingVertical: 12pt`, `borderRadius: 12pt`.
- **Key Badge:** Fixed `32x32pt` square (`borderRadius: 8pt`, `borderWidth: 1pt`), center-aligning the letter key (A, B, C, D).
- **Four Distinct Visual States:**
  1. **Resting Unselected:** Background `#FFFFFF`, border `#DEE2E6` (1pt). Badge background `#F1F3F9`, badge text `#191D2E`.
  2. **Selected (Pre-Submission):** Background `#F0F2FA` (brand tint), border `#2A338F` (**2pt focused**). Badge background `#2A338F`, badge text `#FFFFFF`. Text emphasized to semibold.
  3. **Correct Verdict (Post-Submission):** Background `#EBF6F0` (green surface), border `#A3D9B8` (**1.5pt emphasized**). Badge background `#166534`, badge text `#FFFFFF`. Displays caption: `✓ Correct` in `#166534`.
  4. **Incorrect Selection (Post-Submission):** Background `#FEE4E2` (red surface), border `#FECDCA` (**1.5pt emphasized**). Badge background `#B42318`, badge text `#FFFFFF`. Displays caption: `✕ Your Choice` in `#B42318`.

---

### 2.3. `CSCChipBadge`
Displays model status, topic progress, textbook pages, and accuracy percentages.

- **Structure:** `paddingHorizontal: 8pt`, `paddingVertical: 4pt`, `borderRadius: 8pt`, optional 6pt circular indicator dot.
- **Variants Matrix:**
  - `brand`: Background `#F0F2FA`, border `#C5CAE9`, text `#2A338F`.
  - `accentRed`: Background `#FFF5F5`, border `#FDE8E9`, **text `#191D2E`** (Dark text invariant for WCAG AAA), dot `#EC1C2D`.
  - `success`: Background `#EBF6F0`, border `#A3D9B8`, text `#166534`, dot `#166534`.
  - `warning`: Background `#FEF7EA`, border `#F6D090`, text `#92400E`, dot `#92400E`.
  - `neutral`: Background `#F1F3F9`, border `#E4E7EF`, text `#62697B`, dot `#62697B`.

---

### 2.4. `AnimatedProgressBar`
- **Structure:** Full-width track with `backgroundColor: #E4E7EF`, `borderRadius: 999pt`, overflow hidden.
- **Heights:**
  - `4pt`: Used in header navigation and subject list rows.
  - `6pt`: Used in main progress dashboard cards.
- **Animation:** React Native `Animated.timing` smoothly drives the width from `0%` to `100%` over 200ms (`motion.duration.normal`).

---

### 2.5. `Flashcard`
The core active-recall learning component.

```
+----------------------------------------------------------------+
| PHILIPPINE CONSTITUTION & GENERAL INFO               [ p. 12 ] |
|                                                                |
| What is the prime duty of the Government under                |
| Article II, Section 4 of the Constitution?                     |
|                                                                |
| -------------------------------------------------------------- |
|                     Tap to reveal answer                       |
+----------------------------------------------------------------+
```

- **Dimensions:** Surface `#FFFFFF`, border `#E4E7EF` (1pt), `borderRadius: 16pt`, `padding: 24pt`, `minHeight: 260pt`.
- **Front Face:**
  - Top row: Overline topic label (`12pt` semibold blue) and textbook page badge (`p. 12`).
  - Middle: Question prompt (`21pt` semibold, `30pt` line height).
  - Bottom: Hairline divider with centered text `"Tap to reveal answer"` (`14pt` semibold blue).
- **Revealed Back Face:**
  - Hairline divider.
  - Label: `"OFFICIAL ANSWER"` (`11pt` bold green `#166534`).
  - Canonical Answer: `18pt` bold `#191D2E`.
  - Explanation Box: Surface `#F7F8FC`, `borderRadius: 12pt`, `padding: 12pt`. Contains `"Why this is correct"` header and textbook explanation.

---

### 2.6. `AnswerFeedbackBanner`
Alert banner dynamically rendered immediately below the choices following answer submission:
- **`isCorrect === true`:** Surface `#EBF6F0`, border `#A3D9B8`, text: `✓ Correct Answer` (`#166534`).
- **`score > 0 && score < 1.0`:** Surface `#FEF7EA`, border `#F6D090`, text: `! Partially Correct (50%)` (`#92400E`).
- **`isCorrect === false`:** Surface `#FEE4E2`, border `#FECDCA`, text: `✕ Incorrect — Official Answer: [Canonical Answer]` (`#B42318`).

---

## 3. Screen Layout & Component Wireframes

### 3.1. Screen 1: Home Dashboard (`ReviewHomeScreen.tsx`)

```
================================================================================
STATUS BAR (Dark Content)
================================================================================
[PHILIPPINE CIVIL SERVICE EXAM]                            (• Offline AI Ready)
Today’s Study                                                          [Header]
--------------------------------------------------------------------------------
CONTINUE STUDYING                                                   (• 105 left)
Select your focus filter and begin a distraction-free practice quiz or flashcard
recall session.

+------------------------------------------------------------------------------+
|   [ All Questions ]   |       Unanswered        |         Weak Areas         |
+------------------------------------------------------------------------------+
| [ Start Practice Quiz                                                  (50pt)] |
+------------------------------------------------------------------------------+
| [ Study Flashcards                                                     (50pt)] |
+------------------------------------------------------------------------------+

SUBJECTS & COVERAGE                                                   4 subjects
+------------------------------------------------------------------------------+
| Philippine Constitution & General Information                         (89% ✓)|
| 45 of 150 questions reviewed                                                 |
| [=====================================>              ] (4pt bar)           › |
+ - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -+
| Verbal Ability (English & Filipino)                                   (79% ✓)|
| 120 of 200 questions reviewed                                                |
| [==============================================>     ] (4pt bar)           › |
+ - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -+
| Analytical & Logical Reasoning                                        (75% ✓)|
| 60 of 120 questions reviewed                                                 |
| [============================>                       ] (4pt bar)           › |
+ - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -+
| Numerical Reasoning                                                   (67% !)|
| 30 of 100 questions reviewed                                                 |
| [================>                                   ] (4pt bar)           › |
+------------------------------------------------------------------------------+

STUDY PROGRESS                                                     78% Accuracy
+------------------------------------------------------------------------------+
| 255 of 570 total questions completed                                         |
| [======================================>             ] (6pt bar)             |
|                                                                              |
|         570                   |         255          |          200          |
|        Total                  |       Reviewed       |        Correct        |
+------------------------------------------------------------------------------+
[Home Indicator Clearance: 32pt]
```

---

### 3.2. Screen 2: Practice Quiz (Question Active & Pre-Submission)

```
================================================================================
STATUS BAR (Dark Content)
================================================================================
‹ Exit   QUIZ REVIEW                                                        25%
         Question 1 of 4                                               [Header]
================================================================================
[=========================>                                    ] (4pt bar)

Choose one answer.
According to Article II of the 1987 Philippine Constitution, what is the prime
duty of the Government?

+------------------------------------------------------------------------------+
| [ A ]  To establish diplomatic relations with foreign powers                 |
+------------------------------------------------------------------------------+
| [ B ]  To serve and protect the people                       [SELECTED (2pt)]|
+------------------------------------------------------------------------------+
| [ C ]  To collect taxes and revenues for national infrastructure             |
+------------------------------------------------------------------------------+
| [ D ]  To maintain a standing armed force in every municipality              |
+------------------------------------------------------------------------------+

[Scroll Padding: 32pt]
================================================================================
BOTTOM ACTION BAR
+------------------------------------------------------------------------------+
| [ Submit Answer                                                        (50pt)] |
+------------------------------------------------------------------------------+
```

---

### 3.3. Screen 3: Practice Quiz (Post-Submission & Feedback State)

```
================================================================================
STATUS BAR (Dark Content)
================================================================================
‹ Exit   QUIZ REVIEW                                                        25%
         Question 1 of 4                                               [Header]
================================================================================
[=========================>                                    ] (4pt bar)

According to Article II of the 1987 Philippine Constitution, what is the prime
duty of the Government?

+------------------------------------------------------------------------------+
| [ A ]  To establish diplomatic relations with foreign powers      [Disabled] |
+------------------------------------------------------------------------------+
| [ B ]  To serve and protect the people              [✓ Correct]  (1.5pt green)|
+------------------------------------------------------------------------------+
| [ C ]  To collect taxes and revenues for national infrastructure  [Disabled] |
+------------------------------------------------------------------------------+
| [ D ]  To maintain a standing armed force in every municipality   [Disabled] |
+------------------------------------------------------------------------------+

+------------------------------------------------------------------------------+
| ✓ Correct Answer                                            [Feedback Banner]|
+------------------------------------------------------------------------------+

Why this is correct
Article II, Section 4 declares that the prime duty of the Government is to
serve and protect the people.

VERIFIED TEXTBOOK REFERENCE (PP. 12, 14)
+------------------------------------------------------------------------------+
| | Section 4. The prime duty of the Government is to serve and protect the    |
| | people. The Government may call upon the people to defend the State...     |
|   Article II: Declaration of Principles · pp. 12–14 (Verified Link)          |
+------------------------------------------------------------------------------+

--------------------------------------------------------------------------------
AI Tutor Explanation
The 1987 Constitution establishes in Article II, Section 4 that sovereignty
resides in the people and all government authority emanates from them. Therefore,
the primary mandate is civil protection and service, not military conquest.

+------------------------------------------------------------------------------+
| [ Explain in English (50pt) ]        | [ Ipaliwanag sa Filipino (50pt) ]     |
+------------------------------------------------------------------------------+

[Scroll Padding: 32pt]
================================================================================
BOTTOM ACTION BAR
+------------------------------------------------------------------------------+
| [ Next Question →                                                      (50pt)] |
+------------------------------------------------------------------------------+
```

---

### 3.4. Screen 4: Flashcard Recall Session

```
================================================================================
STATUS BAR (Dark Content)
================================================================================
‹ Exit   FLASHCARD RECALL                                                   50%
         Card 2 of 4                                                   [Header]
================================================================================
[==============================================>               ] (4pt bar)

+------------------------------------------------------------------------------+
| PHILIPPINE CONSTITUTION & GENERAL INFO                               [ p. 14 ]|
|                                                                              |
| Under Article III, Section 1, what two elements cannot be                     |
| deprived without due process of law?                                         |
|                                                                              |
| ---------------------------------------------------------------------------- |
| OFFICIAL ANSWER                                                              |
| Life, liberty, or property                                                   |
|                                                                              |
| +--------------------------------------------------------------------------+ |
| | Why this is correct                                                      | |
| | No person shall be deprived of life, liberty, or property without due    | |
| | process of law, nor shall any person be denied equal protection.         | |
| +--------------------------------------------------------------------------+ |
+------------------------------------------------------------------------------+

[Scroll Padding: 32pt]
================================================================================
BOTTOM ACTION BAR (Revealed State)
+------------------------------------------------------------------------------+
| [ Review Again (Secondary 50pt) ]    | [ Know It (Primary 50pt) ]            |
+------------------------------------------------------------------------------+
```

---

### 3.5. Screen 5: Session Completed Summary

```
================================================================================
STATUS BAR (Dark Content)
================================================================================
‹ Home   SESSION COMPLETE                                                  100%
         Today’s Study                                                 [Header]
================================================================================

+------------------------------------------------------------------------------+
| SESSION COMPLETE                                                             |
| 4 of 4 Completed                                                             |
| You have completed all items in this study session. Review any challenging    |
| concepts or return to your subject list to continue practicing.              |
|                                                                              |
| ---------------------------------------------------------------------------- |
|                                                                              |
|               4                           |               100%               |
|       Questions Reviewed                  |         Session Progress         |
+------------------------------------------------------------------------------+

+------------------------------------------------------------------------------+
| [ Practice Again                                                       (50pt)] |
+------------------------------------------------------------------------------+
| [ Return to Home                                                       (50pt)] |
+------------------------------------------------------------------------------+
```

---

## 4. User Experience (UX) Flows & Ergonomics

### 4.1. iPhone 16 Thumb-Zone Ergonomics
The screen layout is engineered to prevent awkward hand stretching on large 6.1"–6.9" displays:
- **Top Safe Zone (Top 15%):** Reserved strictly for non-interactive indicators (progress bar, question counter, model status pill).
- **Middle Reading Zone (Middle 45%):** Scrollable container holding question stems and verified textbook excerpts.
- **Bottom Thumb Zone (Bottom 40%):** All primary interaction targets (multiple choice rows, segmented filter buttons, bottom action bar buttons) sit within the easy natural thumb sweep.

```
+-----------------------------------+
|  DYNAMIC ISLAND & STATUS (15%)    | <- Passive Progress Indicators
+-----------------------------------+
|                                   |
|  SCROLLABLE READING AREA (45%)    | <- Question Stem & Textbook Passages
|                                   |
+-----------------------------------+
|  EASY THUMB SWEEP (40%)           | <- 58pt Choice Rows
|                                   |
|  [ SUBMIT / NEXT BUTTON (50pt) ]  | <- Bottom Action Bar (Fixed)
+-----------------------------------+
```

---

### 4.2. Step-by-Step User Interaction Journeys

#### Journey 1: Practice Quiz Flow
1. **Launch:** Learner taps `"Start Practice Quiz"` on Home Screen.
2. **Read & Select:** Question stem renders. Learner taps Choice B.
   - Spring animation fires (`scale: 0.98 -> 1.00`).
   - Choice B changes background to `#F0F2FA` and border to `#2A338F` (2pt).
   - Bottom Action Bar button `"Submit Answer"` transitions from disabled to primary active.
3. **Submit:** Learner taps `"Submit Answer"`.
   - Choice rows lock (`disabled={true}`).
   - Choice B receives a green border (`#A3D9B8`) and `✓ Correct` label.
   - `<AnswerFeedbackBanner>` slides in with `✓ Correct Answer`.
   - Verified textbook passage cards expand showing exact chapter and page numbers.
   - Bottom Action Bar button smoothly updates title to `"Next Question →"`.
4. **AI Deep Dive:** Learner taps `"Ipaliwanag sa Filipino"`.
   - Loading indicator activates inside button.
   - Bilingual AI card displays grounded Filipino explanation.
5. **Advance:** Learner taps `"Next Question →"`. Progress bar increments from `25%` to `50%`.

#### Journey 2: Flashcard Recall Flow
1. **Launch:** Learner taps `"Study Flashcards"` on Home Screen.
2. **Prompt:** Card displays front question and topic badge. Bottom action bar displays `"Reveal Answer"`.
3. **Reveal:** Learner taps card or `"Reveal Answer"`.
   - Card transitions into revealed state; back answer and explanation expand smoothly.
   - Bottom action bar changes from a single button to a dual rating row: `"Review Again"` (secondary) and `"Know It"` (primary).
4. **Advance:** Learner taps `"Know It"` to advance to card 2.

---

## 5. Accessibility & WCAG Contrast Compliance Audit

All color pairs across the active UI components were evaluated against WCAG 2.1 standards:

| UI Component Element | Foreground Color | Background Color | Measured Contrast Ratio | WCAG 2.1 Grade |
| :--- | :--- | :--- | :--- | :--- |
| **Primary Text Copy** | `#191D2E` | `#FFFFFF` | **14.20:1** | **Pass (AAA)** |
| **CSC Primary Button** | `#FFFFFF` | `#2A338F` | **10.67:1** | **Pass (AAA)** |
| **Secondary Button Text** | `#2A338F` | `#FFFFFF` | **10.67:1** | **Pass (AAA)** |
| **Section Overlines & Meta**| `#62697B` | `#FFFFFF` | **5.45:1** | **Pass (AA)** |
| **Correct Verdict Text** | `#166534` | `#EBF6F0` | **6.10:1** | **Pass (AA)** |
| **Incorrect Verdict Text** | `#B42318` | `#FEE4E2` | **5.80:1** | **Pass (AA)** |
| **Warning / Partial Text** | `#92400E` | `#FEF7EA` | **5.20:1** | **Pass (AA)** |
| **Urgent Accent Badge** | `#191D2E` (Dark text)| `#FFF5F5` (Tint) | **13.80:1** | **Pass (AAA)** |
| **Selected Choice Row Text**| `#191D2E` | `#F0F2FA` | **13.10:1** | **Pass (AAA)** |
| **Minimum Touch Target** | 50pt Button / 58pt Row | N/A | $\ge 44\text{pt}$ Apple HIG | **Pass (Compliant)** |

---

## 6. Summary: Current UI Implementation Status

| Feature Area | Component File | Current UI/UX Status |
| :--- | :--- | :--- |
| **Theme & Tokens** | [`src/theme/tokens.ts`](file:///d:/MobileApp%20Rag/mobile/src/theme/tokens.ts) | **100% Complete:** Strict 80/15/5 tokens, WCAG AAA colors, Apple HIG motion & touch specs. |
| **Core Primitives** | [`src/components/CorePrimitives.tsx`](file:///d:/MobileApp%20Rag/mobile/src/components/CorePrimitives.tsx) | **100% Complete:** `CSCButton`, `AnimatedChoiceRow`, `BottomActionBar`, `Flashcard`, `AnswerFeedbackBanner`, `AnimatedProgressBar`, `SubjectRow`. |
| **Home Screen UI** | [`src/features/review/ReviewHomeScreen.tsx`](file:///d:/MobileApp%20Rag/mobile/src/features/review/ReviewHomeScreen.tsx) | **100% Complete:** Editorial page header, 3-mode segmented filter, subject list rows with accuracy badges, progress dashboard. |
| **Quiz & Flashcard UI**| [`src/features/quiz/QuizReviewScreen.tsx`](file:///d:/MobileApp%20Rag/mobile/src/features/quiz/QuizReviewScreen.tsx) | **100% Complete:** 58pt choice rows, instant feedback banners, textbook reference cards, bilingual AI elaboration, and flashcards. |
| **Root Shell (`App.tsx`)**| [`App.tsx`](file:///d:/MobileApp%20Rag/mobile/App.tsx) | **Live.** Initializes SQLite `content_pack.db` via `openContentPackDatabase()`, wired through `SqliteQuestionRepository`, `SqlitePassageRetriever`, and `ReviewSessionController` with all 9 use cases. LLM port uses `LocalMockLlmPort` pending on-device Qwen LoRA deployment. |

