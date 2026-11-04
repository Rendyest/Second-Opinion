# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- Participants use a webcam-guided session to complete rehabilitation exercises as safely and independently as possible.
- Occupational therapists and reviewers use separate tools to understand movement quality, potential difficulties, and coaching effectiveness.

Both groups are equally important.

## Product Purpose

Mirra Call provides accessible, personalized, AI-assisted rehabilitation coaching through real-time computer vision and movement analysis. The current milestone is a functional demo for the Meta Global AI Developer Hackathon. Coaching supports exercise practice alongside professional guidance. Present feedback as coaching and avoid diagnostic claims.

## Positioning

The webcam and MediaPipe pipeline track movement, joint angles, and exercise progress locally. System 1 detects potential difficulties such as stalling, jitter, and compensatory movements. With consent, Muse Spark (System 2) uses a short movement summary to provide supportive, context-aware tips when appropriate.

## Operating Context

- Participants grant camera access, calibrate, and follow exercise instructions. The session shows movement feedback, progress, and coaching, with controls to pause or stop.
- Occupational therapists and reviewers use the separate Metrics, Review, and Validation views for available joint angles, struggle events, coaching triggers, session summaries, and evaluation information.

## Capabilities and Constraints

- Preserve the React and TypeScript frontend, existing backend integrations, MediaPipe pipeline, System 1 detector, and Muse Spark integration.
- Preserve camera permissions, informed consent, local camera processing, calibration, pause and stop controls, and privacy safeguards. Cloud coaching requires consent. Keep core exercise workflows usable with cloud coaching disabled or unavailable, using existing local functionality where supported.
- Verify visible controls and navigation through the normal workflows, including camera access, calibration, session interactions, and supported AI integrations.

## Brand Commitments

Use the Mirra Call name. The confirmed design direction is a sophisticated, modern rehabilitation platform with a calm healthcare aesthetic, intuitive workflows, responsive layouts, accessible typography, and clear visual feedback. Use simple, encouraging language in participant sessions.

## Evidence on Hand

The repository includes a mock replay stream in `public/mock-stream.json`, a synthetic demo generator in `scripts/make-demo-data.mjs`, and an example validation output in `docs/results.EXAMPLE.json`. Label mock and synthetic data clearly and distinguish them from live results. Show only implemented capabilities, available measurements, and evaluation results supported by evidence.

## Product Principles

- Keep participants focused on the exercise. Put technical metrics in the reviewer views.
- Time coaching around detected difficulty or a participant request. Keep feedback supportive and specific to the movement.
- Give participants control over camera use, cloud coaching, and when to pause or end a session.
- Make it clear to reviewers which observations triggered coaching and what evidence supports the evaluation.

## Accessibility & Inclusion

Use clear instructions, readable typography, responsive layouts, and understandable movement feedback throughout the participant workflow.
