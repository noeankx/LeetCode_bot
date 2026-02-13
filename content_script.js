// Content Script for LeetCode God Mode

console.log('GOD MODE v2.0: Content Script Loaded');

function logToBackground(msg, type='info') {
    console.log(`GOD MODE [${type}]: ${msg}`);
    chrome.runtime.sendMessage({ action: 'LOG_UPDATE', message: msg, type: type });
}

// ... (other code) ...

function extractCodeBlock(markdown) {
    if (!markdown) return null;

    // Pattern 1: Triple backticks with specific language tag (including +, #, etc)
    // matches ```cpp, ```c++, ```c#, ```python3
    const match1 = markdown.match(/```([^\n]*)\n([\s\S]*?)```/);
    if (match1 && match1[2] && match1[2].trim().length > 0) {
        return match1[2].trim();
    }

    // Pattern 2: Triple backticks without specified language
    const match2 = markdown.match(/```([\s\S]*?)```/);
    if (match2 && match2[1] && match2[1].trim().length > 0) {
        return match2[1].trim();
    }

    // Pattern 3: Heuristic for raw code
    if (markdown.includes('class Solution') || markdown.includes('def ')) {
        return markdown; 
    }

    return null;
}

const GRAPHQL_URL = 'https://leetcode.com/graphql';

// --- Main State Machine ---
let isStopped = false;

async function init() {
    const url = window.location.href;
    
    // 1. Login Check
    if (url.includes('/accounts/login')) {
        handleLogin();
        return;
    }

    // 2. Listen for background commands
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
        if (msg.action === 'FIND_DAILY') {
            if (!isStopped) findNextProblem();
        } else if (msg.action === 'SOLVE_PROBLEM') {
            if (!isStopped) solveProblem();
        } else if (msg.action === 'STOP_ACTION') {
            isStopped = true;
            console.log('GOD MODE: Stopping content script operations immediately.');
            window.stop(); // Stop page loading if possible
        }
    });

    // 3. Auto-trigger if configured (checking storage)
    chrome.storage.local.get(['is_solving', 'daily_limit'], (data) => {
        if (data.is_solving && !isStopped) {
            // we are in a solve loop
            if (url.includes('/problems/')) {
                // Check if it's a premium problem that redirected us (Subscription wall)
                const isPremium = document.body.innerText.includes('Subscribe to unlock') || document.querySelector('.premium-lock-icon');
                if (isPremium) {
                     logToBackground('Detected Premium Question (Locked). Skipping...', 'warning');
                     if (!isStopped) chrome.runtime.sendMessage({ action: 'SOLVE_FAILED', reason: 'Premium Locked' });
                } else {
                     solveProblem();
                }
            } else {
                findNextProblem();
            }
        }
    });
}

// --- Login Logic ---
async function handleLogin() {
    const data = await chrome.storage.local.get(['leetcode_username', 'leetcode_password']);
    if (!data.leetcode_username || !data.leetcode_password) return;

    const userField = document.querySelector('#id_login') || document.querySelector('input[name="login"]');
    const passField = document.querySelector('#id_password') || document.querySelector('input[name="password"]');
    const btn = document.querySelector('#signin_btn') || document.querySelector('button[type="submit"]');

    if (userField && passField && btn) {
        userField.value = data.leetcode_username;
        passField.value = data.leetcode_password;
        userField.dispatchEvent(new Event('input', { bubbles: true }));
        passField.dispatchEvent(new Event('input', { bubbles: true }));
        
        // Gentle delay before click
        setTimeout(() => btn.click(), 500);
    }
}

// --- Problem Finding (API) ---
async function findDailyQuestion() {
    console.log('GOD MODE: Fetching Daily Question...');
    const query = `
    query questionOfToday {
        activeDailyCodingChallengeQuestion {
            link
            question {
                titleSlug
            }
        }
    }`;

    try {
        const response = await fetch(GRAPHQL_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query })
        });
        const result = await response.json();
        const link = result.data.activeDailyCodingChallengeQuestion.link;
        if (link) {
            window.location.href = `https://leetcode.com${link}`;
        }
    } catch (e) {
        console.error('GOD MODE: Failed to fetch daily.', e);
    }
}

// --- Solving Logic ---
// (Moved to async flow below)

// --- Fallback Logic ---
async function getProblemId(slug) {
    const query = `
    query questionTitle($titleSlug: String!) {
        question(titleSlug: $titleSlug) {
            questionFrontendId
        }
    }`;
    const variables = { titleSlug: slug };
    try {
        const res = await fetch(GRAPHQL_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query, variables })
        });
        const json = await res.json();
        const id = json.data.question.questionFrontendId;
        logToBackground(`Problem ID found: ${id}`, 'info');
        return id;
    } catch (e) {
        logToBackground(`Failed to get Problem ID: ${e.message}`, 'error');
        return null;
    }
}

async function fetchFromGitHub(frontendId) {
    // Pad ID to 4 digits (e.g., 1 -> 0001, 12 -> 0012)
    const paddedId = frontendId.padStart(4, '0');
    logToBackground(`Attempting GitHub WalkCCC fallback for ID: ${paddedId}...`, 'warning');

    const url = `https://raw.githubusercontent.com/walkccc/LeetCode/main/solutions/cpp/${paddedId}.cpp`;
    logToBackground(`Trying URL: ${url}`, 'info');
    
    try {
        const res = await fetch(url);
        if (res.ok) {
            const text = await res.text();
            if (isCpp(text)) {
                    logToBackground(`WalkCCC Verified C++! Length: ${text.length}`, 'success');
                    return text;
            }
        }
    } catch (e) {
        logToBackground(`WalkCCC fetch failed: ${e.message}`, 'error');
    }
    return null;
}

// --- Language Heuristics ---
function isCpp(code) {
    if (!code) return false;
    // C++ indicators
    const keywords = ['public:', 'class Solution', 'vector<', 'int ', 'bool ', 'string ', 'auto ', 'nullptr'];
    let score = 0;
    for (let k of keywords) {
        if (code.includes(k)) score++;
    }
    // Also ensure it doesn't look like Python
    if (code.includes('def canPartition') && !code.includes(';')) return false;
    
    return score >= 2; // Threshold
}

// --- Main Fetch Strategy ---
async function fetchTopSolution(slug) {
    if (!slug) {
        logToBackground('Error: Problem Slug is missing!', 'error');
        return null;
    }
    logToBackground(`Fetching solutions for: ${slug}`, 'info');

    // 1. Try LeetCode Community (Relaxed)
    const query = `
    query communitySolutions($questionSlug: String!, $skip: Int!, $first: Int!, $orderBy: TopicSortingOption, $languageTags: [String!], $topicTags: [String!]) {
        questionSolutions(
            filters: {questionSlug: $questionSlug, skip: $skip, first: $first, orderBy: $orderBy, languageTags: $languageTags, topicTags: $topicTags}
        ) {
            solutions {
                id
                title
                post { content }
            }
        }
    }`;
    
    try {
        const res = await fetch(GRAPHQL_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query, variables: {
                questionSlug: slug,
                skip: 0,
                first: 10, 
                orderBy: "most_votes",
                languageTags: null, 
                topicTags: null 
            }})
        });
        const json = await res.json();
        const solutions = json.data?.questionSolutions?.solutions || [];
        
        logToBackground(`LeetCode Community found: ${solutions.length}`, 'info');

        for (let sol of solutions) {
            // Extract ANY code block
            const code = extractCodeBlock(sol.post.content);
            
            if (code && code.length > 30) {
                if (isCpp(code)) {
                    logToBackground(`Verified C++ Content! Preview: ${code.substring(0,20)}...`, 'success');
                    return code;
                } else {
                     logToBackground('Skipped non-C++ code block.', 'info');
                }
            }
        }
    } catch (e) {
        logToBackground(`Community fetch failed: ${e.message}`, 'error');
    }

    // 2. Fallback to GitHub (Kamyu104 - Slug based, often reliable for C++)
    logToBackground('Trying Fallback 1: Kamyu104 (Slug-based)...', 'warning');
    try {
        // Kamyu104 logic: https://raw.githubusercontent.com/kamyu104/LeetCode-Solutions/master/C%2B%2B/<slug>.cpp
        const url = `https://raw.githubusercontent.com/kamyu104/LeetCode-Solutions/master/C%2B%2B/${slug}.cpp`;
        const res = await fetch(url);
        if (res.ok) {
            const text = await res.text();
             if (isCpp(text)) {
                 logToBackground('Kamyu104 fallback successful!', 'success');
                 return text;
             }
        }
    } catch (e) { logToBackground(`Kamyu104 failed: ${e.message}`, 'warning'); }


    // 3. Fallback to GitHub (WalkCCC - ID based)
    logToBackground('Trying Fallback 2: WalkCCC (ID-based)...', 'warning');
    const problemId = await getProblemId(slug);
    if (problemId) {
        const ghCode = await fetchFromGitHub(problemId);
        if (ghCode && isCpp(ghCode)) return ghCode;
    } else {
        logToBackground('Could not retrieve Problem ID for fallback.', 'error');
    }

    logToBackground('All sources failed. No solution found.', 'error');
    return null;
}

function extractCodeBlock(markdown) {
    if (!markdown) return null;

    // Pattern 1: Standard triple backticks with optional language and newline
    // Tolerates trailing spaces/chars on the opening line
    const match1 = markdown.match(/```[ \t]*(\w*)[^\n]*\n([\s\S]*?)```/);
    if (match1 && match1[2] && match1[2].trim().length > 0) {
        logToBackground(`Regex Match (Pattern 1): Lang=${match1[1]}`, 'info');
        return match1[2].trim();
    }

    // Pattern 2: Triple backticks without valid newline (rare but possible)
    const match2 = markdown.match(/```(\w*)\s+([\s\S]*?)```/);
    if (match2 && match2[2] && match2[2].trim().length > 0) {
        logToBackground('Regex Match (Pattern 2)', 'info');
        return match2[2].trim();
    }
    
    // Pattern 3: HTML Code blocks <pre><code>...</code></pre>
    const match3 = markdown.match(/<pre>[\s\S]*?<code>([\s\S]*?)<\/code>[\s\S]*?<\/pre>/);
    if (match3 && match3[1]) {
        logToBackground('Regex Match (HTML pre/code)', 'info');
        // Decode HTML entities if needed (basic ones)
        let code = match3[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
        return code.trim();
    }

    // REMOVED Dangerous "class Solution" substring fallback.
    // It was capturing the entire post if regex failed.

    return null;
}

async function injectCode(code) {
    logToBackground('Delegating injection to background (Bypassing CSP)...', 'info');
    
    return new Promise((resolve) => {
        chrome.runtime.sendMessage({ action: 'INJECT_SOLUTION', code: code }, (response) => {
            if (response && response.success) {
                logToBackground('Code injection confirmed', 'success');
                resolve(true);
            } else {
                const err = response ? response.error : 'Unknown error';
                logToBackground(`Injection failed: ${err}`, 'error');
                resolve(false);
            }
        });
    });
}

async function solveProblem() {
    if (isStopped) return;
    console.log('GOD MODE: Attempting to solve...');
    
    const pathParts = window.location.pathname.split('/');
    const slug = pathParts[2];

    const solutionCode = await fetchTopSolution(slug);
    
    if (isStopped) return; // Check again after await

    if (solutionCode) {
        const success = await injectCode(solutionCode);
        if (isStopped) return; // Check again
        
        if (success) {
            setTimeout(() => { if (!isStopped) clickSubmit(); }, 2000);
            monitorSubmission();
        } else {
            chrome.runtime.sendMessage({ action: 'SOLVE_FAILED', reason: 'Injection Failed' });
        }
    } else {
        console.error('GOD MODE: No solution found.');
        chrome.runtime.sendMessage({ action: 'SOLVE_FAILED', reason: 'No solution' });
    }
}

let submissionSent = false;
function clickSubmit() {
    submissionSent = false; // Reset flag for new attempt
    // Try multiple selectors for the submit button
    const selectors = [
        '[data-e2e-locator="console-submit-button"]',
        'button.bg-green-sd-hover',
        'button[data-cy="submit-code-btn"]'
    ];

    for (let sel of selectors) {
        const btn = document.querySelector(sel);
        if (btn) {
            btn.click();
            return;
        }
    }
    
    // Fallback: search by text
    const buttons = document.querySelectorAll('button');
    for (let b of buttons) {
        if (b.textContent.includes('Submit')) {
            b.click();
            return;
        }
    }
}

function monitorSubmission() {
    if (isStopped) return;
    console.log('GOD MODE: Monitoring submission...');
    let checks = 0;
    const maxChecks = 40; // 20 seconds
    
    const interval = setInterval(() => {
        if (isStopped) {
            clearInterval(interval);
            return;
        }

        checks++;
        const pageText = document.body.innerText;
        
        if (pageText.includes('Accepted') || document.querySelector('.text-green-500') || document.querySelector('[data-e2e-locator="submission-result-accepted"]')) {
            clearInterval(interval);
            if (!submissionSent) {
                console.log('GOD MODE: SUCCESS!');
                submissionSent = true;
                chrome.runtime.sendMessage({ action: 'PROBLEM_SOLVED' });
            }
        } else if (pageText.includes('Wrong Answer') || pageText.includes('Runtime Error') || pageText.includes('Compile Error')) {
            clearInterval(interval);
            console.log('GOD MODE: FAILED submission.');
            // Optional: try next solution?
            chrome.runtime.sendMessage({ action: 'SOLVE_FAILED', reason: 'Submission rejected' });
        }

        if (checks >= maxChecks) {
            clearInterval(interval);
            console.log('GOD MODE: Time out waiting for result.');
            chrome.runtime.sendMessage({ action: 'SOLVE_FAILED', reason: 'Timeout' });
        }
    }, 1500); // Check every 1.5s
}

// --- Next Problem Finding ---
async function findNextProblem() {
    console.log('GOD MODE: Finding random unsolved problem...');
    
    // Fetch total count to know range (hardcoded max for speed or fetch real count)
    // We'll just try a random skip to simulate randomness.
    const randomSkip = Math.floor(Math.random() * 500); // Reduced to 500 to find valid problems more easily
    
    const nextLink = await fetchRandomUnsolved(randomSkip);
    if (nextLink) {
        window.location.href = `https://leetcode.com${nextLink}`;
    } else {
        // Retry with skip 0 if random failed
        const fallback = await fetchRandomUnsolved(0);
        if (fallback) {
             window.location.href = `https://leetcode.com${fallback}`;
        } else {
             console.log('GOD MODE: No problems found!');
             chrome.runtime.sendMessage({ action: 'ALL_DONE' });
        }
    }
}

async function fetchRandomUnsolved(skipVal) {
    const query = `
    query problemsetQuestionList($categorySlug: String, $limit: Int, $skip: Int, $filters: QuestionListFilterInput) {
        problemsetQuestionList: questionList(
            categorySlug: $categorySlug
            limit: $limit
            skip: $skip
            filters: $filters
        ) {
            data {
                titleSlug
                isPaidOnly
            }
        }
    }`;
    
    // Fetch a batch to give us better odds of finding a free one
    const variables = {
        categorySlug: "", 
        limit: 20,
        skip: skipVal,
        filters: { status: "NOT_STARTED" }
    };

    try {
        const res = await fetch(GRAPHQL_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query, variables })
        });
        const json = await res.json();
        
        if (json.errors) {
            logToBackground(`Problem Search Error: ${JSON.stringify(json.errors)}`, 'error');
            return null;
        }

        if (json.data && json.data.problemsetQuestionList && json.data.problemsetQuestionList.data.length > 0) {
            const problems = json.data.problemsetQuestionList.data;
            // Find first FREE problem
            const freeProblem = problems.find(p => !p.isPaidOnly);
            
            if (freeProblem) {
                 logToBackground(`Found free problem: ${freeProblem.titleSlug}`, 'info');
                 return `/problems/${freeProblem.titleSlug}/`;
            } else {
                 logToBackground(`All 20 problems at skip ${skipVal} were Premium. Retrying...`, 'warning');
                 return null;
            }
        } else {
             logToBackground(`No problems found at skip ${skipVal}`, 'warning');
        }
    } catch(e) { 
        if (e.message && e.message.includes('Unexpected token')) {
             logToBackground('LeetCode API Rate Limit/Block (HTML response). Waiting...', 'error');
        } else {
             logToBackground(`Network warning: ${e.message}`, 'warning');
        }
        return null; 
    }
    return null;
}

// Start
init();
