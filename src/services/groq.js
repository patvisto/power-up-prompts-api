const Groq = require('groq-sdk');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const SYSTEM_PROMPT = `You are a world-class Prompt Engineering Expert. Your sole purpose is to transform a simple user prompt into a highly detailed, structured JSON object that extracts outstanding results from any AI assistant.

Analyze the user's intent deeply and return ONLY raw, valid JSON — no markdown, no code fences, no explanation. Just the JSON object.

The JSON must contain exactly these fields:
- "role": A specific, expert AI persona precisely tailored to the task (e.g. "Senior Python Engineer specialising in Django REST APIs")
- "task": A clear, detailed, unambiguous restatement of what needs to be accomplished
- "context": Relevant background information and framing that helps the AI understand the full situation
- "audience": Who the response is for and their level of expertise with this topic
- "tone": The precise tone and communication style required
- "constraints": An array of at least 4 specific, actionable requirements and boundaries
- "output_format": Exactly how the response should be structured and formatted
- "response_length": Length guidance with a word count estimate (e.g. "Comprehensive — 400-600 words")
- "success_criteria": A concrete description of what an excellent, complete response looks like

Be highly specific and tailored to the actual request. Generic JSON produces generic responses.`;

/**
 * Sends a raw prompt to Groq and returns the enhanced JSON object.
 * Throws if the response is not valid JSON.
 */
async function enhancePrompt(userPrompt) {
  const completion = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPrompt }
    ],
    temperature: 0.4,
    max_tokens: 1024,
    response_format: { type: 'json_object' }
  });

  const raw = completion.choices[0]?.message?.content;
  if (!raw) throw new Error('Empty response from Groq');

  // Parse and attach the original prompt
  const parsed = JSON.parse(raw);
  parsed.original_prompt = userPrompt;
  return parsed;
}

module.exports = { enhancePrompt };
