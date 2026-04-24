const OpenAI = require('openai');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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
 * Sends a raw prompt to OpenAI and returns the enhanced JSON object.
 * Retries once on transient errors. Throws if ultimately unsuccessful.
 */
async function enhancePrompt(userPrompt) {
  const call = () => openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user',   content: userPrompt }
    ],
    temperature: 0.4,
    max_tokens: 1024,
    response_format: { type: 'json_object' }
  });

  let completion;
  try {
    completion = await call();
  } catch (err) {
    // Retry once after 2 seconds for transient failures
    console.warn('OpenAI first attempt failed, retrying:', err?.message);
    await new Promise(r => setTimeout(r, 2000));
    completion = await call();
  }

  const raw = completion.choices[0]?.message?.content;
  if (!raw) throw new Error('Empty response from OpenAI');

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('OpenAI returned invalid JSON');
  }

  parsed.original_prompt = userPrompt;
  return parsed;
}

module.exports = { enhancePrompt };
