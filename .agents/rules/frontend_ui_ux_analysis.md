---
name: frontend-ui-ux-analysis
description: Enforces that frontend codebase reviews and documentation always prioritize detailed UI/UX design specifications, visual design tokens, component states, and layout wireframes.
trigger: model_decision
---

# Frontend UI/UX Design Analysis & Documentation Protocol

Whenever asked to analyze, review, or document "frontend logic", "UI", or "client code" in this repository:

1. **Prioritize the Concrete UI/UX Design First:**
   - Always extract and document the active **Design System Tokens** (`tokens.ts`): the 80/15/5 visual weight rule, exact color palettes, WCAG contrast ratios, typography scale (font sizes, line heights, weights), spacing grid, corner radii, and motion/spring parameters.
2. **Component-by-Component Visual Specification:**
   - For every interactive primitive and screen component, document:
     - Component dimensions, touch targets (e.g., Apple HIG $\ge 44\text{pt}$), padding, and layout structure.
     - All interactive visual states: resting, pressed, selected, disabled, loading, correct, incorrect, and partial.
3. **Screen Layout & Visual Wireframes:**
   - Provide ASCII/text visual wireframes of each screen showing component hierarchy, safe area insets, and thumb-zone ergonomics.
4. **Step-by-Step User Experience (UX) Journeys:**
   - Map exact interaction flows (e.g. session start, answer selection, feedback transition, explanation reveal, card flip).
5. **Separate Architecture from UI/UX:**
   - Deliver the visual and interactive UI/UX specification prominently before delving into background data-layer or controller mechanics.

