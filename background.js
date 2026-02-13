// Background Service Worker
const LEETCODE_ORIGIN = 'https://leetcode.com';

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'START_SOLVING') {
        // Set flag in storage so content script knows to auto-proceed
        chrome.storage.local.set({ is_solving: true, solved_count: 0 }, () => {
            initiateFlow();
        });
        sendResponse({ status: 'started' });
    }
    
    if (request.action === 'STOP_SOLVING') {
        chrome.storage.local.set({ is_solving: false }, () => {
            console.log('GOD MODE: Stop Requested by User.');
            // Broadcast stop to all tabs
            chrome.tabs.query({}, (tabs) => {
                for (let tab of tabs) {
                     chrome.tabs.sendMessage(tab.id, { action: 'STOP_ACTION' }).catch(() => {});
                }
            });
        });
        sendResponse({ status: 'stopped' });
    }

    if (request.action === 'LOG_UPDATE') {
        // Save to storage
        const logEntry = { message: request.message, type: request.type, timestamp: Date.now() };
        
        chrome.storage.local.get(['logs'], (result) => {
            const logs = result.logs || [];
            logs.push(logEntry);
            // Keep last 50
            if (logs.length > 50) logs.shift();
            
            chrome.storage.local.set({ logs: logs });
        });
    }
});

function initiateFlow() {
    // Open LeetCode
    chrome.tabs.create({ url: LEETCODE_ORIGIN + '/problemset/all/' }, (tab) => {
        // The content script will check 'is_solving' and take over.
    });
}

// Alarm for daily logic
chrome.alarms.create('daily_trigger', { periodInMinutes: 1440 });
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'daily_trigger') {
        chrome.storage.local.get(['daily_limit'], (res) => {
            // Check if we should run? Usually yes if installed.
            // Reset solved count for the day?
            chrome.storage.local.set({ solved_count: 0 }, () => {
                initiateFlow();
            });
        });
    }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'PROBLEM_SOLVED') {
        chrome.storage.local.get(['solved_count', 'daily_limit'], (data) => {
            const current = (data.solved_count || 0) + 1;
            const limit = parseInt(data.daily_limit) || 1;
            
            console.log(`GOD MODE DEBUG: Solved Count=${current}, Daily Limit=${limit}`);

            chrome.storage.local.set({ solved_count: current }, () => {
                const badgeText = `${current}/${limit}`;
                chrome.action.setBadgeText({ text: badgeText });
                
                // STRICT CHECK: If we reached (or exceeded) the limit, STOP.
                if (current >= limit) {
                    console.log('Daily Limit Reached! Stopping workflow.');
                    chrome.runtime.sendMessage({ action: 'LOG_UPDATE', message: 'Daily Quota Completed! Stopping...', type: 'success' });
                    
                    chrome.notifications.create({
                        type: 'basic',
                        iconUrl: 'icon.png',
                        title: 'God Mode Complete',
                        message: `Successfully solved ${current} LeetCode problems today.`
                    });

                    // Disable solving flag so it doesn't restart
                    chrome.storage.local.set({ is_solving: false });
                } else {
                    console.log(`Solved ${current}/${limit}. Continuing to next problem...`);
                     // Send message to find next
                    chrome.tabs.sendMessage(sender.tab.id, { action: 'FIND_DAILY' }); 
                }
            });
        });
    }

    if (request.action === 'INJECT_SOLUTION') {
        const code = request.code;
        if (!sender.tab) return;
        
        chrome.scripting.executeScript({
            target: { tabId: sender.tab.id },
            world: 'MAIN',
            func: (solutionCode) => {
                try {
                    console.log(`GOD MODE: Received code to inject (${solutionCode.length} chars)`);
                    console.log(`GOD MODE: Preview: ${solutionCode.substring(0, 50)}...`);
                    
                    // Find the correct model by checking its Language ID
                    const models = window.monaco.editor.getModels();
                    let targetModel = null;
                    
                    console.log(`GOD MODE: Found ${models.length} Monaco models.`);
                    
                    // List of valid coding languages on LeetCode
                    const validLangs = ['cpp', 'java', 'python', 'python3', 'c', 'csharp', 'javascript', 'typescript', 'swift', 'go', 'kotlin', 'scala', 'rust', 'php', 'ruby', 'dart', 'erlang', 'elixir'];

                    for (let m of models) {
                        const lang = m.getLanguageId();
                        const uri = m.uri.toString();
                        console.log(`GOD MODE: Model Analysis -> Lang: ${lang}, URI: ${uri}`);
                        
                        // Heuristic: Main editor usually has a specific language, not plaintext/markdown
                        if (validLangs.includes(lang)) {
                            targetModel = m;
                            console.log(`GOD MODE: Identified main model by Language ID: ${lang}`);
                            break;
                        }
                    }

                    // Fallback: Check if active editor has a valid language
                    if (!targetModel) {
                        const editors = window.monaco.editor.getEditors();
                        if (editors.length > 0) {
                            const activeModel = editors[0].getModel();
                            if (activeModel && validLangs.includes(activeModel.getLanguageId())) {
                                targetModel = activeModel;
                                console.log('GOD MODE: Fallback to active editor with valid language.');
                            }
                        }
                    }

                    if (targetModel) {
                        targetModel.setValue(solutionCode);
                        console.log('GOD MODE: Injected successfully into Language-Identified Model.');
                    } else {
                        console.error('GOD MODE: Could not find any valid code model (only text/log models found).');
                        // Last resort: Inject into the largest model (likely the code?)
                        let largest = null;
                        let maxLen = -1;
                        for (let m of models) {
                            if (m.getValueLength() > maxLen) {
                                maxLen = m.getValueLength();
                                largest = m;
                            }
                        }
                        if (largest) {
                             console.warn('GOD MODE: Desperate Fallback -> Injecting into largest model.');
                             largest.setValue(solutionCode);
                        }
                    }
                } catch (e) {
                    console.error('GOD MODE: Main World Error', e);
                    throw e; 
                }
            },
            args: [code]
        }, (results) => {
            if (chrome.runtime.lastError) {
                sendResponse({ success: false, error: chrome.runtime.lastError.message });
            } else if (results && results[0] && results[0].error) {
                sendResponse({ success: false, error: 'Script Error' });
            } else {
                sendResponse({ success: true });
            }
        });
        return true; // Async response
    }

    if (request.action === 'SOLVE_FAILED') {
        // Do NOT stop. Try another problem.
        chrome.runtime.sendMessage({ action: 'LOG_UPDATE', message: `Failed: ${request.reason}. Retry in 5s...`, type: 'error' });
        
        // Wait longer to ensure UI settles, then try next
        setTimeout(() => {
            if (sender.tab && sender.tab.id) {
                // We send FIND_DAILY which triggers findNextProblem (random)
                chrome.tabs.sendMessage(sender.tab.id, { action: 'FIND_DAILY' });
            }
        }, 5000); 
    }
});

// Alarm for daily trigger logic
chrome.alarms.create('daily_trigger', { periodInMinutes: 60 }); // Check every hour
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'daily_trigger') {
        checkAndRunAutoSolve();
    }
});

// Run on browser startup too
chrome.runtime.onStartup.addListener(() => {
    console.log('GOD MODE: Browser Startup - Checking Auto-Run...');
    setTimeout(checkAndRunAutoSolve, 5000); // Wait for browser to settle
});

function checkAndRunAutoSolve() {
    chrome.storage.local.get(['auto_run', 'daily_limit', 'solved_count', 'leetcode_username'], (data) => {
        if (!data.auto_run) {
            console.log('GOD MODE: Auto-Run is disabled.');
            return;
        }

        const limit = parseInt(data.daily_limit) || 1;
        const current = data.solved_count || 0;
        
        // Reset count if it's a new day? 
        // For simplicity, we assume the user manages the "daily" aspect or we blindly run if < limit.
        // A better "daily" check would involve storing the "last_solved_date".
        
        chrome.storage.local.get(['last_solved_date'], (dateData) => {
            const today = new Date().toDateString();
            if (dateData.last_solved_date !== today) {
                // New day! Reset count
                console.log('GOD MODE: New Day Detected! Resetting count.');
                chrome.storage.local.set({ solved_count: 0, last_solved_date: today, is_solving: true }, () => {
                   initiateFlow(); 
                });
            } else if (current < limit) {
                console.log(`GOD MODE: Quota Unmet (${current}/${limit}). Auto-starting...`);
                chrome.storage.local.set({ is_solving: true }, () => {
                     initiateFlow();
                });
            } else {
                console.log('GOD MODE: Daily quota already met. Sleeping.');
            }
        });
    });
}
