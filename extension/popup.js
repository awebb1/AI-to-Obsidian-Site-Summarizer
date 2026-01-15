// Tab switching
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(`${tab.dataset.tab}-tab`).classList.add('active');
    
    // Refresh stats when opening settings tab
    if (tab.dataset.tab === 'settings') {
      loadUsageStats();
    }
  });
});

// Get current tab's hostname
async function getCurrentSite() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab && tab.url) {
    try {
      const url = new URL(tab.url);
      return url.hostname;
    } catch (e) {
      return null;
    }
  }
  return null;
}

// Load and display whitelisted sites
async function loadSites() {
  const settings = await chrome.storage.sync.get(['whitelistedSites', 'enableOnAllSites']);
  const sites = settings.whitelistedSites || [];
  const enableAll = settings.enableOnAllSites || false;
  
  document.getElementById('enableOnAllSites').checked = enableAll;
  
  const siteList = document.getElementById('siteList');
  
  if (sites.length === 0) {
    siteList.innerHTML = '<div class="site-item" style="color: #71717a;">No sites added yet</div>';
    return;
  }
  
  siteList.innerHTML = sites.map(site => `
    <div class="site-item">
      <span>${site}</span>
      <button data-site="${site}">Remove</button>
    </div>
  `).join('');
  
  // Add remove handlers
  siteList.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', async () => {
      const siteToRemove = btn.dataset.site;
      const settings = await chrome.storage.sync.get(['whitelistedSites']);
      const sites = settings.whitelistedSites || [];
      const newSites = sites.filter(s => s !== siteToRemove);
      await chrome.storage.sync.set({ whitelistedSites: newSites });
      
      // Remove button from current page if it was the removed site
      const currentSite = await getCurrentSite();
      if (currentSite === siteToRemove || (siteToRemove.startsWith('*.') && currentSite.endsWith(siteToRemove.slice(2)))) {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab && tab.id) {
          chrome.tabs.sendMessage(tab.id, { action: 'removeButton' }).catch(() => {});
        }
      }
      
      loadSites();
    });
  });
}

// Add site to whitelist
async function addSite(site) {
  if (!site) return;
  
  const settings = await chrome.storage.sync.get(['whitelistedSites']);
  const sites = settings.whitelistedSites || [];
  
  if (!sites.includes(site)) {
    sites.push(site);
    await chrome.storage.sync.set({ whitelistedSites: sites });
  }
  
  loadSites();
  
  // Inject button on current page if it's the added site
  const currentSite = await getCurrentSite();
  if (currentSite === site || (site.startsWith('*.') && currentSite.endsWith(site.slice(2)))) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.id) {
      chrome.tabs.sendMessage(tab.id, { action: 'injectButton' }).catch(() => {});
    }
  }
}

// Display current site
async function displayCurrentSite() {
  const site = await getCurrentSite();
  document.getElementById('currentSite').textContent = site || '(not a webpage)';
}

// Add current site button
document.getElementById('addCurrentSite').addEventListener('click', async () => {
  const site = await getCurrentSite();
  if (site) {
    await addSite(site);
  }
});

// Add site manually
document.getElementById('addSiteBtn').addEventListener('click', () => {
  const input = document.getElementById('newSite');
  const site = input.value.trim();
  if (site) {
    addSite(site);
    input.value = '';
  }
});

// Enable on all sites toggle
document.getElementById('enableOnAllSites').addEventListener('change', async (e) => {
  await chrome.storage.sync.set({ enableOnAllSites: e.target.checked });
  
  // Inject or remove button from current page
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab && tab.id) {
    chrome.tabs.sendMessage(tab.id, { 
      action: e.target.checked ? 'injectButton' : 'removeButton' 
    }).catch(() => {});
  }
});

// ============ SETTINGS TAB ============

// No hardcoded models - all models are fetched from APIs

async function populateModels(provider, apiKey = null) {
  const select = document.getElementById('model');
  const help = document.getElementById('modelHelp');
  
  // Show loading state
  select.innerHTML = '<option value="">Loading models...</option>';
  help.textContent = 'Fetching models from API...';
  
  if (!apiKey) {
    select.innerHTML = '<option value="">Enter API key first</option>';
    help.textContent = 'Enter your API key and click ↻ to fetch models';
    return;
  }
  
  try {
    let models;
    if (provider === 'anthropic') {
      models = await fetchAnthropicModels(apiKey);
      if (models && models.length > 0) {
        select.innerHTML = models.map(m => 
          `<option value="${m.id}">${m.name || m.id}</option>`
        ).join('');
        help.textContent = `✓ Fetched ${models.length} models from Anthropic API`;
        restoreModelSelection();
        return;
      }
    } else {
      models = await fetchOpenAIModels(apiKey);
      if (models && models.length > 0) {
        select.innerHTML = models.map(m => 
          `<option value="${m.id}">${m.id}</option>`
        ).join('');
        help.textContent = `✓ Fetched ${models.length} models from OpenAI API`;
        restoreModelSelection();
        return;
      }
    }
    
    // No models returned
    select.innerHTML = '<option value="">No models found</option>';
    help.textContent = 'No models returned from API';
  } catch (e) {
    console.log('Failed to fetch models:', e);
    select.innerHTML = '<option value="">Failed to fetch</option>';
    help.textContent = `Error: ${e.message}. Check your API key.`;
  }
}

async function restoreModelSelection() {
  const settings = await chrome.storage.sync.get(['model']);
  const select = document.getElementById('model');
  
  if (settings.model) {
    const option = Array.from(select.options).find(o => o.value === settings.model);
    if (option) {
      select.value = settings.model;
      return;
    }
  }
  
  // If no saved model or saved model not found, select first option and save it
  if (select.options.length > 0 && select.options[0].value) {
    select.selectedIndex = 0;
    const firstModel = select.options[0].value;
    // Auto-save the first model if none was saved
    if (!settings.model) {
      await chrome.storage.sync.set({ model: firstModel });
    }
  }
}

async function fetchAnthropicModels(apiKey) {
  const response = await fetch('https://api.anthropic.com/v1/models', {
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    signal: AbortSignal.timeout(5000)
  });
  
  if (!response.ok) throw new Error('Failed to fetch models');
  
  const data = await response.json();
  // Sort by version number (newer first)
  return (data.data || []).sort((a, b) => {
    const getVersion = id => {
      const match = id.match(/claude-(\d+)-(\d+)/);
      if (match) return parseFloat(`${match[1]}.${match[2]}`);
      const match2 = id.match(/claude-(\d+)/);
      return match2 ? parseFloat(match2[1]) : 0;
    };
    return getVersion(b.id) - getVersion(a.id);
  });
}

async function fetchOpenAIModels(apiKey) {
  const response = await fetch('https://api.openai.com/v1/models', {
    headers: { 'Authorization': `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(10000)
  });
  
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error?.message || 'Failed to fetch models');
  }
  
  const data = await response.json();
  // Filter to chat-capable models (gpt-4, gpt-3.5, o1, etc.)
  return data.data
    .filter(m => {
      const id = m.id.toLowerCase();
      // Include GPT models, o1 models, and other chat models
      return (id.includes('gpt-4') || id.includes('gpt-3.5') || id.startsWith('o1') || id.includes('chatgpt')) 
        && !id.includes('instruct') && !id.includes('vision') && !id.includes('audio');
    })
    .sort((a, b) => {
      // Sort: o1 first, then gpt-4, then gpt-3.5
      const aScore = a.id.startsWith('o1') ? 3 : a.id.includes('gpt-4') ? 2 : 1;
      const bScore = b.id.startsWith('o1') ? 3 : b.id.includes('gpt-4') ? 2 : 1;
      return bScore - aScore || a.id.localeCompare(b.id);
    });
}

async function loadSettings() {
  const settings = await chrome.storage.sync.get([
    'apiKey',
    'apiProvider',
    'obsidianApiKey',
    'model',
    'themeColor'
  ]);
  
  if (settings.apiKey) {
    document.getElementById('apiKey').value = settings.apiKey;
    const provider = detectProvider(settings.apiKey);
    updateProviderDisplay(provider);
    
    // Populate models if provider detected
    if (provider) {
      await populateModels(provider, settings.apiKey);
    }
  } else {
    const select = document.getElementById('model');
    select.innerHTML = '<option value="">Enter API key first</option>';
    document.getElementById('modelHelp').textContent = 'Enter your API key to auto-detect provider and fetch models';
    updateProviderDisplay(null);
  }
  
  if (settings.obsidianApiKey) document.getElementById('obsidianApiKey').value = settings.obsidianApiKey;
  
  // Load theme color
  const themeColor = settings.themeColor || '#8b5cf6';
  document.getElementById('themeColor').value = themeColor;
  document.getElementById('themeColorHex').textContent = themeColor;
  applyThemeToPopup(themeColor);
  
  // Load usage stats
  loadUsageStats();
  
  // Auto-save model when changed
  document.getElementById('model').addEventListener('change', async (e) => {
    if (e.target.value) {
      await chrome.storage.sync.set({ model: e.target.value });
    }
  });
}

// Detect provider from API key format
function detectProvider(apiKey) {
  if (!apiKey || apiKey.length < 10) return null;
  if (apiKey.startsWith('sk-ant-')) return 'anthropic';
  if (apiKey.startsWith('sk-')) return 'openai';
  return null;
}

// Update provider display
function updateProviderDisplay(provider) {
  const display = document.getElementById('detectedProvider');
  if (provider === 'anthropic') {
    display.textContent = '🟢 Anthropic (Claude)';
    display.style.color = '#10b981';
  } else if (provider === 'openai') {
    display.textContent = '🟢 OpenAI (GPT)';
    display.style.color = '#10b981';
  } else {
    display.textContent = '⚪ Enter API key to detect provider';
    display.style.color = '#71717a';
  }
}

// Auto-fetch models when API key is entered (with debounce)
let apiKeyTimeout;
document.getElementById('apiKey').addEventListener('input', (e) => {
  clearTimeout(apiKeyTimeout);
  const apiKey = e.target.value.trim();
  const provider = detectProvider(apiKey);
  
  updateProviderDisplay(provider);
  
  if (apiKey.length > 20 && provider) {
    apiKeyTimeout = setTimeout(async () => {
      await populateModels(provider, apiKey);
      // Save detected provider
      await chrome.storage.sync.set({ apiProvider: provider });
    }, 1000);
  } else if (!provider && apiKey.length > 5) {
    document.getElementById('model').innerHTML = '<option value="">Unknown API key format</option>';
    document.getElementById('modelHelp').textContent = 'API key should start with sk-ant- (Anthropic) or sk- (OpenAI)';
  }
});

// Refresh models button
document.getElementById('refreshModels').addEventListener('click', async () => {
  const apiKey = document.getElementById('apiKey').value.trim();
  const provider = detectProvider(apiKey);
  const btn = document.getElementById('refreshModels');
  const help = document.getElementById('modelHelp');
  
  btn.textContent = '...';
  btn.disabled = true;
  
  if (!apiKey) {
    help.textContent = 'Please enter your API key first';
    btn.textContent = '↻';
    btn.disabled = false;
    return;
  }
  
  if (!provider) {
    help.textContent = 'Unknown API key format';
    btn.textContent = '↻';
    btn.disabled = false;
    return;
  }
  
  try {
    help.textContent = 'Fetching models from API...';
    await populateModels(provider, apiKey);
  } catch (e) {
    help.textContent = 'Failed to fetch. Check API key.';
    await populateModels(provider);
  }
  
  btn.textContent = '↻';
  btn.disabled = false;
});

async function loadUsageStats() {
  const [lastUsage, totals] = await Promise.all([
    chrome.storage.local.get(['lastUsage']),
    chrome.storage.local.get(['totalCost', 'totalTokens'])
  ]);
  
  // Display last usage
  if (lastUsage.lastUsage) {
    const usage = lastUsage.lastUsage;
    const tokens = usage.totalTokens.toLocaleString();
    const date = new Date(usage.timestamp).toLocaleString();
    // Show full model name, just remove date suffix if present (e.g., -20250514)
    const modelName = usage.model ? usage.model.replace(/-\d{8}$/, '') : 'Unknown';
    
    // Always show cost (0 if not available)
    const cost = usage.cost || 0;
    const costDisplay = `<strong style="color: #10b981;">~$${cost.toFixed(4)}</strong>`;
    
    document.getElementById('lastUsage').innerHTML = `
      ${costDisplay} • ${tokens} tokens<br>
      <span class="theme-text" style="font-size: 11px;">${modelName}</span><br>
      <span style="font-size: 11px; color: #71717a;">${date}</span>
    `;
  } else {
    document.getElementById('lastUsage').textContent = 'No summaries yet';
  }
  
  // Display totals
  const totalCost = totals.totalCost || 0;
  const totalTokens = totals.totalTokens || 0;
  
  const costDisplay = `<strong style="color: #10b981;">~$${totalCost.toFixed(4)}</strong>`;
  document.getElementById('totalUsage').innerHTML = `
    ${costDisplay} • ${totalTokens.toLocaleString()} tokens
  `;
}

document.getElementById('resetStatsBtn').addEventListener('click', async () => {
  if (confirm('Reset all usage statistics?')) {
    await chrome.storage.local.remove(['lastUsage', 'totalCost', 'totalTokens']);
    loadUsageStats();
  }
});

document.getElementById('saveSettingsBtn').addEventListener('click', async () => {
  const apiKey = document.getElementById('apiKey').value.trim();
  const provider = detectProvider(apiKey);
  
  const settings = {
    apiKey: apiKey,
    apiProvider: provider || 'anthropic',
    obsidianApiKey: document.getElementById('obsidianApiKey').value.trim(),
    model: document.getElementById('model').value,
    themeColor: document.getElementById('themeColor').value
  };
  
  if (!settings.apiKey) {
    showStatus('settingsStatus', 'Please enter your AI API key', 'error');
    return;
  }
  
  if (!provider) {
    showStatus('settingsStatus', 'Unknown API key format. Use Anthropic (sk-ant-) or OpenAI (sk-)', 'error');
    return;
  }
  
  if (!settings.obsidianApiKey) {
    showStatus('settingsStatus', 'Please enter your Obsidian API key', 'error');
    return;
  }
  
  if (!settings.model) {
    showStatus('settingsStatus', 'Please select a model', 'error');
    return;
  }
  
  await chrome.storage.sync.set(settings);
  applyThemeToPopup(settings.themeColor);
  notifyThemeChange(settings.themeColor);
  showStatus('settingsStatus', 'Settings saved!', 'success');
  checkObsidianConnection();
});

// Live preview theme color on change
document.getElementById('themeColor').addEventListener('input', (e) => {
  const color = e.target.value;
  applyThemeToPopup(color);
  document.getElementById('themeColorHex').textContent = color;
});

// Reset button position
document.getElementById('resetPositionBtn').addEventListener('click', async () => {
  await chrome.storage.sync.remove(['buttonPosition']);
  showStatus('settingsStatus', 'Button position reset! Reload the page to see changes.', 'success');
});

// Reset log panel position
document.getElementById('resetLogPositionBtn').addEventListener('click', async () => {
  await chrome.storage.sync.remove(['logPanelPosition']);
  showStatus('settingsStatus', 'Log panel position reset! Reload the page to see changes.', 'success');
});

// Apply theme color to popup UI
function applyThemeToPopup(color) {
  if (!color) return;
  const lighterColor = lightenColor(color, 20);
  
  // Set CSS variable for elements using var(--theme-color)
  document.documentElement.style.setProperty('--theme-color', lighterColor);
  
  // Update header gradient
  const header = document.querySelector('.header');
  if (header) {
    header.style.background = `linear-gradient(135deg, ${color} 0%, ${lighterColor} 100%)`;
  }
  
  // Update active tab, primary buttons, input focus states, and theme text
  const style = document.getElementById('theme-style') || document.createElement('style');
  style.id = 'theme-style';
  style.textContent = `
    .tab.active { background: ${color} !important; color: white !important; border-color: ${color} !important; }
    button:not(.secondary):not(.danger):not(.tab) { background: linear-gradient(135deg, ${color} 0%, ${lighterColor} 100%) !important; }
    input:focus, select:focus, textarea:focus { border-color: ${color} !important; outline: none !important; }
    .theme-text { color: ${lighterColor} !important; }
  `;
  if (!style.parentNode) document.head.appendChild(style);
}

function lightenColor(hex, percent) {
  const num = parseInt(hex.replace('#', ''), 16);
  const amt = Math.round(2.55 * percent);
  const R = Math.min(255, (num >> 16) + amt);
  const G = Math.min(255, ((num >> 8) & 0x00FF) + amt);
  const B = Math.min(255, (num & 0x0000FF) + amt);
  return `#${(1 << 24 | R << 16 | G << 8 | B).toString(16).slice(1)}`;
}

// Notify content script of theme change
async function notifyThemeChange(color) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab && tab.id) {
    chrome.tabs.sendMessage(tab.id, { action: 'updateTheme', color }).catch(() => {});
  }
}

function showStatus(elementId, message, type) {
  const status = document.getElementById(elementId);
  status.textContent = message;
  status.className = `status ${type}`;
  status.style.display = 'block';
  
  setTimeout(() => {
    status.style.display = 'none';
  }, 3000);
}

async function checkObsidianConnection() {
  const connectionStatus = document.getElementById('connectionStatus');
  
  const urls = [
    'https://127.0.0.1:27124/',
    'http://127.0.0.1:27123/'
  ];
  
  for (const url of urls) {
    try {
      const response = await fetch(url, {
        method: 'GET',
        signal: AbortSignal.timeout(2000)
      });
      
      if (response.ok || response.status === 401) {
        connectionStatus.className = 'connection-status connected';
        connectionStatus.textContent = '✓ Obsidian Local REST API connected';
        return;
      }
    } catch (e) {
      continue;
    }
  }
  
  connectionStatus.className = 'connection-status disconnected';
  connectionStatus.textContent = '✗ Obsidian not running or plugin not enabled';
}

// ============ FOLDERS TAB ============

async function fetchFolders() {
  const settings = await chrome.storage.sync.get(['obsidianApiKey']);
  if (!settings.obsidianApiKey) {
    return [];
  }
  
  const baseUrls = [
    'https://127.0.0.1:27124',
    'http://127.0.0.1:27123'
  ];
  
  let workingBaseUrl = null;
  
  for (const baseUrl of baseUrls) {
    try {
      const response = await fetch(`${baseUrl}/vault/`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${settings.obsidianApiKey}`,
          'Accept': 'application/json'
        },
        signal: AbortSignal.timeout(3000)
      });
      
      if (response.ok) {
        workingBaseUrl = baseUrl;
        break;
      }
    } catch (e) {
      continue;
    }
  }
  
  if (!workingBaseUrl) {
    return [];
  }
  
  const allFolders = [];
  
  async function fetchFoldersAt(path) {
    try {
      const url = path 
        ? `${workingBaseUrl}/vault/${encodeURIComponent(path)}/`
        : `${workingBaseUrl}/vault/`;
        
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${settings.obsidianApiKey}`,
          'Accept': 'application/json'
        },
        signal: AbortSignal.timeout(5000)
      });
      
      if (response.ok) {
        const data = await response.json();
        const folders = data.files.filter(f => f.endsWith('/'));
        
        for (const folder of folders) {
          const folderName = folder.slice(0, -1);
          const fullPath = path ? `${path}/${folderName}` : folderName;
          allFolders.push(fullPath);
          
          if (fullPath.split('/').length < 4) {
            await fetchFoldersAt(fullPath);
          }
        }
      }
    } catch (e) {
      console.log('Error fetching folders at', path, e);
    }
  }
  
  await fetchFoldersAt('');
  return allFolders.sort();
}

async function populateFolderDropdown() {
  const select = document.getElementById('existingFolder');
  select.innerHTML = '<option value="">Loading folders...</option>';
  
  const folders = await fetchFolders();
  
  select.innerHTML = '<option value="">📁 Vault Root</option>';
  
  folders.forEach(folder => {
    const option = document.createElement('option');
    option.value = folder;
    option.textContent = `📂 ${folder}`;
    select.appendChild(option);
  });
  
  // Select current folder
  const settings = await chrome.storage.sync.get(['folderPath']);
  if (settings.folderPath) {
    document.getElementById('folderPath').value = settings.folderPath;
    const existingOption = Array.from(select.options).find(o => o.value === settings.folderPath);
    if (existingOption) {
      select.value = settings.folderPath;
    }
  }
}

document.getElementById('existingFolder').addEventListener('change', (e) => {
  document.getElementById('folderPath').value = e.target.value;
});

document.getElementById('refreshFolders').addEventListener('click', async () => {
  const btn = document.getElementById('refreshFolders');
  btn.textContent = '...';
  btn.disabled = true;
  await populateFolderDropdown();
  btn.textContent = '↻';
  btn.disabled = false;
});

document.getElementById('saveFolderBtn').addEventListener('click', async () => {
  const dropdownValue = document.getElementById('existingFolder').value;
  const textValue = document.getElementById('folderPath').value.trim();
  const folderPath = textValue || dropdownValue;
  
  await chrome.storage.sync.set({ folderPath });
  showStatus('folderStatus', `Folder set: ${folderPath || 'Vault Root'}`, 'success');
});

// ============ PROMPT TAB ============

const DEFAULT_PROMPT = `You are creating concise study notes from a webpage for Obsidian. Use Obsidian-compatible Markdown formatting.

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

async function loadPrompt() {
  const settings = await chrome.storage.sync.get(['customPrompt']);
  let prompt = settings.customPrompt || DEFAULT_PROMPT;
  
  // Migrate old JavaScript-style variables to user-friendly format
  if (prompt.includes('${pageData.') || prompt.includes('${imageList}')) {
    prompt = prompt
      .replace(/\$\{pageData\.title\}/g, '{title}')
      .replace(/\$\{pageData\.url\}/g, '{url}')
      .replace(/\$\{pageData\.textContent\}/g, '{content}')
      .replace(/\$\{imageList\}/g, '{images}')
      .replace(/\$\{hostname\}/g, '{hostname}');
    
    // Save the migrated prompt
    await chrome.storage.sync.set({ customPrompt: prompt });
  }
  
  document.getElementById('customPrompt').value = prompt;
}

document.getElementById('savePromptBtn').addEventListener('click', async () => {
  const prompt = document.getElementById('customPrompt').value.trim();
  if (!prompt) {
    showStatus('promptStatus', 'Prompt cannot be empty', 'error');
    return;
  }
  await chrome.storage.sync.set({ customPrompt: prompt });
  showStatus('promptStatus', 'Custom prompt saved!', 'success');
});

document.getElementById('resetPromptBtn').addEventListener('click', async () => {
  document.getElementById('customPrompt').value = DEFAULT_PROMPT;
  await chrome.storage.sync.set({ customPrompt: DEFAULT_PROMPT });
  showStatus('promptStatus', 'Prompt reset to default', 'success');
});

// Load prompt on init
loadPrompt();

// ============ MODE TAB ============

function updateStudyOptionsVisibility() {
  const mode = document.getElementById('summaryMode').value;
  const studyOptions = document.getElementById('studyOptions');
  
  if (mode === 'study') {
    studyOptions.classList.add('visible');
  } else {
    studyOptions.classList.remove('visible');
  }
}

function updateCheatsheetConfigVisibility() {
  const enabled = document.getElementById('enableCheatsheet').checked;
  const config = document.getElementById('cheatsheetConfig');
  config.classList.toggle('visible', enabled);
}

function updateStudyQuestionsConfigVisibility() {
  const enabled = document.getElementById('enableStudyQuestions').checked;
  const config = document.getElementById('studyQuestionsConfig');
  config.classList.toggle('visible', enabled);
}

document.getElementById('summaryMode').addEventListener('change', updateStudyOptionsVisibility);
document.getElementById('enableCheatsheet').addEventListener('change', updateCheatsheetConfigVisibility);
document.getElementById('enableStudyQuestions').addEventListener('change', updateStudyQuestionsConfigVisibility);

// Populate mode folder dropdowns
async function populateModeFolderDropdowns() {
  const folders = await fetchFolders();
  
  // Populate cheatsheet folder dropdown
  const cheatsheetSelect = document.getElementById('cheatsheetFolder');
  cheatsheetSelect.innerHTML = '<option value="">📁 Vault Root</option>';
  folders.forEach(folder => {
    const option = document.createElement('option');
    option.value = folder;
    option.textContent = `📂 ${folder}`;
    cheatsheetSelect.appendChild(option);
  });
  
  // Populate study questions folder dropdown
  const questionsSelect = document.getElementById('studyQuestionsFolder');
  questionsSelect.innerHTML = '<option value="">📁 Vault Root</option>';
  folders.forEach(folder => {
    const option = document.createElement('option');
    option.value = folder;
    option.textContent = `📂 ${folder}`;
    questionsSelect.appendChild(option);
  });
}

// Refresh buttons for mode folders
document.getElementById('refreshCheatsheetFolders').addEventListener('click', async () => {
  const btn = document.getElementById('refreshCheatsheetFolders');
  btn.textContent = '...';
  btn.disabled = true;
  await populateModeFolderDropdowns();
  // Restore selection
  const settings = await chrome.storage.sync.get(['cheatsheetFolder']);
  if (settings.cheatsheetFolder) {
    document.getElementById('cheatsheetFolder').value = settings.cheatsheetFolder;
  }
  btn.textContent = '↻';
  btn.disabled = false;
});

document.getElementById('refreshQuestionsFolders').addEventListener('click', async () => {
  const btn = document.getElementById('refreshQuestionsFolders');
  btn.textContent = '...';
  btn.disabled = true;
  await populateModeFolderDropdowns();
  // Restore selection
  const settings = await chrome.storage.sync.get(['studyQuestionsFolder']);
  if (settings.studyQuestionsFolder) {
    document.getElementById('studyQuestionsFolder').value = settings.studyQuestionsFolder;
  }
  btn.textContent = '↻';
  btn.disabled = false;
});

async function loadModeSettings() {
  const settings = await chrome.storage.sync.get([
    'summaryMode',
    'enableCheatsheet',
    'cheatsheetFolder',
    'cheatsheetFilename',
    'enableStudyQuestions',
    'studyQuestionsFolder',
    'studyQuestionsFilename'
  ]);
  
  if (settings.summaryMode) {
    document.getElementById('summaryMode').value = settings.summaryMode;
  }
  
  document.getElementById('enableCheatsheet').checked = settings.enableCheatsheet || false;
  // Handle case where filename might be stored as object (from old bug)
  const cheatsheetFn = typeof settings.cheatsheetFilename === 'string' ? settings.cheatsheetFilename : 'Cheatsheet.md';
  document.getElementById('cheatsheetFilename').value = cheatsheetFn || 'Cheatsheet.md';
  document.getElementById('enableStudyQuestions').checked = settings.enableStudyQuestions || false;
  const questionsFn = typeof settings.studyQuestionsFilename === 'string' ? settings.studyQuestionsFilename : 'Study-Questions.md';
  document.getElementById('studyQuestionsFilename').value = questionsFn || 'Study-Questions.md';
  
  // Populate folder dropdowns and restore selections
  await populateModeFolderDropdowns();
  
  if (settings.cheatsheetFolder) {
    document.getElementById('cheatsheetFolder').value = settings.cheatsheetFolder;
  }
  if (settings.studyQuestionsFolder) {
    document.getElementById('studyQuestionsFolder').value = settings.studyQuestionsFolder;
  }
  
  // Update visibility based on loaded settings
  updateStudyOptionsVisibility();
  updateCheatsheetConfigVisibility();
  updateStudyQuestionsConfigVisibility();
}

document.getElementById('saveModeBtn').addEventListener('click', async () => {
  const cheatsheetFolder = document.getElementById('cheatsheetFolder').value;
  const cheatsheetFilename = document.getElementById('cheatsheetFilename').value.trim();
  const questionsFolder = document.getElementById('studyQuestionsFolder').value;
  const questionsFilename = document.getElementById('studyQuestionsFilename').value.trim();
  
  // Build full paths
  const cheatsheetPath = cheatsheetFolder 
    ? `${cheatsheetFolder}/${cheatsheetFilename}` 
    : cheatsheetFilename;
  const studyQuestionsPath = questionsFolder 
    ? `${questionsFolder}/${questionsFilename}` 
    : questionsFilename;
  
  const enableCheatsheet = document.getElementById('enableCheatsheet').checked;
  const enableStudyQuestions = document.getElementById('enableStudyQuestions').checked;
  
  // Validate filenames if options are enabled
  if (enableCheatsheet && !cheatsheetFilename) {
    showStatus('modeStatus', 'Please enter a cheatsheet filename', 'error');
    return;
  }
  
  if (enableStudyQuestions && !questionsFilename) {
    showStatus('modeStatus', 'Please enter a study questions filename', 'error');
    return;
  }
  
  const settings = {
    summaryMode: document.getElementById('summaryMode').value,
    enableCheatsheet,
    cheatsheetFolder,
    cheatsheetFilename,
    cheatsheetPath,
    enableStudyQuestions,
    studyQuestionsFolder,
    studyQuestionsFilename,
    studyQuestionsPath
  };
  
  await chrome.storage.sync.set(settings);
  showStatus('modeStatus', 'Mode settings saved!', 'success');
});

// ============ INITIALIZE ============

displayCurrentSite();
loadSites();
loadSettings();
loadModeSettings();
checkObsidianConnection();
populateFolderDropdown();

setInterval(checkObsidianConnection, 30000); // Check every 30s instead of 5s
