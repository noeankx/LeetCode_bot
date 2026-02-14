const LEETCODE_ORIGIN = 'https://leetcode.com';

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'START_SOLVING') {
        chrome.storage.local.set({ is_solving: true, solved_count: 0 }, () => {
            initiateFlow();
        });
        sendResponse({ status: 'started' });
    }
    
    if (request.action === 'STOP_SOLVING') {
        chrome.storage.local.set({ is_solving: false }, () => {
            console.log('GOD MODE: Stop Requested by User.');
            chrome.tabs.query({}, (tabs) => {
                for (let tab of tabs) {
                     chrome.tabs.sendMessage(tab.id, { action: 'STOP_ACTION' }).catch(() => {});
                }
            });
        });
        sendResponse({ status: 'stopped' });
    }

    if (request.action === 'LOG_UPDATE') {
        const logEntry = { message: request.message, type: request.type, timestamp: Date.now() };
        
        chrome.storage.local.get(['logs'], (result) => {
            const logs = result.logs || [];
            logs.push(logEntry);
            if (logs.length > 50) logs.shift();
            
            chrome.storage.local.set({ logs: logs });
        });
    }
});

function initiateFlow() {
    chrome.tabs.create({ url: LEETCODE_ORIGIN + '/problemset/all/' }, (tab) => {
    });
}

chrome.alarms.create('daily_trigger', { periodInMinutes: 1440 });
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'daily_trigger') {
        chrome.storage.local.get(['daily_limit'], (res) => {
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
                
                if (current >= limit) {
                    console.log('Daily Limit Reached! Stopping workflow.');
                    chrome.runtime.sendMessage({ action: 'LOG_UPDATE', message: 'Daily Quota Completed! Stopping...', type: 'success' });
                    
                    chrome.notifications.create({
                        type: 'basic',
                        iconUrl: 'icon.png',
                        title: 'God Mode Complete',
                        message: `Successfully solved ${current} LeetCode problems today.`
                    });

                    chrome.storage.local.set({ is_solving: false });
                } else {
                    console.log(`Solved ${current}/${limit}. Continuing to next problem...`);
                    
                    // Robust Navigation: Try to message the tab, but fallback to URL update if it fails/disconnects
                    chrome.tabs.sendMessage(sender.tab.id, { action: 'FIND_DAILY' }, (response) => {
                         if (chrome.runtime.lastError) {
                             console.warn('GOD MODE: Content script unavailable. Forcing navigation to problemset.');
                             chrome.tabs.update(sender.tab.id, { url: LEETCODE_ORIGIN + '/problemset/all/' });
                         }
                    });
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
                    
                    const models = window.monaco.editor.getModels();
                    let targetModel = null;
                    
                    console.log(`GOD MODE: Found ${models.length} Monaco models.`);
                    
                    const validLangs = ['cpp', 'java', 'python', 'python3', 'c', 'csharp', 'javascript', 'typescript', 'swift', 'go', 'kotlin', 'scala', 'rust', 'php', 'ruby', 'dart', 'erlang', 'elixir'];

                    for (let m of models) {
                        const lang = m.getLanguageId();
                        const uri = m.uri.toString();
                        console.log(`GOD MODE: Model Analysis -> Lang: ${lang}, URI: ${uri}`);
                        
                        if (validLangs.includes(lang)) {
                            targetModel = m;
                            console.log(`GOD MODE: Identified main model by Language ID: ${lang}`);
                            break;
                        }
                    }

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
        return true; 
    }

    if (request.action === 'SOLVE_FAILED') {
        chrome.runtime.sendMessage({ action: 'LOG_UPDATE', message: `Failed: ${request.reason}. Retry in 5s...`, type: 'error' });
        
        setTimeout(() => {
            if (sender.tab && sender.tab.id) {
                chrome.tabs.sendMessage(sender.tab.id, { action: 'FIND_DAILY' }, (response) => {
                    if (chrome.runtime.lastError) {
                         console.warn('GOD MODE: Retry failed (script lost). Reloading problemset...');
                         chrome.tabs.update(sender.tab.id, { url: LEETCODE_ORIGIN + '/problemset/all/' });
                    }
                });
            }
        }, 5000); 
    }
});

chrome.alarms.create('daily_trigger', { periodInMinutes: 60 });
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'daily_trigger') {
        checkAndRunAutoSolve();
    }
});

chrome.runtime.onStartup.addListener(() => {
    console.log('GOD MODE: Browser Startup - Checking Auto-Run...');
    setTimeout(checkAndRunAutoSolve, 5000); 
});

function checkAndRunAutoSolve() {
    chrome.storage.local.get(['auto_run', 'daily_limit', 'solved_count', 'leetcode_username'], (data) => {
        if (!data.auto_run) {
            console.log('GOD MODE: Auto-Run is disabled.');
            return;
        }

        const limit = parseInt(data.daily_limit) || 1;
        const current = data.solved_count || 0;
        
        chrome.storage.local.get(['last_solved_date'], (dateData) => {
            const today = new Date().toDateString();
            if (dateData.last_solved_date !== today) {
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
