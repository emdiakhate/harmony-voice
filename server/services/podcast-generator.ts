import OpenAI from 'openai';
import Groq from 'groq-sdk';

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
 * Determine which LLM provider to use.
 * Priority: Groq > OpenRouter > OpenAI
 */
function getProvider(): 'groq' | 'openrouter' | 'openai' {
  if (process.env.GROQ_API_KEY) return 'groq';
  if (process.env.OPENROUTER_API_KEY) return 'openrouter';
  return 'openai';
}

/**
 * Generate a podcast-style script from text content using LLM.
 */
export async function generatePodcastScript(
  text: string,
  options?: { tone?: PodcastTone; speakerCount?: PodcastSpeakerCount },
): Promise<string> {
  const provider = getProvider();
  const tone = options?.tone || 'casual';
  const speakerCount = options?.speakerCount || 2;

  console.log(`[Podcast] Generating script with ${provider} (${text.length} chars input, tone=${tone}, speakers=${speakerCount})`);

  // Truncate input if too long (LLM context limits)
  const maxInputChars = 15000;
  const inputText = text.length > maxInputChars
    ? text.substring(0, maxInputChars) + '\n\n[...]'
    : text;

  const prompt = buildPodcastPrompt(speakerCount, tone) + inputText;

  let script: string;

  if (provider === 'groq') {
    script = await generateWithGroq(prompt);
  } else if (provider === 'openrouter') {
    script = await generateWithOpenRouter(prompt);
  } else {
    script = await generateWithOpenAI(prompt);
  }

  console.log(`[Podcast] Script generated: ${script.length} chars`);

  return script;
}

async function generateWithGroq(prompt: string): Promise<string> {
  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

  const response = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [
      { role: 'system', content: SYSTEM_MSG },
      { role: 'user', content: prompt },
    ],
    temperature: 0.7,
    max_tokens: 8000,
  });

  return response.choices[0].message.content || '';
}

async function generateWithOpenRouter(prompt: string): Promise<string> {
  const openrouter = new OpenAI({
    apiKey: process.env.OPENROUTER_API_KEY,
    baseURL: 'https://openrouter.ai/api/v1',
  });

  const response = await openrouter.chat.completions.create({
    model: 'meta-llama/llama-3.3-70b-instruct',
    messages: [
      { role: 'system', content: SYSTEM_MSG },
      { role: 'user', content: prompt },
    ],
    temperature: 0.7,
    max_tokens: 8000,
  });

  return response.choices[0].message.content || '';
}

async function generateWithOpenAI(prompt: string): Promise<string> {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: SYSTEM_MSG },
      { role: 'user', content: prompt },
    ],
    temperature: 0.7,
    max_tokens: 8000,
  });

  return response.choices[0].message.content || '';
}
