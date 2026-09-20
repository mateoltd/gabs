# Queued goal: UI refinement and polish

Authorized by the user on 16 September 2026. Start only after the feature-parity goal has actually met all acceptance gates and is marked complete. At that point, create a new goal with the objective below and continue autonomously. Do not create a second active goal now.

## Objective

Refine the complete web and Electron business suite into a consistent, cohesive and visually polished product. The user explicitly finds the present UI unacceptable. Prior reconciliation and passing tests do not establish visual acceptance. Audit every feature and interaction, identify deficiencies, establish a coherent design system, and carry it through all modules, administration, profiles, lifecycle, commerce, notifications and offline states. Preserve completed functionality and the user's detailed visual constraints.

## Completion evidence

- A prioritized inventory of actual visual and interaction deficiencies with before/after evidence.
- Consistent typography, density, spacing, hierarchy, controls, tables, forms, navigation, icons, feedback, focus and motion, with deliberate exceptions documented.
- Complete wide/narrow and web/native journeys, populated/loading/empty/error/pending/conflict states, all supported appearance variants and workspace transitions.
- Extensive manual visual inspection of the real interface, keyboard and assistive-technology checks, and meaningful regression coverage. Test counts alone do not establish beauty or consistency.
- Recoverable Git checkpoints and a final visual gallery. Candidly distinguish engineering verification from user design approval.

The protected reference is user intent and good product design, not every pixel of the current implementation. Follow `docs/ui.md` for surviving constraints, while correcting its documented deficiencies as needed. Keep the parity acceptance results intact and link any behavior changes to fresh tests.

## Observed deficiencies to carry into refinement

- Corporate saved-work archive storage failures expose Electron's raw IPC prefix before the useful recovery instruction. Present a concise user-facing error while retaining technical details in diagnostics. [Wide and narrow failure evidence](verification/corporate-work-archives/README.md#durable-batch-admission-and-lost-acknowledgement), 20 September 2026. This observation does not start the queued goal or grant visual approval to the current dialog.

- In-flight permission revocation correctly prevents corporate saved-work restoration, but the dialog gives a generic “connect and unlock” instruction rather than explaining lost permission. Distinguish access denial from connectivity/unlock failures and give an actionable next step. [Web denial evidence](verification/corporate-work-archives/web-promotion-permission-denied.png) and [native denial evidence](verification/corporate-work-archives/desktop-promotion-permission-denied.png), 20 September 2026. This records a deficiency without starting UI refinement.
