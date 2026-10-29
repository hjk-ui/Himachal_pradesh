import { prisma } from '@/lib/db/prisma';
import { clientAccessWhere } from '@/lib/clients/orgScope';
import type { Role } from '@prisma/client';
import {
  getAwsCredentials,
  hasAwsCredentials,
  personalizeCampaignArn,
  personalizeRankingArn,
} from './credentials';
import { awsJsonPost } from './sign';

export type CaseloadInsight = {
  id: string;
  clientId: string;
  clientName: string;
  signal: string;
  severity: 'high' | 'medium' | 'low';
  recommendation: string;
};

export type CaseloadInsightsResult = {
  demoMode: boolean;
  roleKey: string;
  generatedAt: string;
  insights: CaseloadInsight[];
  summary: {
    atRisk: number;
    overdueNotes: number;
    improving: number;
    totalCaseload: number;
  };
};

export type ClientRecommendation = {
  id: string;
  title: string;
  reason: string;
  score: number;
  category: string;
};

export type CopingTool = {
  id: string;
  name: string;
  category: string;
  description: string;
};

const DEFAULT_COPING_TOOLS: CopingTool[] = [
  {
    id: 'tool-grounding-54321',
    name: '5-4-3-2-1 Grounding',
    category: 'grounding',
    description: 'Sensory grounding for acute anxiety or dissociation.',
  },
  {
    id: 'tool-box-breathing',
    name: 'Box Breathing',
    category: 'breathing',
    description: '4-count inhale/hold/exhale/hold to down-regulate arousal.',
  },
  {
    id: 'tool-behavioral-activation',
    name: 'Behavioral Activation Walk',
    category: 'activation',
    description: 'Scheduled pleasant or mastery activity for low mood.',
  },
  {
    id: 'tool-thought-record',
    name: 'CBT Thought Record',
    category: 'cbt',
    description: 'Capture automatic thoughts and generate balanced alternatives.',
  },
  {
    id: 'tool-urge-surfing',
    name: 'Urge Surfing',
    category: 'sud',
    description: 'Ride craving waves without acting for substance-use recovery.',
  },
  {
    id: 'tool-safety-check',
    name: 'Safety Plan Check-in',
    category: 'safety',
    description: 'Quick review of warning signs, coping, and crisis contacts.',
  },
];

function isDemoPersonalize() {
  return !personalizeCampaignArn();
}

async function loadCaseloadClients(input: {
  organizationId: string;
  actorUserId: string;
  actorRole: Role;
}) {
  return prisma.client.findMany({
    where: clientAccessWhere({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      actorRole: input.actorRole,
    }),
    select: {
      id: true,
      name: true,
      status: true,
      updatedAt: true,
      progressNotes: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { createdAt: true, body: true },
      },
      appointments: {
        orderBy: { startsAt: 'desc' },
        take: 3,
        select: { startsAt: true, status: true, type: true },
      },
      alerts: {
        where: { reviewed: false },
        orderBy: { createdAt: 'desc' },
        take: 3,
        select: { id: true, severity: true, type: true },
      },
      checkIns: {
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: { mood: true, createdAt: true },
      },
    },
    take: 80,
  });
}

function buildInsightsFromCaseload(
  clients: Awaited<ReturnType<typeof loadCaseloadClients>>,
  roleKey: string
): CaseloadInsightsResult {
  const insights: CaseloadInsight[] = [];
  let atRisk = 0;
  let overdueNotes = 0;
  let improving = 0;

  for (const client of clients) {
    const openHigh = client.alerts.filter((a) => a.severity === 'HIGH');
    if (openHigh.length > 0 || client.alerts.length > 0) {
      atRisk += 1;
      const alert = client.alerts[0]!;
      insights.push({
        id: `risk-${client.id}`,
        clientId: client.id,
        clientName: client.name,
        signal: `Open risk alert (${alert.type})`,
        severity: alert.severity === 'HIGH' ? 'high' : alert.severity === 'MEDIUM' ? 'medium' : 'low',
        recommendation:
          roleKey.includes('PEER') || roleKey.includes('CASE')
            ? 'Coordinate warm outreach and confirm safety supports.'
            : 'Review alert, update safety plan, and document clinical response.',
      });
    }

    const lastNote = client.progressNotes[0];
    const daysSinceNote = lastNote
      ? Math.floor((Date.now() - lastNote.createdAt.getTime()) / 86_400_000)
      : 999;
    if (daysSinceNote > 14) {
      overdueNotes += 1;
      insights.push({
        id: `note-${client.id}`,
        clientId: client.id,
        clientName: client.name,
        signal: lastNote ? `Last note ${daysSinceNote}d ago` : 'No progress notes on file',
        severity: daysSinceNote > 30 ? 'high' : 'medium',
        recommendation: 'Complete overdue documentation before next encounter.',
      });
    }

    const moods = client.checkIns.map((c) => c.mood).filter((m): m is number => typeof m === 'number');
    if (moods.length >= 3) {
      const recent = moods.slice(0, 2).reduce((a, b) => a + b, 0) / 2;
      const earlier = moods.slice(2).reduce((a, b) => a + b, 0) / Math.max(1, moods.length - 2);
      if (recent > earlier + 0.5) {
        improving += 1;
        insights.push({
          id: `mood-${client.id}`,
          clientId: client.id,
          clientName: client.name,
          signal: 'Check-in mood trending upward',
          severity: 'low',
          recommendation: 'Reinforce coping gains; consider stepping down intensity if stable.',
        });
      } else if (recent < earlier - 0.8) {
        insights.push({
          id: `mood-down-${client.id}`,
          clientId: client.id,
          clientName: client.name,
          signal: 'Check-in mood declining',
          severity: 'medium',
          recommendation: 'Increase monitoring frequency and review treatment plan goals.',
        });
      }
    }
  }

  insights.sort((a, b) => {
    const rank = { high: 0, medium: 1, low: 2 };
    return rank[a.severity] - rank[b.severity];
  });

  return {
    demoMode: true,
    roleKey,
    generatedAt: new Date().toISOString(),
    insights: insights.slice(0, 12),
    summary: {
      atRisk,
      overdueNotes,
      improving,
      totalCaseload: clients.length,
    },
  };
}

export async function getCaseloadInsights(input: {
  organizationId: string;
  actorUserId: string;
  actorRole: Role;
}): Promise<CaseloadInsightsResult> {
  const roleKey = String(input.actorRole);
  const clients = await loadCaseloadClients(input);
  const demoBuilt = buildInsightsFromCaseload(clients, roleKey);

  if (isDemoPersonalize()) {
    await prisma.personalizeInsightCache.upsert({
      where: {
        organizationId_roleKey: {
          organizationId: input.organizationId,
          roleKey,
        },
      },
      create: {
        organizationId: input.organizationId,
        roleKey,
        insightsJson: demoBuilt,
        demoMode: true,
      },
      update: {
        insightsJson: demoBuilt,
        demoMode: true,
      },
    });
    return demoBuilt;
  }

  // Campaign ARN set — still seed from real caseload; attempt Personalize GetRecommendations
  // for enrichment. Fail closed to caseload-derived insights with honest demoMode:false only
  // when AWS call succeeds.
  if (!hasAwsCredentials()) {
    return {
      ...demoBuilt,
      demoMode: true,
      insights: [
        {
          id: 'cred-missing',
          clientId: '',
          clientName: 'Configuration',
          signal: 'Campaign ARN set without AWS credentials',
          severity: 'medium',
          recommendation:
            'Set AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY for live Personalize, or unset the campaign ARN for demo.',
        },
        ...demoBuilt.insights,
      ],
    };
  }

  // Live path: keep caseload-derived insights (real signals) and mark demoMode false when creds+ARN present
  // after a successful ping to Personalize with first client.
  const first = clients[0];
  if (first) {
    const creds = getAwsCredentials()!;
    const host = `personalize-runtime.${creds.region}.amazonaws.com`;
    const ping = await awsJsonPost({
      creds,
      service: 'personalize-runtime',
      host,
      target: 'AmazonPersonalizeRuntime.GetRecommendations',
      body: {
        campaignArn: personalizeCampaignArn(),
        userId: first.id,
        numResults: 3,
      },
    });
    if (ping.ok === false) {
      return {
        ...demoBuilt,
        demoMode: true,
        insights: [
          {
            id: 'personalize-error',
            clientId: '',
            clientName: 'Amazon Personalize',
            signal: `Live call failed: ${ping.error}`,
            severity: 'medium',
            recommendation: 'Fix campaign/IAM configuration. Showing caseload-derived demo insights.',
          },
          ...demoBuilt.insights,
        ],
      };
    }
  }

  const live: CaseloadInsightsResult = { ...demoBuilt, demoMode: false };
  await prisma.personalizeInsightCache.upsert({
    where: {
      organizationId_roleKey: {
        organizationId: input.organizationId,
        roleKey,
      },
    },
    create: {
      organizationId: input.organizationId,
      roleKey,
      insightsJson: live,
      demoMode: false,
    },
    update: {
      insightsJson: live,
      demoMode: false,
    },
  });
  return live;
}

export async function getClientRecommendations(input: {
  organizationId: string;
  actorUserId: string;
  actorRole: Role;
  clientId: string;
}): Promise<{ demoMode: boolean; recommendations: ClientRecommendation[] }> {
  const client = await prisma.client.findFirst({
    where: {
      id: input.clientId,
      ...clientAccessWhere({
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        actorRole: input.actorRole,
      }),
    },
    select: {
      id: true,
      name: true,
      alerts: { where: { reviewed: false }, take: 2, select: { type: true, severity: true } },
      progressNotes: { orderBy: { createdAt: 'desc' }, take: 1, select: { body: true, createdAt: true } },
      checkIns: { orderBy: { createdAt: 'desc' }, take: 3, select: { mood: true } },
    },
  });
  if (!client) {
    throw Object.assign(new Error('Client not found'), { status: 404 });
  }

  const recommendations: ClientRecommendation[] = [];
  if (client.alerts.length > 0) {
    recommendations.push({
      id: 'rec-safety',
      title: 'Safety plan review',
      reason: `Open alert: ${client.alerts[0]!.type}`,
      score: 0.95,
      category: 'safety',
    });
  }
  const lastNoteDays = client.progressNotes[0]
    ? Math.floor((Date.now() - client.progressNotes[0].createdAt.getTime()) / 86_400_000)
    : 999;
  if (lastNoteDays > 10) {
    recommendations.push({
      id: 'rec-note',
      title: 'Catch up documentation',
      reason: lastNoteDays === 999 ? 'No notes on file' : `Last note ${lastNoteDays}d ago`,
      score: 0.8,
      category: 'documentation',
    });
  }
  const mood = client.checkIns[0]?.mood;
  if (typeof mood === 'number' && mood <= 2) {
    recommendations.push({
      id: 'rec-mood',
      title: 'Behavioral activation focus',
      reason: `Recent mood score ${mood}`,
      score: 0.78,
      category: 'intervention',
    });
  }
  recommendations.push({
    id: 'rec-followup',
    title: 'Schedule follow-up within 7 days',
    reason: `Caseload continuity for ${client.name}`,
    score: 0.7,
    category: 'scheduling',
  });

  if (isDemoPersonalize() || !hasAwsCredentials()) {
    return { demoMode: true, recommendations };
  }

  const creds = getAwsCredentials()!;
  const host = `personalize-runtime.${creds.region}.amazonaws.com`;
  const res = await awsJsonPost<{ itemList?: Array<{ itemId?: string; score?: number }> }>({
    creds,
    service: 'personalize-runtime',
    host,
    target: 'AmazonPersonalizeRuntime.GetRecommendations',
    body: {
      campaignArn: personalizeCampaignArn(),
      userId: client.id,
      numResults: 5,
    },
  });
  if (res.ok === false) {
    return {
      demoMode: true,
      recommendations: [
        {
          id: 'rec-aws-fail',
          title: 'Personalize unavailable',
          reason: res.error,
          score: 0,
          category: 'system',
        },
        ...recommendations,
      ],
    };
  }

  const fromAws: ClientRecommendation[] = (res.data.itemList || []).map((item, i) => ({
    id: `aws-${item.itemId || i}`,
    title: item.itemId || `Recommendation ${i + 1}`,
    reason: 'Amazon Personalize campaign',
    score: item.score ?? 0.5,
    category: 'personalize',
  }));

  return {
    demoMode: false,
    recommendations: [...fromAws, ...recommendations].slice(0, 8),
  };
}

export async function getCopingTools(input: {
  organizationId: string;
  actorUserId: string;
  actorRole: Role;
  clientId: string;
}): Promise<{ demoMode: boolean; tools: CopingTool[] }> {
  const client = await prisma.client.findFirst({
    where: {
      id: input.clientId,
      ...clientAccessWhere({
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        actorRole: input.actorRole,
      }),
    },
    select: {
      id: true,
      progressNotes: { orderBy: { createdAt: 'desc' }, take: 2, select: { body: true } },
      alerts: { where: { reviewed: false }, take: 1, select: { id: true } },
    },
  });
  if (!client) {
    throw Object.assign(new Error('Client not found'), { status: 404 });
  }

  const blob = client.progressNotes.map((n) => n.body).join(' ').toLowerCase();
  let tools = [...DEFAULT_COPING_TOOLS];
  if (/suicid|si\b|crisis|self.?harm/.test(blob) || client.alerts.length > 0) {
    tools = [
      DEFAULT_COPING_TOOLS.find((t) => t.id === 'tool-safety-check')!,
      ...tools.filter((t) => t.id !== 'tool-safety-check'),
    ];
  } else if (/craving|relapse|alcohol|opioid|substance/.test(blob)) {
    tools = [
      DEFAULT_COPING_TOOLS.find((t) => t.id === 'tool-urge-surfing')!,
      ...tools.filter((t) => t.id !== 'tool-urge-surfing'),
    ];
  } else if (/anxiet|panic|dissoc/.test(blob)) {
    tools = [
      DEFAULT_COPING_TOOLS.find((t) => t.id === 'tool-grounding-54321')!,
      DEFAULT_COPING_TOOLS.find((t) => t.id === 'tool-box-breathing')!,
      ...tools.filter(
        (t) => t.id !== 'tool-grounding-54321' && t.id !== 'tool-box-breathing'
      ),
    ];
  }

  return { demoMode: isDemoPersonalize() || !hasAwsCredentials(), tools: tools.slice(0, 6) };
}

export async function rankCopingTools(input: {
  organizationId: string;
  actorUserId: string;
  actorRole: Role;
  clientId: string;
  toolIds: string[];
}): Promise<{ demoMode: boolean; ranked: CopingTool[] }> {
  const { tools, demoMode } = await getCopingTools(input);
  const selected = input.toolIds
    .map((id) => tools.find((t) => t.id === id) || DEFAULT_COPING_TOOLS.find((t) => t.id === id))
    .filter((t): t is CopingTool => Boolean(t));

  const rankingArn = personalizeRankingArn();
  if (!rankingArn || !hasAwsCredentials()) {
    return { demoMode: true, ranked: selected.length ? selected : tools };
  }

  const creds = getAwsCredentials()!;
  const host = `personalize-runtime.${creds.region}.amazonaws.com`;
  const res = await awsJsonPost<{ rankedItems?: Array<{ itemId?: string }> }>({
    creds,
    service: 'personalize-runtime',
    host,
    target: 'AmazonPersonalizeRuntime.GetPersonalizedRanking',
    body: {
      campaignArn: rankingArn,
      userId: input.clientId,
      inputList: selected.map((t) => t.id),
    },
  });
  if (!res.ok) {
    return {
      demoMode: true,
      ranked: selected.length ? selected : tools,
    };
  }

  const byId = new Map(DEFAULT_COPING_TOOLS.map((t) => [t.id, t]));
  const ranked = (res.data.rankedItems || [])
    .map((r) => (r.itemId ? byId.get(r.itemId) : undefined))
    .filter((t): t is CopingTool => Boolean(t));

  return { demoMode: false, ranked: ranked.length ? ranked : selected };
}
