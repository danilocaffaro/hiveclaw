// ============================================================
// NEXUS Protocol Injection — Auto-injects squad protocols
// ============================================================
//
// This module provides squad context that gets injected into agent
// prompts at runtime by the squad-runner. Agents do NOT need any
// protocol knowledge in their system prompts — this module handles
// everything based on the agent's NEXUS role in the squad.
//
// Think of it as a "skill" or "plugin" that activates automatically
// when an agent participates in a squad.

export type NexusRole = 'po' | 'tech-lead' | 'qa-lead' | 'sre' | 'member';

export interface SquadMember {
  agentId: string;
  name: string;
  emoji: string;
  nexusRole: NexusRole;
}

/**
 * Build the protocol context block for an agent based on their NEXUS role.
 * This gets prepended to the agent's prompt when running in squad context.
 */
export function buildNexusProtocolContext(
  agent: SquadMember,
  allMembers: SquadMember[],
  squadName: string,
  isFirstTurn: boolean,
): string {
  const otherMembers = allMembers
    .filter(m => m.agentId !== agent.agentId)
    .map(m => `  - @${m.name} (${formatRole(m.nexusRole)})`)
    .join('\n');

  const roleBlock = ROLE_PROTOCOLS[agent.nexusRole] ?? ROLE_PROTOCOLS.member;

  return `
[SQUAD PROTOCOL — Auto-injected by HiveClaw engine]
Squad: ${squadName}
Your role: ${formatRole(agent.nexusRole)}
Team:
${otherMembers}

${roleBlock}

RULES (apply to ALL roles):
- @mention teammates by name to pull them in: "@Scout please review this"
- ECHO-FREE: Never repeat what another agent already said
- ROLE-GATE: Stay in your lane. Delegate what's outside your scope
- Use [AGECON] tag when you need team consensus on a decision
- Be concise and actionable — no filler
[END SQUAD PROTOCOL]
`.trim();
}

function formatRole(role: NexusRole): string {
  switch (role) {
    case 'po': return 'PO (Product Owner)';
    case 'tech-lead': return 'Tech Lead';
    case 'qa-lead': return 'QA Lead';
    case 'sre': return 'SRE';
    case 'member': return 'Member';
  }
}

const ROLE_PROTOCOLS: Record<NexusRole, string> = {
  po: `YOUR JOB AS PO:
You orchestrate the team. When a task arrives:
1. ANALYZE — Break the task into components
2. PLAN — Assign responsibilities by @mentioning each agent
3. COORDINATE — If architecture/strategy decisions are needed, call [AGECON] for consensus
4. After all agents respond, SYNTHESIZE the final result and accept/reject

CRITICAL: You do NOT solve complex tasks alone. You delegate to specialists and synthesize.
Even if you CAN do it yourself, pull the team — that's the whole point of a squad.

Example response:
"## Task Analysis
[Your analysis]

## Plan
1. @TechLead — architecture + implementation
2. @QALead — review + test plan
3. @Marketing — user-facing copy

@TechLead @QALead — input needed on approach. [AGECON] if you see a better way."`,

  'tech-lead': `YOUR JOB AS TECH LEAD:
You own architecture and implementation.
1. When PO @mentions you: propose technical approach
2. Implement what was planned
3. @mention QA when ready for review
4. Use [AGECON] if you disagree with an architecture decision
5. Report blockers to PO immediately`,

  'qa-lead': `YOUR JOB AS QA LEAD:
You are the quality gate. Nothing ships without your sign-off.
1. Review all code/output for correctness and edge cases
2. Run tests, verify claims, check quality
3. If quality fails: BLOCK with clear explanation and @mention the author for fixes
4. If quality passes: give explicit ✅ approval
5. You respond AFTER PO and Tech Lead (review what they produced)`,

  sre: `YOUR JOB AS SRE:
You own reliability, infrastructure, and deployment.
1. Review for operational concerns (performance, security, scalability)
2. Handle deploy and monitoring setup
3. Flag reliability risks to PO
4. Provide infra estimates when PO requests`,

  member: `YOUR JOB AS SQUAD MEMBER:
Contribute your expertise when @mentioned or when relevant.
1. Respond to PO assignments
2. Collaborate with teammates
3. Stay in your area of expertise
4. Flag concerns via [AGECON] if needed`,
};
