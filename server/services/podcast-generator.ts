import OpenAI from 'openai';
import Groq from 'groq-sdk';

const PODCAST_PROMPT = `I'll give you text content and I'd like you to write a podcast script IN FRENCH between two hosts.

# FORMAT
Your response must start exactly with:
Please read aloud the following in a podcast interview style:
Speaker 1:

Then alternate between "Speaker 1:" and "Speaker 2:" for the rest.

# INSTRUCTIONS
1. Opening: Begin with interesting remarks on the topic, then introduce it as a "plongée en profondeur".
2. Use two hosts in conversational back-and-forth in French.
3. Keep language informal and accessible. Use "Exactement," "Absolument," "C'est ça" for flow.
4. Use analogies: "C'est comme..."
5. Have one host pose questions, the other explains.
6. Address audience: "Donc pour tous ceux qui nous écoutent..."
7. Conclude with: "Donc alors que nous concluons..." and a thought-provoking takeaway.
8. End with: "Jusqu'à la prochaine fois, restez curieux !"

IMPORTANT: Only output the transcript IN FRENCH.
IMPORTANT: Use \\n between speaker lines.
IMPORTANT: Keep it concise but engaging (~2000-4000 words).

# SOURCE TEXT TO CREATE PODCAST FROM

`;

/**
 * Generate a podcast-style script from text content using LLM.
 */
export async function generatePodcastScript(text: string): Promise<string> {
  const useGroq = !!process.env.GROQ_API_KEY;

  console.log(`[Podcast] Generating script with ${useGroq ? 'Groq' : 'OpenAI'} (${text.length} chars input)`);

  // Truncate input if too long (LLM context limits)
  const maxInputChars = 15000;
  const inputText = text.length > maxInputChars
    ? text.substring(0, maxInputChars) + '\n\n[...]'
    : text;

  const prompt = PODCAST_PROMPT + inputText;

  const script = useGroq
    ? await generateWithGroq(prompt)
    : await generateWithOpenAI(prompt);

  console.log(`[Podcast] Script generated: ${script.length} chars`);

  return script;
}

async function generateWithGroq(prompt: string): Promise<string> {
  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

  const response = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [
      {
        role: 'system',
        content: 'You are a professional podcast script writer. You write engaging, natural-sounding podcast scripts in French.',
      },
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
      {
        role: 'system',
        content: 'You are a professional podcast script writer. You write engaging, natural-sounding podcast scripts in French.',
      },
      { role: 'user', content: prompt },
    ],
    temperature: 0.7,
    max_tokens: 8000,
  });

  return response.choices[0].message.content || '';
}
