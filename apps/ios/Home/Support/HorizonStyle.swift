//
//  HorizonStyle.swift
//  Home — the pocket admin for coreybaines.com
//
//  The app's design language, in one file, so that four agents building four
//  tabs produce one app rather than four.
//
//  ── The brief, stated once ─────────────────────────────────────────────────
//
//  Home is the Horizon admin's pocket sibling. The web side already made this
//  decision and wrote down why (apps/web/src/app/admin/admin.css):
//
//      "It does not import horizon.css. That file is the public design
//       language: washes, glows, orbits, a 1180px shell, the horizon boundary.
//       Loading it here would make the admin look like the site, which is
//       exactly wrong. An editing surface competing for attention with the
//       content it edits is a worse editing surface, and the visual quiet is
//       also a safety feature: you can tell at a glance whether you are looking
//       at the site or at the thing that changes it."
//
//  That holds on a phone too, and doubly so — the phone is where an edit gets
//  made one-handed at a pub, and where a mistap publishes something. So:
//
//    QUIET          System backgrounds, hairline separators, no gradients, no
//                   glows, no orbits. The content is the only colour.
//    MONO-ACCENTED  ONE accent — Horizon's dusk violet, shipped in the asset
//                   catalog with a light and a dark value — used for exactly
//                   two meanings: "this is the current thing" and "this is the
//                   primary action". Nothing else is ever tinted.
//    NUMERALS IN MONO  Counts, dates, deployment names, token prefixes and
//                   step totals render in a monospaced face so columns line up
//                   and a digit never shifts as it ticks.
//    DENSE          An editing surface is scanned, not read. Three spacing
//                   steps, tighter than the public site's.
//
//  ── What this file is not ──────────────────────────────────────────────────
//
//  Not a component library. It is the token layer — the Swift counterpart to
//  @home/ui/tokens.css, and it follows the same rule that file states: it
//  defines values and never lays anything out. A `padding()` in here would be a
//  component in disguise. Components belong with the feature that owns them.
//
//  Colour is deliberately thin. UIKit's semantic colours (`.primary`,
//  `.secondary`, `Color(.systemGroupedBackground)`) already give correct
//  light/dark, Increase Contrast and accessibility behaviour for free, and
//  re-declaring Horizon's `--hor-ink` ramp in Swift would mean maintaining two
//  palettes that drift. The accent is the one thing the system cannot know.
//

import SwiftUI

/// Design tokens for the Home admin. Values only — no layout, no components.
enum HorizonStyle {

    // MARK: - Colour

    /// Horizon's dusk violet, from `packages/ui/src/tokens.css`:
    /// light `hsl(256 76% 52%)` → `#8927E2`, dark `hsl(258 92% 76%)` → `#AB8AFA`.
    ///
    /// Defined in `Assets.xcassets/AccentColor` rather than as a literal here so
    /// that (a) it is also the app's global tint, which is what colours the tab
    /// bar selection and every default control, and (b) the light/dark pair is
    /// resolved by the asset catalog rather than by a `colorScheme` branch in
    /// view code — the same "only the root declares the pairs" rule tokens.css
    /// sets out.
    ///
    /// Reached through the generated asset symbol (`ASSETCATALOG_COMPILER_
    /// GENERATE_SWIFT_ASSET_SYMBOL_EXTENSIONS`), so a rename in the catalog is a
    /// compile error rather than a silently black view.
    static let accent = Color.accentColor

    // MARK: - Spacing
    //
    // Three steps, matching the admin's `--adm-flow` / `--adm-stack` / `--adm-snug`
    // so the two surfaces feel like one product. Anything not on this scale is a
    // one-off, and one-offs are how a design system stops being one.

    /// Between the big blocks of a screen: header → content, section → section.
    static let flow: CGFloat = 20

    /// Between the parts of one block: the fields of a form, the rows of a list.
    static let stack: CGFloat = 14

    /// Between a label and its control, an icon and its text.
    static let snug: CGFloat = 6

    // MARK: - Type
    //
    // Everything stays on Dynamic Type. `.system(…, design: .monospaced)`
    // preserves the user's text-size setting where a fixed point size would not,
    // which matters because this is an app used at arm's length in bad light.

    /// Numerals, identifiers and anything that belongs in a column.
    static func mono(_ style: Font.TextStyle = .body) -> Font {
        .system(style, design: .monospaced)
    }

    /// A mono label at the size used for metadata under a heading.
    static let monoCaption = mono(.caption)
}

// MARK: - Modifiers

extension View {

    /// Renders numerals so they occupy a constant width — a total that ticks
    /// from 9,998 to 9,999 must not reflow the row it sits in.
    ///
    /// Separate from `HorizonStyle.mono(_:)` because it also applies to
    /// proportional text: a `Text` in the system face still wants tabular
    /// figures when it is showing a count.
    func horizonNumerals() -> some View {
        monospacedDigit()
    }
}
