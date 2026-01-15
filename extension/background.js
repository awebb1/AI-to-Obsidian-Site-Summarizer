// Handle messages from content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'summarize') {
    handleSummarize(request.pageData, request.settings)
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ error: error.message }));
    return true; // Keep channel open for async response
  }
});

async function handleSummarize(pageData, settings) {
  const { 
    apiKey, apiProvider = 'anthropic', model, obsidianApiKey, folderPath = '',
    summaryMode = 'standard', enableCheatsheet, cheatsheetPath,
    enableStudyQuestions, studyQuestionsPath, customPrompt
  } = settings;
  
  if (!model) {
    throw new Error('No model selected. Please open the extension popup, go to Settings, enter your API key, wait for models to load, and select a model.');
  }
  
  // Build the main summary prompt (use custom prompt if provided)
  const prompt = buildPrompt(pageData, summaryMode, customPrompt);
  
  // Call AI API for main summary
  let result;
  if (apiProvider === 'anthropic') {
    result = await callAnthropic(apiKey, model, prompt);
  } else {
    result = await callOpenAI(apiKey, model, prompt);
  }
  
  const summary = result.text;
  const usage = result.usage;
  
  // Generate filename from title
  const safeTitle = pageData.title
    .replace(/[^a-zA-Z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .substring(0, 60);
  const filename = pageData.pageNum 
    ? `${pageData.pageNum.toString().padStart(2, '0')}-${safeTitle}.md`
    : `${safeTitle}.md`;
  
  // Save main summary to Obsidian
  await saveToObsidian(summary, filename, obsidianApiKey, folderPath);
  
  // Handle study mode extras
  let cheatsheetSaved = false;
  let questionsSaved = false;
  
  if (summaryMode === 'study') {
    // Generate and save cheatsheet if enabled
    if (enableCheatsheet && cheatsheetPath) {
      const cheatsheetPrompt = buildCheatsheetPrompt(pageData);
      let cheatsheetResult;
      if (apiProvider === 'anthropic') {
        cheatsheetResult = await callAnthropic(apiKey, model, cheatsheetPrompt);
      } else {
        cheatsheetResult = await callOpenAI(apiKey, model, cheatsheetPrompt);
      }
      
      const cheatsheetContent = formatCheatsheetEntry(pageData, cheatsheetResult.text);
      await appendToObsidian(cheatsheetContent, cheatsheetPath, obsidianApiKey);
      cheatsheetSaved = true;
    }
    
    // Generate and save study questions if enabled
    if (enableStudyQuestions && studyQuestionsPath) {
      const questionsPrompt = buildStudyQuestionsPrompt(pageData);
      let questionsResult;
      if (apiProvider === 'anthropic') {
        questionsResult = await callAnthropic(apiKey, model, questionsPrompt);
      } else {
        questionsResult = await callOpenAI(apiKey, model, questionsPrompt);
      }
      
      const questionsContent = formatQuestionsEntry(pageData, questionsResult.text);
      await appendToObsidian(questionsContent, studyQuestionsPath, obsidianApiKey);
      questionsSaved = true;
    }
  }
  
  return { 
    success: true, 
    filename,
    cheatsheetSaved,
    cheatsheetPath: cheatsheetSaved ? cheatsheetPath : null,
    questionsSaved,
    questionsPath: questionsSaved ? studyQuestionsPath : null,
    usage: {
      cost: usage.cost,
      tokens: usage.totalTokens,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens
    }
  };
}

// ============ PROMPTS ============

const STANDARD_PROMPT = `You are creating concise study notes from a webpage for Obsidian. Use Obsidian-compatible Markdown formatting.

Requirements:
- Start with a Table of Contents using Obsidian internal links: [[#Section Name]]
- Use ## for main sections, ### for subsections
- Include key concepts, definitions, and important points
- Use bullet points and numbered lists where appropriate
- Use Obsidian callouts for important info: > [!note], > [!tip], > [!warning], > [!important]
- Use tables for comparisons if relevant
- Include code blocks with language tags for any code snippets
- Reference important images using markdown: ![description](url)
- Keep it concise but comprehensive
- Add a "## Key Takeaways" section at the end
- Include source link at the bottom

Table of Contents format example:
## Table of Contents
- [[#Overview]]
- [[#Key Concepts]]
- [[#Key Takeaways]]

Page Title: {title}
Page URL: {url}
Source: {hostname}
{images}

--- PAGE CONTENT ---
{content}
--- END CONTENT ---

Generate the Obsidian Markdown notes now (start with Table of Contents):`;

const STUDY_PROMPT = `You are creating detailed study notes from an educational webpage for Obsidian. Use Obsidian-compatible Markdown formatting optimized for learning and retention.

Requirements:
- Start with a Table of Contents using Obsidian internal links: [[#Section Name]]
- Use ## for main sections, ### for subsections, #### for details
- Include all key concepts, definitions, and terminology
- Use Obsidian callouts for highlighting:
  - > [!note] for general notes
  - > [!tip] for helpful tips
  - > [!warning] for cautions
  - > [!example] for examples
  - > [!important] for critical information
- Highlight important formulas, commands, or syntax in code blocks with language tags
- Use bullet points for lists of items or steps
- Use numbered lists for sequential processes
- Include tables for comparisons or structured data
- Reference images using: ![description](url)
- Add practical examples where relevant
- Include a "## Summary" section with main points
- Add a "## Key Takeaways" section at the end
- Include source link at the bottom

Table of Contents format:
## Table of Contents
- [[#Overview]]
- [[#Key Concepts]]
- [[#Summary]]
- [[#Key Takeaways]]

Page Title: {title}
Page URL: {url}
Source: {hostname}
{images}

--- PAGE CONTENT ---
{content}
--- END CONTENT ---

Generate comprehensive Obsidian study notes now (start with Table of Contents):`;

const CHEATSHEET_PROMPT = `Extract the most important quick-reference information from this page for a cheatsheet. Focus on:

- Key commands, syntax, or code snippets
- Important formulas or calculations
- Critical definitions (brief)
- Step-by-step procedures (condensed)
- Common patterns or templates
- Important flags, parameters, or options
- Quick tips and gotchas

IMPORTANT FORMATTING RULES:
- Use ### for any section headings (NOT ## - that level is reserved for page titles)
- Use #### for sub-sections if needed
- Format as compact, scannable bullet points under headings
- Use code blocks for commands/syntax
- Keep each item brief - this is a quick reference, not full explanations
- Do NOT include any introduction or preamble - start directly with content

Page Title: {title}
{images}

--- PAGE CONTENT ---
{content}
--- END CONTENT ---

Generate cheatsheet entries now (use ### for headings, bullet points for items):`;

const STUDY_QUESTIONS_PROMPT = `Generate 5-8 study questions based on this page content. Create questions that test understanding of key concepts.

IMPORTANT FORMATTING RULES:
- Do NOT use ## headings (reserved for page titles)
- Use Obsidian's callout syntax for each Q&A as shown below
- Do NOT include any introduction - start directly with the first question

Format each Q&A using this exact Obsidian callout syntax:

> [!question] Question text here?
>> [!success]- Click to reveal answer
>> Detailed answer here...

Question types to include:
- Conceptual understanding ("What is X?")
- Process/mechanism ("How does X work?")
- Comparison ("What is the difference between X and Y?")
- Application ("When would you use X?")
- Reasoning ("Why is X important?")

Page Title: {title}

--- PAGE CONTENT ---
{content}
--- END CONTENT ---

Generate the study questions now (start directly with first > [!question], no introduction):`;

function buildPrompt(pageData, mode, customPrompt = null) {
  const imageList = pageData.images.length > 0
    ? `\n\nImages on the page:\n${pageData.images.map(img => `- ${img.alt || 'Image'}: ${img.src}`).join('\n')}`
    : '';
  
  // Use custom prompt if provided, otherwise use mode-based default
  let template;
  if (customPrompt && customPrompt.trim()) {
    template = customPrompt;
  } else {
    template = mode === 'study' ? STUDY_PROMPT : STANDARD_PROMPT;
  }
  
  return template
    .replace(/\{title\}/g, pageData.title)
    .replace(/\{url\}/g, pageData.url)
    .replace(/\{hostname\}/g, pageData.hostname)
    .replace(/\{images\}/g, imageList)
    .replace(/\{content\}/g, pageData.textContent.substring(0, 50000));
}

function buildCheatsheetPrompt(pageData) {
  const imageList = pageData.images.length > 0
    ? `\n\nImages:\n${pageData.images.map(img => `- ${img.alt || 'Image'}: ${img.src}`).join('\n')}`
    : '';
  
  return CHEATSHEET_PROMPT
    .replace(/\{title\}/g, pageData.title)
    .replace(/\{images\}/g, imageList)
    .replace(/\{content\}/g, pageData.textContent.substring(0, 40000));
}

function buildStudyQuestionsPrompt(pageData) {
  return STUDY_QUESTIONS_PROMPT
    .replace(/\{title\}/g, pageData.title)
    .replace(/\{content\}/g, pageData.textContent.substring(0, 40000));
}

// Format cheatsheet entry with page header
function formatCheatsheetEntry(pageData, content) {
  const date = new Date().toISOString().split('T')[0];
  const header = pageData.pageNum 
    ? `## 📄 ${pageData.pageNum}. ${pageData.title}`
    : `## 📄 ${pageData.title}`;
  
  return `

---

${header}
> Source: [${pageData.title}](${pageData.url}) | Added: ${date}

${content}
`;
}

// Format study questions entry with page header
function formatQuestionsEntry(pageData, content) {
  const date = new Date().toISOString().split('T')[0];
  const header = pageData.pageNum 
    ? `## 📄 ${pageData.pageNum}. ${pageData.title}`
    : `## 📄 ${pageData.title}`;
  
  return `

---

${header}
> Source: [${pageData.title}](${pageData.url}) | Added: ${date}

${content}
`;
}

// ============ USAGE TRACKING ============

// Estimate cost based on model (per 1M tokens pricing, converted to per-token)
function estimateCost(provider, model, inputTokens, outputTokens) {
  const modelLower = model.toLowerCase();
  
  // Pricing per 1M tokens (input, output) - estimates based on current rates
  let inputRate = 0;
  let outputRate = 0;
  
  if (provider === 'anthropic') {
    if (modelLower.includes('opus')) {
      inputRate = 15.00; outputRate = 75.00;
    } else if (modelLower.includes('sonnet')) {
      inputRate = 3.00; outputRate = 15.00;
    } else if (modelLower.includes('haiku')) {
      inputRate = 0.25; outputRate = 1.25;
    } else {
      // Default to Sonnet pricing
      inputRate = 3.00; outputRate = 15.00;
    }
  } else if (provider === 'openai') {
    if (modelLower.includes('gpt-4o-mini')) {
      inputRate = 0.15; outputRate = 0.60;
    } else if (modelLower.includes('gpt-4o')) {
      inputRate = 2.50; outputRate = 10.00;
    } else if (modelLower.includes('gpt-4-turbo') || modelLower.includes('gpt-4-1')) {
      inputRate = 10.00; outputRate = 30.00;
    } else if (modelLower.includes('gpt-4')) {
      inputRate = 30.00; outputRate = 60.00;
    } else if (modelLower.includes('gpt-3.5')) {
      inputRate = 0.50; outputRate = 1.50;
    } else if (modelLower.includes('o1-mini')) {
      inputRate = 3.00; outputRate = 12.00;
    } else if (modelLower.includes('o1')) {
      inputRate = 15.00; outputRate = 60.00;
    } else {
      // Default to GPT-4o pricing
      inputRate = 2.50; outputRate = 10.00;
    }
  }
  
  // Convert from per-1M to actual cost
  const inputCost = (inputTokens / 1000000) * inputRate;
  const outputCost = (outputTokens / 1000000) * outputRate;
  
  return inputCost + outputCost;
}

async function trackUsage(provider, model, inputTokens, outputTokens) {
  const totalTokens = inputTokens + outputTokens;
  const cost = estimateCost(provider, model, inputTokens, outputTokens);
  
  const usageData = {
    provider,
    model,
    inputTokens,
    outputTokens,
    totalTokens,
    cost,
    timestamp: Date.now()
  };
  
  const totals = await chrome.storage.local.get(['totalTokens', 'totalCost']);
  await chrome.storage.local.set({ 
    lastUsage: usageData,
    totalTokens: (totals.totalTokens || 0) + totalTokens,
    totalCost: (totals.totalCost || 0) + cost
  });
  
  return usageData;
}

// ============ AI API CALLS ============

async function callAnthropic(apiKey, model, prompt) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }]
    })
  });
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || 'Anthropic API error');
  }
  
  const data = await response.json();
  const usage = await trackUsage('anthropic', model, data.usage.input_tokens || 0, data.usage.output_tokens || 0);
  
  return { text: data.content[0].text, usage };
}

async function callOpenAI(apiKey, model, prompt) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 4096
    })
  });
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || 'OpenAI API error');
  }
  
  const data = await response.json();
  const usage = await trackUsage('openai', model, data.usage.prompt_tokens || 0, data.usage.completion_tokens || 0);
  
  return { text: data.choices[0].message.content, usage };
}

// ============ OBSIDIAN API ============

const OBSIDIAN_URLS = [
  'https://127.0.0.1:27124',
  'http://127.0.0.1:27123'
];

async function saveToObsidian(content, filename, obsidianApiKey, folderPath) {
  const filePath = folderPath && folderPath.trim() 
    ? `${folderPath.trim()}/${filename}` 
    : filename;
  
  let lastError;
  
  for (const baseUrl of OBSIDIAN_URLS) {
    try {
      const response = await fetch(`${baseUrl}/vault/${encodeURIComponent(filePath)}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${obsidianApiKey}`,
          'Content-Type': 'text/markdown'
        },
        body: content
      });
      
      if (response.ok) {
        return { success: true, path: filePath };
      }
      
      lastError = await response.text();
    } catch (e) {
      lastError = e.message;
      continue;
    }
  }
  
  throw new Error(lastError || 'Failed to save to Obsidian. Is the Local REST API plugin enabled?');
}

async function readFromObsidian(filePath, obsidianApiKey) {
  for (const baseUrl of OBSIDIAN_URLS) {
    try {
      const response = await fetch(`${baseUrl}/vault/${encodeURIComponent(filePath)}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${obsidianApiKey}`,
          'Accept': 'text/markdown'
        }
      });
      
      if (response.ok) {
        return await response.text();
      }
      
      // File doesn't exist yet - that's okay
      if (response.status === 404) {
        return null;
      }
    } catch (e) {
      continue;
    }
  }
  
  return null;
}

async function appendToObsidian(content, filePath, obsidianApiKey) {
  // First, try to read existing content
  const existingContent = await readFromObsidian(filePath, obsidianApiKey);
  
  let newContent;
  if (existingContent) {
    // Append to existing file
    newContent = existingContent + content;
  } else {
    // Create new file with header
    const fileName = filePath.split('/').pop().replace('.md', '');
    const header = `# ${fileName}\n\n> This file is automatically updated by Page Summarizer.\n`;
    newContent = header + content;
  }
  
  let lastError;
  
  for (const baseUrl of OBSIDIAN_URLS) {
    try {
      const response = await fetch(`${baseUrl}/vault/${encodeURIComponent(filePath)}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${obsidianApiKey}`,
          'Content-Type': 'text/markdown'
        },
        body: newContent
      });
      
      if (response.ok) {
        return { success: true, path: filePath };
      }
      
      lastError = await response.text();
    } catch (e) {
      lastError = e.message;
      continue;
    }
  }
  
  throw new Error(lastError || 'Failed to append to Obsidian file.');
}
