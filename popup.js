document.addEventListener('DOMContentLoaded', () => {
    const statusIndicator = document.getElementById('statusIndicator');
    const consoleLog = document.getElementById('consoleLog');
    const saveBtn = document.getElementById('saveBtn');
    const solveBtn = document.getElementById('solveBtn');
    const usernameInput = document.getElementById('username');
    const passwordInput = document.getElementById('password');
    const dailyLimitInput = document.getElementById('dailyLimit');

    const autoSolveInput = document.getElementById('autoSolve');

    chrome.storage.local.get(['leetcode_username', 'leetcode_password', 'daily_limit', 'auto_run'], (result) => {
        if (result.leetcode_username) usernameInput.value = result.leetcode_username;
        if (result.leetcode_password) passwordInput.value = result.leetcode_password;
        if (result.daily_limit) dailyLimitInput.value = result.daily_limit;
        if (result.auto_run !== undefined) autoSolveInput.checked = result.auto_run;
    });

    function log(message, type = 'info') {
        const entry = document.createElement('div');
        entry.className = `log-entry ${type}`;
        entry.textContent = `> ${message}`;
        consoleLog.appendChild(entry);
        consoleLog.scrollTop = consoleLog.scrollHeight;
    }

    function saveSettings(callback) {
        const username = usernameInput.value;
        const password = passwordInput.value;
        const dailyLimit = dailyLimitInput.value;
        const autoRun = autoSolveInput.checked;

        const originalText = saveBtn.textContent;
        saveBtn.textContent = 'Saving...';
        
        chrome.storage.local.set({
            leetcode_username: username,
            leetcode_password: password,
            daily_limit: parseInt(dailyLimit, 10) || 1,
            auto_run: autoRun
        }, () => {
             log('Configuration saved.', 'success');
             saveBtn.textContent = 'Saved!';
             setTimeout(() => { saveBtn.textContent = originalText; }, 1000);
             
             if (callback) callback();
        });
    }

    saveBtn.addEventListener('click', () => {
        saveSettings(() => {
             statusIndicator.textContent = 'READY';
             statusIndicator.classList.remove('active');
        });
    });

    solveBtn.addEventListener('click', () => {
        saveSettings(() => {
            log('Initiating God Mode protocol...', 'info');
            statusIndicator.textContent = 'ACTIVE';
            statusIndicator.classList.add('active');

            chrome.runtime.sendMessage({ action: 'START_SOLVING' }, (response) => {
                if (chrome.runtime.lastError) {
                    log(`Error: ${chrome.runtime.lastError.message}`, 'error');
                } else {
                    log('Signal sent to background connection.', 'success');
                }
            });
        });
    });

    const stopBtn = document.getElementById('stopBtn');
    if (stopBtn) {
        stopBtn.addEventListener('click', () => {
            log('Sending STOP command...', 'warning');
            statusIndicator.textContent = 'STOPPED';
            statusIndicator.classList.remove('active');
            
            chrome.runtime.sendMessage({ action: 'STOP_SOLVING' }, (response) => {
                 log('System Halted.', 'error');
            });
        });
    }

    chrome.storage.local.get(['is_solving'], (res) => {
        if (res.is_solving) {
            statusIndicator.textContent = 'ACTIVE';
            statusIndicator.classList.add('active');
            log('System is currently running in background.', 'info');
        }
    });

    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === 'LOG_UPDATE') {
            log(request.message, request.type);
        }
    });

    function refreshLogs() {
        chrome.storage.local.get(['logs'], (result) => {
            if (result.logs) {
                consoleLog.innerHTML = ''; 
                result.logs.forEach(item => {
                    const entry = document.createElement('div');
                    entry.className = `log-entry ${item.type}`;
                    entry.textContent = `> ${item.message}`;
                    consoleLog.appendChild(entry);
                });
                consoleLog.scrollTop = consoleLog.scrollHeight;
            }
        });
    }
    
    const devLink = document.getElementById('devLink');
    if (devLink) {
        devLink.addEventListener('click', (e) => {
            e.preventDefault();
            chrome.tabs.create({ url: 'https://github.com/noeankx' });
        });
    }

    refreshLogs();
    setInterval(refreshLogs, 2000); 
});
