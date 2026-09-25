# Ring Records — Design Spec (v2)

Inspired by 21st.dev / shadcn/ui “Modern Minimal” + Vercel neutrals, tuned for motorsport data.

## Style anchor
Precision product UI (Linear / Vercel dashboard) with track-red accent. Clean cards, quiet chrome, data first.

## Palette (dark)
| Token | Hex | Use |
|-------|-----|-----|
| background | `#09090B` | page |
| card | `#111113` | panels, table shell |
| elevated | `#18181B` | hover / nested / sticky header |
| border | `#27272A` | hairline |
| input | `#27272A` | field borders |
| foreground | `#FAFAFA` | primary text |
| muted-foreground | `#A1A1AA` | secondary |
| primary | `#EF4444` | track red — P1, active, CTAs |
| primary-fg | `#FFF` | on primary |
| success | `#22C55E` | healthy sync |
| warning | `#EAB308` | stale |
| ring | `#EF4444` | focus |

## Typography
- Sans: `Inter` (UI)
- Mono: `JetBrains Mono` (lap times, ranks, dates)
- Display accents: Inter 600/700, tracking-tight
- Tabular numerals on all timing columns

## Layout
- Max width 1400px; 12px card radius; 8px control radius
- Sidebar 280px · content flex · detail 320px
- Card padding 16–20px; gap 16px
- Table row 48px; sticky header; zebra optional (subtle)

## Components (21st/shadcn patterns)
- **Card** — rounded-xl border bg-card
- **Badge** — pill, muted / outline / destructive
- **Button** — solid primary, ghost, outline; 36px height
- **Input / Select** — 36px, rounded-lg, border-input
- **Table** — data table with mono timing column
- **Sidebar nav item** — rounded-md, active = elevated + left accent
- **Leaderboard row** — rank chip P1–P3, brand meta, time right-aligned mono

## Motion
120ms ease. No neon, no heavy gradients.

## Sources
- 21st.dev Modern Minimal theme tokens (Serafim)
- 21st.dev Card / Leaderboard Card patterns
- shadcn/ui conventions
- reactbits.dev: Spotlight Card, Magic Bento, Border Glow, Blur text entrance, Modal dialog

## Page structure
1. Topbar (search / sync / lang)
2. **Hero** — blur-in title, eyebrow pulse, CTA, Magic Bento stats with Spotlight hover
3. App shell — track + class + filters | leaderboard | detail
4. News list · Modal compare · Footer disclaimer
