// Check if current site is whitelisted before injecting button
async function checkAndInject() {
  const settings = await chrome.storage.sync.get(['whitelistedSites', 'enableOnAllSites']);
  const currentHost = window.location.hostname;
  
  // Check if enabled on all sites or whitelisted
  if (settings.enableOnAllSites) {
    injectButton();
    return;
  }
  
  const whitelist = settings.whitelistedSites || [];
  const isWhitelisted = whitelist.some(site => {
    // Support wildcards like *.example.com
    if (site.startsWith('*.')) {
      const domain = site.slice(2);
      return currentHost.endsWith(domain);
    }
    return currentHost === site || currentHost.endsWith('.' + site);
  });
  
  if (isWhitelisted) {
    injectButton();
  }
}

// Inject the floating summarize button
async function injectButton() {
  if (document.getElementById('page-summarizer-btn')) return;

  // Inject styles
  if (!document.getElementById('page-summarizer-styles')) {
    const link = document.createElement('link');
    link.id = 'page-summarizer-styles';
    link.rel = 'stylesheet';
    link.href = chrome.runtime.getURL('styles.css');
    document.head.appendChild(link);
  }

  // Load theme and position settings
  const settings = await chrome.storage.sync.get(['themeColor', 'buttonPosition']);
  
  // Apply theme color
  if (settings.themeColor) {
    applyThemeColor(settings.themeColor);
  }

  const button = document.createElement('button');
  button.id = 'page-summarizer-btn';
  button.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
      <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/>
    </svg>
    <span>Summarize</span>
  `;
  
  // Start in tucked state
  button.classList.add('tucked');
  
  // Apply saved position
  if (settings.buttonPosition) {
    button.style.top = settings.buttonPosition.top;
    button.style.right = settings.buttonPosition.right;
    button.style.left = settings.buttonPosition.left || 'auto';
    button.style.bottom = settings.buttonPosition.bottom || 'auto';
  }
  
  // Add drag functionality
  makeDraggable(button, null, 'buttonPosition');
  
  button.addEventListener('click', handleSummarize);
  document.body.appendChild(button);
}

// Apply theme color to CSS variables
function applyThemeColor(color) {
  // Convert hex to RGB for rgba usage
  const hex = color.replace('#', '');
  const r = parseInt(hex.substr(0, 2), 16);
  const g = parseInt(hex.substr(2, 2), 16);
  const b = parseInt(hex.substr(4, 2), 16);
  
  // Create lighter version
  const lighterR = Math.min(255, r + 40);
  const lighterG = Math.min(255, g + 40);
  const lighterB = Math.min(255, b + 40);
  const lighterHex = `#${lighterR.toString(16).padStart(2, '0')}${lighterG.toString(16).padStart(2, '0')}${lighterB.toString(16).padStart(2, '0')}`;
  
  // Apply to document
  document.documentElement.style.setProperty('--ps-primary', color);
  document.documentElement.style.setProperty('--ps-primary-light', lighterHex);
  document.documentElement.style.setProperty('--ps-primary-rgb', `${r}, ${g}, ${b}`);
}

// Make an element draggable
function makeDraggable(element, handle = null, storageKey = null) {
  let isDragging = false;
  let startX, startY;
  let startLeft, startTop;
  let hasMoved = false;
  
  const dragHandle = handle || element;
  
  dragHandle.addEventListener('mousedown', (e) => {
    // Only drag with left mouse button
    if (e.button !== 0) return;
    // Don't drag if clicking on buttons inside handle
    if (e.target.tagName === 'BUTTON') return;
    
    isDragging = true;
    hasMoved = false;
    startX = e.clientX;
    startY = e.clientY;
    
    const rect = element.getBoundingClientRect();
    startLeft = rect.left;
    startTop = rect.top;
    
    element.classList.add('dragging');
    e.preventDefault();
  });
  
  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    
    const deltaX = e.clientX - startX;
    const deltaY = e.clientY - startY;
    
    // Only consider it a drag if moved more than 5px
    if (Math.abs(deltaX) > 5 || Math.abs(deltaY) > 5) {
      hasMoved = true;
    }
    
    const newLeft = startLeft + deltaX;
    const newTop = startTop + deltaY;
    
    // Keep element within viewport
    const maxLeft = window.innerWidth - element.offsetWidth;
    const maxTop = window.innerHeight - element.offsetHeight;
    
    element.style.left = `${Math.max(0, Math.min(maxLeft, newLeft))}px`;
    element.style.top = `${Math.max(0, Math.min(maxTop, newTop))}px`;
    element.style.right = 'auto';
    element.style.bottom = 'auto';
  });
  
  document.addEventListener('mouseup', async () => {
    if (!isDragging) return;
    
    isDragging = false;
    element.classList.remove('dragging');
    
    // Save position if moved and storage key provided
    if (hasMoved && storageKey) {
      const position = {
        top: element.style.top,
        left: element.style.left,
        right: 'auto',
        bottom: 'auto'
      };
      await chrome.storage.sync.set({ [storageKey]: position });
    }
  });
  
  // Prevent click from firing if we were dragging
  element.addEventListener('click', (e) => {
    if (hasMoved) {
      e.stopPropagation();
      e.preventDefault();
      hasMoved = false;
    }
  }, true);
}

// Create toast notification
function showToast(message, type = 'info') {
  let toast = document.getElementById('page-summarizer-toast');
  
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'page-summarizer-toast';
    document.body.appendChild(toast);
  }
  
  toast.textContent = message;
  toast.className = `show ${type}`;
  
  setTimeout(() => {
    toast.classList.remove('show');
  }, 4000);
}

// Create/show log panel
async function createLogPanel() {
  let panel = document.getElementById('page-summarizer-log');
  
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'page-summarizer-log';
    panel.innerHTML = `
      <div id="page-summarizer-log-header">
        <span>📋 Summarizer Log</span>
        <button id="page-summarizer-log-close">×</button>
      </div>
      <div id="page-summarizer-log-content"></div>
    `;
    document.body.appendChild(panel);
    
    document.getElementById('page-summarizer-log-close').addEventListener('click', () => {
      panel.classList.remove('show');
    });
    
    // Apply saved position
    const { logPanelPosition } = await chrome.storage.sync.get(['logPanelPosition']);
    if (logPanelPosition) {
      panel.style.top = logPanelPosition.top;
      panel.style.left = logPanelPosition.left;
      panel.style.right = logPanelPosition.right || 'auto';
      panel.style.bottom = logPanelPosition.bottom || 'auto';
    }
    
    // Make log panel draggable via header
    const header = document.getElementById('page-summarizer-log-header');
    makeDraggable(panel, header, 'logPanelPosition');
  }
  
  // Clear previous logs
  document.getElementById('page-summarizer-log-content').innerHTML = '';
  panel.classList.add('show');
  
  return panel;
}

function addLog(message, type = 'info') {
  const content = document.getElementById('page-summarizer-log-content');
  if (!content) return;
  
  const icons = {
    info: '○',
    working: '◌',
    success: '✓',
    error: '✗'
  };
  
  const entry = document.createElement('div');
  entry.className = `log-entry ${type}`;
  entry.innerHTML = `<span class="log-icon">${icons[type]}</span><span>${message}</span>`;
  content.appendChild(entry);
  content.scrollTop = content.scrollHeight;
}

// Try to extract page number from various sources
function extractPageNumber() {
  // Method 1: Look for page info in breadcrumbs or page indicators (HTB Academy style)
  const pageInfoSelectors = ['.page-info', '.breadcrumb', '.pagination-info', '.page-number'];
  for (const selector of pageInfoSelectors) {
    const el = document.querySelector(selector);
    if (el) {
      const match = el.innerText.match(/Page\s*(\d+)/i);
      if (match) return match[1];
    }
  }
  
  // Method 2: Look for "Section X" or "Chapter X" or "Lesson X" patterns
  const headerEl = document.querySelector('h1, h2, .title, .header-title');
  if (headerEl) {
    const match = headerEl.innerText.match(/^(\d+)[.\-\s]/);
    if (match) return match[1];
  }
  
  // Method 3: Extract from URL patterns like /page/7, /07-title, /section-3
  const url = window.location.href;
  const urlPatterns = [
    /\/page\/(\d+)/i,           // /page/7
    /\/(\d+)-[a-z]/i,           // /07-title
    /\/section[/-]?(\d+)/i,     // /section-3 or /section/3
    /\/chapter[/-]?(\d+)/i,     // /chapter-3
    /\/lesson[/-]?(\d+)/i,      // /lesson-3
    /\/module[/-]?(\d+)/i,      // /module-3
    /[?&]page=(\d+)/i,          // ?page=3
    /[?&]p=(\d+)/i,             // ?p=3
  ];
  
  for (const pattern of urlPatterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  
  // Method 4: Check for active pagination element
  const activePage = document.querySelector('.pagination .active, .page-item.active, [aria-current="page"]');
  if (activePage) {
    const num = activePage.innerText.match(/\d+/);
    if (num) return num[0];
  }
  
  return null;
}

// Extract page content
function extractPageContent() {
  // Try to find main content area
  const selectors = [
    'article',
    'main',
    '[role="main"]',
    '.post-content',
    '.article-content',
    '.entry-content',
    '.content',
    '#content',
    '.documentation',
    '.docs-content',
    '.training-module'  // HTB Academy
  ];
  
  let mainContent = null;
  for (const selector of selectors) {
    mainContent = document.querySelector(selector);
    if (mainContent) break;
  }
  
  // Fall back to body
  if (!mainContent) {
    mainContent = document.body;
  }
  
  // Get title
  const titleEl = document.querySelector('h1') || document.querySelector('.module-title') || document.querySelector('title');
  const title = titleEl ? titleEl.innerText.trim() : document.title;
  
  // Get page number
  const pageNum = extractPageNumber();
  
  // Get text content
  const textContent = mainContent.innerText;
  
  // Get images with their alt text and URLs (filter out icons/logos)
  const images = Array.from(mainContent.querySelectorAll('img'))
    .filter(img => {
      if (!img.src || img.src.startsWith('data:')) return false;
      if (img.width < 100 || img.height < 100) return false;
      const src = img.src.toLowerCase();
      if (src.includes('logo') || src.includes('icon') || src.includes('avatar')) return false;
      return true;
    })
    .map(img => ({
      src: img.src,
      alt: img.alt || ''
    }));
  
  return {
    title,
    pageNum,
    url: window.location.href,
    hostname: window.location.hostname,
    textContent,
    images
  };
}

// Handle summarize button click
async function handleSummarize() {
  const button = document.getElementById('page-summarizer-btn');
  
  // Check if already processing
  if (button.classList.contains('loading')) return;
  
  // Show log panel
  createLogPanel();
  
  button.classList.add('loading');
  button.classList.remove('tucked');
  button.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 18a8 8 0 1 1 8-8 8 8 0 0 1-8 8z" opacity=".3"/>
      <path d="M20 12h2A10 10 0 0 0 12 2v2a8 8 0 0 1 8 8z"/>
    </svg>
    <span>Summarizing...</span>
  `;
  
  try {
    addLog('Loading settings...', 'info');
    
    // Get settings from storage
    const settings = await chrome.storage.sync.get([
      'apiKey', 'apiProvider', 'model', 'obsidianApiKey', 'folderPath',
      'summaryMode', 'enableCheatsheet', 'cheatsheetPath', 
      'enableStudyQuestions', 'studyQuestionsPath', 'customPrompt'
    ]);
    
    if (!settings.apiKey) {
      throw new Error('Please set your AI API key in the extension settings');
    }
    
    if (!settings.obsidianApiKey) {
      throw new Error('Please set your Obsidian API key in the extension settings');
    }
    
    addLog('Settings loaded ✓', 'success');
    addLog('Extracting page content...', 'working');
    
    // Extract page content
    const pageData = extractPageContent();
    
    addLog(`Found: "${pageData.title}"`, 'success');
    addLog(`Images: ${pageData.images.length} found`, 'info');
    
    const mode = settings.summaryMode || 'standard';
    const modeLabel = mode === 'study' ? '📚 Study Mode' : '📝 Standard';
    addLog(`Mode: ${modeLabel}`, 'info');
    
    if (settings.customPrompt && settings.customPrompt.trim()) {
      addLog('Using custom prompt ✓', 'info');
    }
    
    if (mode === 'study') {
      if (settings.enableCheatsheet) addLog('→ Cheatsheet enabled', 'info');
      if (settings.enableStudyQuestions) addLog('→ Study Questions enabled', 'info');
    }
    
    addLog(`Calling ${settings.apiProvider || 'anthropic'} API...`, 'working');
    
    // Send to background script for API call
    const response = await chrome.runtime.sendMessage({
      action: 'summarize',
      pageData,
      settings
    });
    
    if (response.error) {
      throw new Error(response.error);
    }
    
    addLog('Summary generated ✓', 'success');
    
    // Show usage info
    if (response.usage) {
      const tokens = (response.usage.tokens || 0).toLocaleString();
      if (response.usage.cost !== null && response.usage.cost !== undefined && response.usage.cost > 0) {
        const cost = response.usage.cost.toFixed(4);
        addLog(`Est. Cost: ~$${cost} (${tokens} tokens)`, 'success');
      } else {
        addLog(`Tokens used: ${tokens}`, 'info');
      }
    }
    
    addLog(`Saving: ${response.filename}`, 'working');
    addLog('Summary saved! ✓', 'success');
    
    // Show additional files saved in study mode
    if (response.cheatsheetSaved) {
      addLog(`Cheatsheet updated: ${response.cheatsheetPath}`, 'success');
    }
    if (response.questionsSaved) {
      addLog(`Study Questions updated: ${response.questionsPath}`, 'success');
    }
    
    // Build toast message with all saved files
    let toastParts = [`✓ Summary: ${response.filename}`];
    if (response.cheatsheetSaved) {
      toastParts.push(`📝 Cheatsheet updated`);
    }
    if (response.questionsSaved) {
      toastParts.push(`❓ Study Questions updated`);
    }
    showToast(toastParts.join(' • '), 'success');
    button.classList.remove('loading');
    button.classList.add('success');
    button.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
        <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
      </svg>
      <span>Saved!</span>
    `;
    
    // Reset button after 3 seconds
    setTimeout(() => {
      button.classList.remove('success');
      button.classList.add('tucked');
      button.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
          <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/>
        </svg>
        <span>Summarize</span>
      `;
    }, 3000);
    
  } catch (error) {
    console.error('Summarize error:', error);
    addLog(`Error: ${error.message}`, 'error');
    showToast(`Error: ${error.message}`, 'error');
    button.classList.remove('loading');
    button.classList.add('error');
    button.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
        <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
      </svg>
      <span>Error</span>
    `;
    
    setTimeout(() => {
      button.classList.remove('error');
      button.classList.add('tucked');
      button.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
          <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/>
        </svg>
        <span>Summarize</span>
      `;
    }, 3000);
  }
}

// Listen for messages from popup to add current site
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'injectButton') {
    injectButton();
    sendResponse({ success: true });
  } else if (request.action === 'removeButton') {
    const btn = document.getElementById('page-summarizer-btn');
    if (btn) btn.remove();
    sendResponse({ success: true });
  } else if (request.action === 'updateTheme') {
    applyThemeColor(request.color);
    sendResponse({ success: true });
  }
  return true;
});

// Initialize
checkAndInject();

// Re-inject button if navigating within SPA (debounced)
let debounceTimer;
const observer = new MutationObserver(() => {
  // Only check if button is missing, debounce to avoid spam
  if (!document.getElementById('page-summarizer-btn')) {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(checkAndInject, 500);
  }
});

observer.observe(document.body, { childList: true, subtree: false });
