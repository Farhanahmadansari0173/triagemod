# ⚡ TriageMod — AI-Powered Mod Queue Triage for Reddit

> **Reddit Mod Tools & Migrated Apps Hackathon 2026 Submission**  
> Category: **Best New Mod Tool**

---

## 🎯 What It Does

TriageMod is a Devvit moderation app that automatically scores every item in your subreddit's mod queue by severity — so mods stop wasting time on false reports and instantly know what needs urgent attention.

**Every reported post and comment gets an AI-generated severity score:**

| Score | Meaning | Examples |
|-------|---------|---------|
| 🔴 **CRITICAL** | Act immediately | Harassment, doxxing, hate speech, spam waves |
| 🟡 **REVIEW** | Needs mod judgment | Borderline content, rule ambiguity |
| 🟢 **LOW** | Likely false/minor | Disagreements, meta-complaints, minor formatting |

---

## 🚀 Key Features

### 1. Real-Time Auto-Triage
- Scores new reports **the moment they arrive** via `PostReport` and `CommentReport` triggers
- Background job refreshes the full queue **every 15 minutes**
- Zero configuration required — install and it just works

### 2. Dashboard Custom Post
- Mods open a visual dashboard showing the entire ranked queue
- Filter by severity (ALL / 🔴 / 🟡 / 🟢) with one tap
- Shows: severity, content type, report count, report reason, AI explanation, author
- "View" button navigates directly to the content
- Tracks cumulative stats: approvals and removals over time

### 3. On-Demand Scoring (Context Menu)
- Right-click any post or comment → **"TriageMod: Score this post/comment"**
- Instantly shows severity + reason in a toast notification
- Works outside the dashboard for quick spot-checks

### 4. Smart Fallback
- Uses **Claude Haiku** (via Anthropic API) for nuanced AI scoring when an API key is configured
- Falls back to **keyword heuristics** automatically if no key is set — meaning it works out of the box with no setup at all

### 5. Mod Action Sync
- When a mod **removes or approves** content, it's automatically cleared from the triage queue
- Prevents duplicate work and keeps the queue accurate

---

## 📦 Installation

### From the Devvit App Directory
1. Search for **TriageMod** in the [Devvit App Directory](https://developers.reddit.com/apps)
2. Click **Install** on your subreddit
3. *(Optional)* Go to **App Settings → TriageMod** and add your Anthropic API key for AI scoring

### For Developers
```bash
# Prerequisites: Node.js 18+, npm
npm install -g devvit

# Clone and install
git clone <repo-url>
cd triagemod
npm install

# Log in with your Reddit account
devvit login

# Playtest on your test subreddit
devvit playtest r/YOUR_TEST_SUBREDDIT

# Upload to App Directory
devvit upload
devvit publish
```

---

## ⚙️ Configuration

| Setting | Required | Description |
|---------|----------|-------------|
| `anthropic_api_key` | No | Anthropic API key for Claude Haiku AI scoring. Without it, heuristic scoring is used. Get one at [console.anthropic.com](https://console.anthropic.com) |

---

## 🏗️ Technical Architecture

```
TriageMod
├── Triggers
│   ├── AppInstall / AppUpgrade  → schedules 15-min refresh job
│   ├── PostReport / CommentReport → auto-triage on new reports
│   ├── PostRemove / PostApprove  → sync queue with mod actions
├── Scheduled Job
│   └── refresh_triage_queue (*/15 * * * *) → scores up to 30 items
├── Menu Items (mod-only)
│   ├── "Score this post" → instant on-demand triage
│   ├── "Score this comment" → instant on-demand triage
│   └── "Open Dashboard" → creates dashboard custom post
├── Custom Post: TriageMod Dashboard
│   └── Renders ranked queue with filter UI
└── Redis Storage
    ├── triagemod:queue:{subreddit} (sorted set, score = severity)
    ├── triagemod:item:{id} (JSON triage result)
    └── triagemod:stats:{subreddit} (approval/removal counters)
```

### AI Scoring
TriageMod calls **Claude Haiku** with the content + report reasons and asks it to classify severity. The prompt is engineered to return structured JSON for reliable parsing. If the API call fails for any reason, it falls back to keyword-based heuristics — so the app is resilient.

### Data Storage
All data is stored in **Devvit Redis**:
- Sorted set ordered by severity (critical=3, review=2, low=1) enables instant ranked retrieval
- Each item stored as JSON for full detail access
- Stats persisted across sessions for cumulative mod metrics

---

## 🎯 Community Impact

### Who benefits most

**Large, busy subreddits** with 100+ reports/day are the primary target. Today, mods in these communities process their modqueue linearly — first in, first out — meaning a wave of spam can bury a single critical harassment post for hours.

TriageMod inverts this: **critical items always surface first.**

### Estimated time savings

Based on research (Bajpai & Chandrasekharan, 2025), Reddit mods spend significant time triaging the modqueue before making decisions. TriageMod eliminates this triage step entirely, estimated at **30–60% of queue-processing time** for busy subreddits.

### Example communities that would benefit

- **r/worldnews** (~500k WAU) — high report volume, critical content (doxxing, misinformation) needs instant attention
- **r/AmITheAsshole** — frequent harassment reports that vary wildly in severity
- **r/leagueoflegends** — large gaming community with daily spam waves and rule-edge cases

---

## 🛡️ Compliance

- Built entirely on **Devvit** using `@devvit/public-api`
- Only accesses data the app is explicitly granted via `Devvit.configure()`
- API key stored as an **encrypted secret** via Devvit settings (`isSecret: true`)
- All mod actions are logged and attributed properly
- Compliant with [Devvit Rules](https://developers.reddit.com/docs/devvit_rules)

---

## 🔮 Roadmap (post-hackathon)

- **Bulk actions** from the dashboard (approve/remove multiple low-severity items at once)
- **Per-subreddit rule mapping** — teach TriageMod your specific rules for higher accuracy
- **Mod team analytics** — track which mods handle which severity tiers and identify burnout signals
- **Pattern detection** — alert mods when a coordinated reporting wave is detected
- **Integration with Reddit Toolbox usernotes** — surface user history alongside triage score

---

## 👤 Team

Submitted by: `u/ansarifarhan-ah`

---

*Built with ❤️ for Reddit moderators — the unsung heroes of every community.*
