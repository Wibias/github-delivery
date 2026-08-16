# Approval Window Fixed-Shell Design

Date: 2026-08-16
Target release: 0.8.1
Branch: test/0.8.1-authority-hotfix

## Problem

The current ApprovalWindow uses an outer ScrollViewer for the main approval body. This allows the entire window content to scroll when space is constrained. That is undesirable because repository identity, security context, branch-grant controls, and the approval footer should always remain visible.

The only content that may need vertical scrolling is the rendered proposed-action text.

## Goal

Make ApprovalWindow responsive without ever requiring main-window scrolling.

The window must:

- keep the header, repository card, security card, branch-grant controls, and footer visible at all times;
- use the proposed-action text area as the only vertically scrollable region;
- let that action region expand and shrink with the window height;
- enforce a minimum width and minimum height so fixed controls never overlap or disappear;
- preserve the existing responsive narrow-width branch-control layout;
- remain fail-closed for Windows Hello approval.

## Layout

Replace the outer scrolling body with a fixed Grid shell.

The main Grid uses these vertical regions:

1. Header: Auto
2. Repository card: Auto
3. Proposed-action label: Auto
4. Proposed-action content: *
5. Security card: Auto
6. Branch-grant card: Auto
7. Footer: Auto

The proposed-action content region owns the only ScrollViewer. Its viewport fills the remaining available height.

The action text remains selectable and wrapped. Long content scrolls inside this region only.

## Minimum size

The window must set both a minimum width and a minimum height through OverlappedPresenter.

The constraints are:

- minimum width: 560 px;
- minimum height: 640 px;
- proposed-action viewport minimum height: 110 px.

The minimum height exists so the fixed shell always fits. Windows should stop further shrinking rather than introducing an outer scrollbar.

## Responsive width behaviour

At normal and wide widths:

- branch-grant explanatory text stays on the left;
- duration selector and toggle stay on the right;
- controls are vertically centred.

At narrow widths:

- the branch-grant controls move below the explanatory text;
- the action area remains the only vertically scrollable region;
- no outer ScrollViewer is introduced.

## Resize behaviour

When the user increases window height, only the proposed-action region receives the extra vertical space.

When the user decreases window height, the proposed-action region shrinks until the window reaches its configured minimum height.

The footer remains pinned and visible throughout resizing.

## Temporary branch lease duration

The existing exact-repository plus exact-branch temporary approval lease remains unchanged in scope and security semantics, but its selectable duration is extended from 1-5 minutes to 1-10 minutes.

Requirements:

- the approval UI offers every whole-minute option from 1 through 10 minutes;
- 1 minute remains the default selection;
- the selected duration is accepted only when it is between 1 and 10 minutes inclusive;
- both UI-side and persistence-side validation use the same inclusive 1-10 minute bound;
- an active lease continues to suppress repeated Windows Hello prompts only for the same exact repository and exact branch;
- every actual mutation still receives a fresh short-lived exact-effect grant and passes the existing redemption and mutation-policy checks.

## Error handling and security

The layout change does not change approval semantics, Windows Hello handling, authority scope construction, branch-lease matching, or fail-closed mutation behaviour.

The only lease-policy change is the maximum selectable duration from 5 minutes to 10 minutes.

If Windows Hello fails, the existing retry/sign-in-options flow remains unchanged.

## Tests

Update static ApprovalWindow regression tests to assert:

- no outer ApprovalBodyScrollViewer exists;
- the root layout contains a star-sized action-content row;
- ActionScrollViewer is the only approval-content vertical ScrollViewer;
- ActionScrollViewer is not constrained by the previous fixed MaxHeight behaviour;
- the footer remains outside the scrollable action region;
- branch controls keep their existing narrow/wide responsive setters;
- minimum window width and height are configured in code;
- branch lease options include 1 through 10 minutes and no value above 10;
- code-side branch lease validation accepts 10 and rejects values above 10.

Keep the existing Windows XAML smoke test with a very large approval body to verify the resulting XAML can instantiate successfully.

Keep branch-lease self-tests covering exact repo/branch isolation, expiry, atomic reuse, audit recording, and revocation.

## Acceptance criteria

The change is accepted when:

1. A normal approval fits with all fixed controls visible and no main-window scrollbar.
2. A very long PR/body description scrolls only inside Proposed action.
3. Resizing taller gives the description more space.
4. Resizing shorter reduces the description area until the minimum window size is reached.
5. The footer never scrolls away.
6. Narrow-width branch controls remain usable and aligned.
7. The duration selector offers 1 through 10 minutes and a 10-minute lease is valid.
8. Existing exact repo/branch lease reuse remains unchanged apart from the longer maximum duration.
9. Existing authority and Windows Hello tests still pass.
10. A published Windows test ZIP passes self-test and XAML smoke-test before manual validation.
