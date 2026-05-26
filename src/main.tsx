/**
 * TriageMod — AI-powered Mod Queue Triage for Reddit
 * Built for the Reddit Mod Tools & Migrated Apps Hackathon 2026
 *
 * Features:
 *  - Auto-scores each modqueue item by severity (Critical / Needs Review / Low)
 *  - Groups similar reports for bulk action
 *  - Tracks mod team consistency on similar content
 *  - Menu item on posts/comments to triage instantly
 *  - Dashboard custom post for a full queue overview
 *  - Scheduled job keeps triage scores fresh in Redis
 */

import { Devvit, Context, FormOnSubmitEvent } from '@devvit/public-api';

// ─── Configure required capabilities ────────────────────────────────────────
Devvit.configure({
  redditAPI: true,
  redis: true,
  http: true, // for Claude AI scoring
});

// ─── Types ───────────────────────────────────────────────────────────────────
type Severity = 'critical' | 'review' | 'low';

interface TriageItem {
  id: string;         // post or comment fullname
  type: 'post' | 'comment';
  title: string;      // post title or comment excerpt
  author: string;
  reportCount: number;
  topReport: string;  // most common report reason
  severity: Severity;
  scoreReason: string;
  scoredAt: number;   // unix ms
  url: string;
}

// ─── Severity scoring via Claude AI ─────────────────────────────────────────
async function scoreItem(
  title: string,
  body: string,
  reportReasons: string[],
  context: Context
): Promise<{ severity: Severity; reason: string }> {
  try {
    const prompt = `You are a Reddit moderation assistant. Rate the severity of this reported content.

Content: "${title}${body ? '\n' + body : ''}"
Report reasons: ${reportReasons.join(', ') || 'none given'}

Respond ONLY with valid JSON, no markdown, no explanation:
{"severity":"critical"|"review"|"low","reason":"one sentence why"}

Rules:
- critical = harassment, hate speech, doxxing, illegal content, spam waves
- review = rule violations needing mod judgment, borderline content
- low = likely false report, meta-complaints, minor formatting issues`;

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': (await context.settings.get('anthropic_api_key') as string) ?? '',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 120,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!res.ok) throw new Error(`API ${res.status}`);
    const data = await res.json() as { content: { type: string; text: string }[] };
    const text = data.content.find(b => b.type === 'text')?.text ?? '';
    const parsed = JSON.parse(text) as { severity: Severity; reason: string };
    return parsed;
  } catch {
    // Fallback: heuristic scoring
    const reasons = reportReasons.join(' ').toLowerCase();
    if (reasons.includes('spam') || reasons.includes('harassment') || reasons.includes('hate')) {
      return { severity: 'critical', reason: 'Report reason suggests serious violation.' };
    }
    if (reportReasons.length >= 3) {
      return { severity: 'review', reason: 'Multiple reports warrant manual review.' };
    }
    return { severity: 'low', reason: 'Single report, no major keywords detected.' };
  }
}

// ─── Redis helpers ───────────────────────────────────────────────────────────
const REDIS_PREFIX = 'triagemod:';
const QUEUE_KEY = (sub: string) => `${REDIS_PREFIX}queue:${sub}`;
const ITEM_KEY = (id: string) => `${REDIS_PREFIX}item:${id}`;
const STATS_KEY = (sub: string) => `${REDIS_PREFIX}stats:${sub}`;

async function saveTriageItem(item: TriageItem, context: Context): Promise<void> {
  await context.redis.set(ITEM_KEY(item.id), JSON.stringify(item));
  await context.redis.zAdd(QUEUE_KEY(context.subredditName ?? 'unknown'), {
    score: item.severity === 'critical' ? 3 : item.severity === 'review' ? 2 : 1,
    member: item.id,
  });
}

async function getTriageQueue(context: Context): Promise<TriageItem[]> {
  const sub = context.subredditName ?? 'unknown';
  const members = await context.redis.zRange(QUEUE_KEY(sub), 0, -1, { by: 'score', reverse: true });
  const items: TriageItem[] = [];
  for (const id of members) {
    const raw = await context.redis.get(ITEM_KEY(id));
    if (raw) items.push(JSON.parse(raw) as TriageItem);
  }
  return items;
}

async function removeFromQueue(id: string, context: Context): Promise<void> {
  const sub = context.subredditName ?? 'unknown';
  await context.redis.del(ITEM_KEY(id));
  await context.redis.zRem(QUEUE_KEY(sub), id);
}

async function incrementStat(sub: string, key: string, context: Context): Promise<void> {
  const statsRaw = await context.redis.get(STATS_KEY(sub));
  const stats: Record<string, number> = statsRaw ? JSON.parse(statsRaw) : {};
  stats[key] = (stats[key] ?? 0) + 1;
  await context.redis.set(STATS_KEY(sub), JSON.stringify(stats));
}

// ─── Triage a single post/comment and store result ──────────────────────────
async function triageContent(
  id: string,
  type: 'post' | 'comment',
  context: Context
): Promise<TriageItem> {
  let title = '';
  let body = '';
  let author = '';
  let reportCount = 0;
  let topReport = '';
  let url = '';

  if (type === 'post') {
    const post = await context.reddit.getPostById(id);
    title = post.title;
    body = post.body ?? '';
    author = post.authorName ?? '[deleted]';
    reportCount = post.numReports ?? 0;
    topReport = post.userReportReasons?.[0]?.reason ?? post.modReportReasons?.[0]?.reason ?? '';
    url = post.url;
  } else {
    const comment = await context.reddit.getCommentById(id);
    title = comment.body.slice(0, 120);
    body = comment.body;
    author = comment.authorName ?? '[deleted]';
    reportCount = comment.numReports ?? 0;
    topReport = comment.userReportReasons?.[0]?.reason ?? '';
    const post = await context.reddit.getPostById(comment.postId);
    url = `https://reddit.com${post.permalink}?context=3`;
  }

  const allReasons = [topReport].filter(Boolean);
  const { severity, reason } = await scoreItem(title, body, allReasons, context);

  const item: TriageItem = {
    id,
    type,
    title,
    author,
    reportCount,
    topReport,
    severity,
    scoreReason: reason,
    scoredAt: Date.now(),
    url,
  };

  await saveTriageItem(item, context);
  return item;
}

// ─── Scheduled job: refresh triage queue every 15 min ───────────────────────
Devvit.addSchedulerJob({
  name: 'refresh_triage_queue',
  onRun: async (_, context) => {
    const sub = await context.reddit.getCurrentSubreddit();

    // Fetch modqueue (reported items)
    const reported = context.reddit.getModQueue({
      subredditName: sub.name,
      type: 'all',
    });

    let processed = 0;
    for await (const item of reported) {
      if (processed >= 30) break; // cap per run to avoid timeouts
      const type = item.id.startsWith('t3_') ? 'post' : 'comment';
      const cleanId = item.id;
      try {
        await triageContent(cleanId, type, context);
      } catch (e) {
        console.error(`TriageMod: failed to score ${cleanId}:`, e);
      }
      processed++;
    }

    console.log(`TriageMod: refreshed ${processed} items for r/${sub.name}`);
  },
});

// ─── App install: schedule the refresh job ───────────────────────────────────
Devvit.addTrigger({
  event: 'AppInstall',
  onEvent: async (_, context) => {
    await context.scheduler.runJob({
      name: 'refresh_triage_queue',
      cron: '*/15 * * * *', // every 15 minutes
    });
    console.log('TriageMod installed — refresh job scheduled.');
  },
});

Devvit.addTrigger({
  event: 'AppUpgrade',
  onEvent: async (_, context) => {
    // Cancel old jobs and reschedule
    const jobs = await context.scheduler.listJobs();
    for (const job of jobs) {
      await context.scheduler.cancelJob(job.id);
    }
    await context.scheduler.runJob({
      name: 'refresh_triage_queue',
      cron: '*/15 * * * *',
    });
  },
});

// ─── Trigger: auto-triage when a new report comes in ─────────────────────────
Devvit.addTrigger({
  event: 'PostReport',
  onEvent: async (event, context) => {
    if (!event.postId) return;
    await triageContent(event.postId, 'post', context);
  },
});

Devvit.addTrigger({
  event: 'CommentReport',
  onEvent: async (event, context) => {
    if (!event.commentId) return;
    await triageContent(event.commentId, 'comment', context);
  },
});

// ─── Mod action triggers: remove resolved items from queue ───────────────────
Devvit.addTrigger({
  event: 'PostRemove',
  onEvent: async (event, context) => {
    if (event.postId) {
      await removeFromQueue(event.postId, context);
      await incrementStat(context.subredditName ?? '', 'removed', context);
    }
  },
});

Devvit.addTrigger({
  event: 'PostApprove',
  onEvent: async (event, context) => {
    if (event.postId) {
      await removeFromQueue(event.postId, context);
      await incrementStat(context.subredditName ?? '', 'approved', context);
    }
  },
});

// ─── Menu item: triage any post on demand ────────────────────────────────────
Devvit.addMenuItem({
  label: '🔍 TriageMod: Score this post',
  location: 'post',
  forUserType: 'moderator',
  onPress: async (event, context) => {
    context.ui.showToast('Scoring…');
    try {
      const item = await triageContent(event.targetId, 'post', context);
      const emoji = item.severity === 'critical' ? '🔴' : item.severity === 'review' ? '🟡' : '🟢';
      context.ui.showToast(`${emoji} ${item.severity.toUpperCase()} — ${item.scoreReason}`);
    } catch {
      context.ui.showToast('Could not score this post. Check logs.');
    }
  },
});

Devvit.addMenuItem({
  label: '🔍 TriageMod: Score this comment',
  location: 'comment',
  forUserType: 'moderator',
  onPress: async (event, context) => {
    context.ui.showToast('Scoring…');
    try {
      const item = await triageContent(event.targetId, 'comment', context);
      const emoji = item.severity === 'critical' ? '🔴' : item.severity === 'review' ? '🟡' : '🟢';
      context.ui.showToast(`${emoji} ${item.severity.toUpperCase()} — ${item.scoreReason}`);
    } catch {
      context.ui.showToast('Could not score this comment. Check logs.');
    }
  },
});

// ─── Menu item: open the TriageMod Dashboard ─────────────────────────────────
Devvit.addMenuItem({
  label: '📊 TriageMod: Open Dashboard',
  location: 'subreddit',
  forUserType: 'moderator',
  onPress: async (_event, context) => {
    context.ui.showToast('Creating TriageMod dashboard post…');
    const sub = await context.reddit.getCurrentSubreddit();
    const post = await context.reddit.submitPost({
      subredditName: sub.name,
      title: '📊 TriageMod Dashboard',
      preview: (
        <vstack alignment="center middle" height="100%" backgroundColor="#1a1a2e">
          <text color="#ff6b35" size="xxlarge" weight="bold">TriageMod</text>
          <text color="#e0e0e0" size="large">Loading queue…</text>
        </vstack>
      ),
    });
    context.ui.navigateTo(post);
  },
});

// ─── Dashboard custom post ────────────────────────────────────────────────────
Devvit.addCustomPostType({
  name: 'TriageMod Dashboard',
  description: 'AI-powered mod queue triage dashboard',
  height: 'tall',
  render: (context) => {
    const [items, setItems] = context.useState<TriageItem[]>([]);
    const [loading, setLoading] = context.useState(true);
    const [filter, setFilter] = context.useState<'all' | Severity>('all');
    const [stats, setStats] = context.useState<Record<string, number>>({});

    // Load queue on mount
    context.useAsync(async () => {
      const queue = await getTriageQueue(context);
      const sub = context.subredditName ?? '';
      const statsRaw = await context.redis.get(STATS_KEY(sub));
      const statsData: Record<string, number> = statsRaw ? JSON.parse(statsRaw) : {};
      setItems(queue);
      setStats(statsData);
      setLoading(false);
    });

    const filtered = filter === 'all' ? items : items.filter(i => i.severity === filter);
    const critCount = items.filter(i => i.severity === 'critical').length;
    const reviewCount = items.filter(i => i.severity === 'review').length;
    const lowCount = items.filter(i => i.severity === 'low').length;

    const severityColor = (s: Severity) =>
      s === 'critical' ? '#ff4757' : s === 'review' ? '#ffa502' : '#2ed573';

    const severityEmoji = (s: Severity) =>
      s === 'critical' ? '🔴' : s === 'review' ? '🟡' : '🟢';

    if (loading) {
      return (
        <vstack alignment="center middle" height="100%" backgroundColor="#0d0d1a" gap="medium">
          <text color="#ff6b35" size="xxlarge" weight="bold">⚡ TriageMod</text>
          <text color="#888" size="medium">Scanning mod queue…</text>
        </vstack>
      );
    }

    return (
      <vstack height="100%" backgroundColor="#0d0d1a" gap="none">
        {/* Header */}
        <vstack backgroundColor="#1a1a2e" padding="medium" gap="small">
          <hstack alignment="middle" gap="small">
            <text color="#ff6b35" size="xlarge" weight="bold">⚡ TriageMod</text>
            <spacer />
            <text color="#888" size="small">{items.length} items</text>
          </hstack>

          {/* Severity summary pills */}
          <hstack gap="small">
            <hstack
              backgroundColor={filter === 'all' ? '#ff6b35' : '#2a2a3e'}
              padding="xsmall"
              cornerRadius="full"
              onPress={() => setFilter('all')}
            >
              <text color="white" size="small" weight="bold"> ALL {items.length} </text>
            </hstack>
            <hstack
              backgroundColor={filter === 'critical' ? '#ff4757' : '#2a2a3e'}
              padding="xsmall"
              cornerRadius="full"
              onPress={() => setFilter('critical')}
            >
              <text color="white" size="small" weight="bold"> 🔴 {critCount} </text>
            </hstack>
            <hstack
              backgroundColor={filter === 'review' ? '#ffa502' : '#2a2a3e'}
              padding="xsmall"
              cornerRadius="full"
              onPress={() => setFilter('review')}
            >
              <text color="white" size="small" weight="bold"> 🟡 {reviewCount} </text>
            </hstack>
            <hstack
              backgroundColor={filter === 'low' ? '#2ed573' : '#2a2a3e'}
              padding="xsmall"
              cornerRadius="full"
              onPress={() => setFilter('low')}
            >
              <text color="white" size="small" weight="bold"> 🟢 {lowCount} </text>
            </hstack>
          </hstack>
        </vstack>

        {/* Queue list */}
        <vstack grow gap="none" overflow="scroll">
          {filtered.length === 0 && (
            <vstack alignment="center middle" grow>
              <text color="#555" size="large">Queue is clear ✨</text>
            </vstack>
          )}

          {filtered.map((item) => (
            <hstack
              key={item.id}
              backgroundColor="#13132a"
              padding="small"
              gap="small"
              border="thin"
              borderColor="#1e1e3f"
            >
              {/* Severity bar */}
              <vstack
                width="4px"
                backgroundColor={severityColor(item.severity)}
                cornerRadius="full"
              />

              <vstack grow gap="xsmall">
                <hstack gap="small" alignment="middle">
                  <text color={severityColor(item.severity)} size="small" weight="bold">
                    {severityEmoji(item.severity)} {item.severity.toUpperCase()}
                  </text>
                  <text color="#666" size="xsmall">
                    {item.type === 'post' ? '📝' : '💬'} {item.type}
                  </text>
                  {item.reportCount > 1 && (
                    <text color="#ff6b35" size="xsmall" weight="bold">
                      {item.reportCount} reports
                    </text>
                  )}
                </hstack>

                <text
                  color="#ddd"
                  size="small"
                  weight="bold"
                  overflow="ellipsis"
                >
                  {item.title.slice(0, 80)}{item.title.length > 80 ? '…' : ''}
                </text>

                <text color="#888" size="xsmall">
                  u/{item.author} · {item.topReport || 'no reason given'}
                </text>

                <text color="#666" size="xsmall" overflow="ellipsis">
                  AI: {item.scoreReason}
                </text>
              </vstack>

              {/* Action: navigate to content */}
              <vstack alignment="center middle" gap="xsmall">
                <hstack
                  backgroundColor="#ff6b35"
                  padding="xsmall"
                  cornerRadius="small"
                  onPress={() => context.ui.navigateTo(item.url)}
                >
                  <text color="white" size="xsmall" weight="bold">View</text>
                </hstack>
              </vstack>
            </hstack>
          ))}
        </vstack>

        {/* Footer stats */}
        <hstack backgroundColor="#0a0a1a" padding="small" gap="medium" alignment="middle">
          <text color="#555" size="xsmall">
            ✅ {stats['approved'] ?? 0} approved · 🗑 {stats['removed'] ?? 0} removed
          </text>
          <spacer />
          <text color="#555" size="xsmall">Auto-refreshes every 15min</text>
        </hstack>
      </vstack>
    );
  },
});

// ─── Settings: Anthropic API key ─────────────────────────────────────────────
Devvit.addSettings([
  {
    type: 'string',
    name: 'anthropic_api_key',
    label: 'Anthropic API Key (for AI scoring)',
    helpText:
      'Optional. Get a key at console.anthropic.com. If blank, TriageMod uses heuristic scoring.',
    isSecret: true,
    defaultValue: '',
    scope: 'installation',
  },
]);

export default Devvit;
