import { chatComplete, resolveLlmConfig, type LlmConfigInput } from './llm/router.js';

export type PodcastTone = 'formal' | 'casual' | 'humorous';
export type PodcastSpeakerCount = 2 | 3 | 4;

const TONE_INSTRUCTIONS: Record<PodcastTone, string> = {
  formal: `Ton formel et professionnel. Utilisez un vocabulaire soutenu, des formulations élaborées, et maintenez un registre académique. Évitez les expressions familières.`,
  casual: `Ton décontracté et naturel. Utilisez un langage courant, des expressions familières comme "Exactement," "Absolument," "C'est ça", "Tu vois ce que je veux dire". Soyez spontané et conversationnel.`,
  humorous: `Ton humoristique et divertissant. Ajoutez des blagues, des jeux de mots, des anecdotes drôles, des comparaisons amusantes. Faites rire l'audience tout en restant informatif. Utilisez l'ironie et l'autodérision.`,
};

function buildPodcastPrompt(speakerCount: PodcastSpeakerCount, tone: PodcastTone): string {
  const speakerLabels = Array.from({ length: speakerCount }, (_, i) => `Speaker ${i + 1}`);
  const speakerFormat = speakerLabels.map(s => `"${s}:"`).join(', ');

  const speakerRoles: Record<number, string> = {
    2: `Speaker 1 est l'hôte principal qui pose des questions. Speaker 2 est l'expert qui explique.`,
    3: `Speaker 1 est l'hôte principal qui guide la conversation. Speaker 2 est l'expert qui explique en détail. Speaker 3 est le curieux qui pose des questions naïves et apporte un angle différent.`,
    4: `Speaker 1 est l'hôte principal qui guide la conversation. Speaker 2 est l'expert qui explique en détail. Speaker 3 apporte des contre-arguments et des perspectives alternatives. Speaker 4 est le curieux qui pose des questions et fait des analogies pour le public.`,
  };

  return `I'll give you text content and I'd like you to write a podcast script IN FRENCH with ${speakerCount} speakers.

# FORMAT
Your response must start exactly with:
Please read aloud the following in a podcast interview style:
Speaker 1:

Then alternate between ${speakerFormat} for the rest.

# TONE
${TONE_INSTRUCTIONS[tone]}

# INSTRUCTIONS
1. Opening: Begin with interesting remarks on the topic, then introduce it as a "plongée en profondeur".
2. Use ${speakerCount} speakers in conversational back-and-forth in French.
3. ${speakerRoles[speakerCount]}
4. Use analogies: "C'est comme..."
5. Address audience: "Donc pour tous ceux qui nous écoutent..."
6. Conclude with: "Donc alors que nous concluons..." and a thought-provoking takeaway.
7. End with: "Jusqu'à la prochaine fois, restez curieux !"

IMPORTANT: Only output the transcript IN FRENCH.
IMPORTANT: Use \\n between speaker lines.
IMPORTANT: Keep it concise but engaging (~2000-4000 words).
IMPORTANT: Use ONLY these speaker labels: ${speakerFormat}.

# SOURCE TEXT TO CREATE PODCAST FROM

`;
}

const SYSTEM_MSG = 'You are a professional podcast script writer. You write engaging, natural-sounding podcast scripts in French.';

/**
 * Generate a podcast-style script from text content using the LLM router
 * (clés utilisateur > repli .env > tiers gratuits, avec failover automatique).
 */
export async function generatePodcastScript(
  text: string,
  options?: { tone?: PodcastTone; speakerCount?: PodcastSpeakerCount; llmConfig?: LlmConfigInput | null },
): Promise<string> {
  const tone = options?.tone || 'casual';
  const speakerCount = options?.speakerCount || 2;

  console.log(`[Podcast] Generating script (${text.length} chars input, tone=${tone}, speakers=${speakerCount})`);

  // Truncate input if too long (LLM context limits)
  const maxInputChars = 15000;
  const inputText = text.length > maxInputChars
    ? text.substring(0, maxInputChars) + '\n\n[...]'
    : text;

  const prompt = buildPodcastPrompt(speakerCount, tone) + inputText;

  const script = await chatComplete({
    label: 'Podcast',
    attempts: resolveLlmConfig(options?.llmConfig),
    temperature: 0.7,
    maxTokens: 8000,
    messages: [
      { role: 'system', content: SYSTEM_MSG },
      { role: 'user', content: prompt },
    ],
  });

  console.log(`[Podcast] Script generated: ${script.length} chars`);

  return script;
}
