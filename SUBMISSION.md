# TriageMod — Devpost Submission

## App Listing
https://developers.reddit.com/apps/triagemod

## Reddit Usernames
- u/ansarifarhan-ah

---

## Tool Overview

TriageMod is an AI-powered moderation triage app built on Devvit that automatically scores every item in a subreddit's mod queue by severity — Critical, Review, or Low — so moderators instantly know what needs urgent attention and stop wasting time processing false reports.

### Core Capabilities

**Automatic Real-Time Triage**
Every new report triggers an instant severity score. When a post or comment is reported, TriageMod fires immediately via Devvit's PostReport/CommentReport event triggers. It sends the content and report reason to Claude Haiku (Anthropic's fast AI model) which classifies it as Critical (harassment, doxxing, hate speech, illegal content), Review (borderline rule violations needing judgment), or Low (likely false reports, minor complaints). A one-sentence explanation is stored alongside the score so mods understand the AI's reasoning at a glance.

**Background Queue Refresh**
A scheduled job runs every 15 minutes, pulling the full mod queue and scoring any unscored items. This catches reports that arrived before the app was installed and ensures the queue never goes stale.

**Visual Dashboard**
Mods open the TriageMod Dashboard by clicking "TriageMod: Open Dashboard" in the subreddit menu. This creates a custom post that renders the entire ranked queue — Critical items at the top, Low at the bottom. Each item shows the severity badge, content type (post/comment), report count, top report reason, AI explanation, and author. Mods can filter the view to show only a specific severity tier. A "View" button navigates directly to the content for action. A footer tracks cumulative approvals and removals over time.

**On-Demand Scoring**
Mods can right-click any post or comment and select "TriageMod: Score this post/comment" from the context menu. The severity and reason appear instantly as a toast notification — useful for checking content outside the normal queue flow.

**Mod Action Sync**
When a mod approves or removes content anywhere on Reddit, TriageMod automatically clears that item from its queue via PostRemove/PostApprove triggers. The queue stays perfectly in sync with real mod decisions.

**Resilient Fallback**
If no Anthropic API key is configured, TriageMod falls back to keyword-based heuristics automatically. The app works out of the box with zero setup — the AI key is purely optional and enhances accuracy.

### How Moderators Use It

1. Install TriageMod from the App Directory on their subreddit
2. Click "TriageMod: Open Dashboard" from the subreddit menu (one-time setup)
3. From that point forward, every reported item is auto-scored and ranked
4. Each mod session starts with the dashboard — Critical items are at the top, ready for immediate action
5. For quick checks while browsing, use the right-click context menu on any post or comment

### Technical Summary
- Language: TypeScript
- Framework: Devvit (custom post + triggers + scheduler + menu items + settings)
- Storage: Devvit Redis (sorted set for ranked queue, JSON per item, stats counter)
- AI: Claude Haiku via Anthropic API (with heuristic fallback)
- Permissions used: redditAPI, redis, http

---

## Project Impact

### Community 1: r/worldnews (~28M members, high daily WAU)

r/worldnews receives hundreds of reports per day. During breaking news events, coordinated harassment campaigns and doxxing attempts can flood the queue simultaneously with thousands of low-severity spam reports. Today, mods process the queue roughly in chronological order — meaning a critical doxxing post can sit unactioned for hours while mods clear through spam.

TriageMod would surface that doxxing attempt immediately as Critical, allowing mods to action it within minutes. The spam wave would be scored Low and batched at the bottom of the queue. Estimated impact: reduce time-to-action on critical violations from hours to under 5 minutes.

### Community 2: r/AmITheAsshole (~4M members)

AITA moderators deal with a unique problem: a high volume of reports that are highly subjective. Users frequently report posts simply because they disagree with the verdict, not because of a genuine rule violation. These false reports consume enormous mod time.

TriageMod would classify these subjective-disagreement reports as Low, allowing AITA mods to skip them in their first pass and focus on genuine harassment and rule violations. Estimated impact: reduce false-report processing time by 40–60%.

### Community 3: r/leagueoflegends (~1.5M members)

Gaming subreddits experience predictable spam waves tied to game events, patch releases, and drama cycles. During these waves, mods are overwhelmed and genuine harassment gets buried.

TriageMod's pattern of scoring high-report-count items higher and grouping similar report reasons would help LoL mods identify spam waves quickly and focus on individual harassment cases that would otherwise be invisible in the noise.

### Broader Impact

Every subreddit with any report volume benefits from TriageMod. The core value proposition — know what matters most before you open the queue — is universal. Reddit has over 100,000 active moderated subreddits. Even modest time savings per subreddit scales to an enormous reduction in moderator burnout across the platform.

---

## Optional: Developer Platform Feedback

TriageMod was built during the hackathon and the Devvit platform made several things impressively easy:

**What worked great:**
- The trigger system (PostReport, CommentReport, PostRemove, PostApprove) is exactly what mod tools need — real-time hooks into Reddit's event stream. This is the killer feature of Devvit vs. external bots.
- Redis integration is seamless and the sorted set support is perfect for ranked queues.
- The settings system with isSecret:true for API keys is thoughtful and secure.
- Devvit.configure() permission declarations make the security model clear.

**Friction points encountered:**
- The modqueue API (context.reddit.getModQueue) is not clearly documented with TypeScript types. We had to infer the shape from examples.
- Custom post height constraints (tall/regular) make it hard to build a dense dashboard. A "full" height option or scrollable viewport with more control would help mod tool UX.
- Hot-reloading during playtest occasionally desynced the trigger registrations, requiring a full re-upload to fix.
- The http capability with external APIs would benefit from a built-in secrets vault that can also store non-setting secrets (e.g. rotating tokens).

**Feature requests:**
- Bulk mod actions API (approve/remove multiple items in one call) — would unlock batch processing workflows
- Access to the full modqueue listing including report reasons as structured data (not just count)
- A way to render a sidebar widget or mod toolbox overlay, not just custom posts, for persistent mod UI
