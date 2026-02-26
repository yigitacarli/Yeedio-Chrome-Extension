document.addEventListener('DOMContentLoaded', () => {
    const speedSlider = document.getElementById('speed-slider');
    const speedInput = document.getElementById('speed-input');
    const speedDown = document.getElementById('speed-down');
    const speedUp = document.getElementById('speed-up');
    const speedReset = document.getElementById('resetSpeed');

    const volumeSlider = document.getElementById('volume-slider');
    const volumeInput = document.getElementById('volume-input');
    const volumeReset = document.getElementById('resetVolume');

    const statusDisplay = document.getElementById('status');
    const activeTabTitle = document.getElementById('active-tab-title');
    const activeTabIcon = document.getElementById('active-tab-icon');

    // Fetch Active Tab Info for "Now Playing" card
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs.length === 0) return;
        const currentTab = tabs[0];

        if (currentTab.title) {
            activeTabTitle.textContent = currentTab.title;
            activeTabTitle.title = currentTab.title;
        } else {
            activeTabTitle.textContent = "Unknown Tab";
        }

        if (currentTab.favIconUrl) {
            activeTabIcon.src = currentTab.favIconUrl;
            activeTabIcon.style.display = 'block';
        } else {
            activeTabIcon.style.display = 'none';
        }
    });

    /**
     * Ensures `content.js` is securely injected into the active tab exactly when needed.
     */
    function runWithContentScript(tabId, callback) {
        // Test if script is already present by sending a dummy GET_STATE
        chrome.tabs.sendMessage(tabId, { type: 'GET_STATE' }, (response) => {
            if (chrome.runtime.lastError) {
                // Not injected yet, perform dynamic injection
                chrome.scripting.executeScript({
                    target: { tabId: tabId, allFrames: true },
                    files: ['content.js']
                }, () => {
                    if (chrome.runtime.lastError) {
                        console.warn("Yeedio: Injection failed.", chrome.runtime.lastError);
                        callback(false);
                    } else {
                        // Allow brief moment for listeners to securely attach
                        setTimeout(() => callback(true), 50);
                    }
                });
            } else {
                // Already injected
                callback(true);
            }
        });
    }

    function syncSpeed(value) {
        let val = parseFloat(value);
        if (isNaN(val)) val = 1.0;
        if (val < 0.25) val = 0.25;
        if (val > 16.0) val = 16.0;

        speedSlider.value = val;
        speedInput.value = val;
        saveAndApply();
    }

    function syncVolume(value) {
        let val = parseInt(value, 10);
        if (isNaN(val)) val = 100;
        if (val < 0) val = 0;
        if (val > 600) val = 600;

        volumeSlider.value = val;
        volumeInput.value = val;
        saveAndApply();
    }

    speedSlider.addEventListener('input', (e) => syncSpeed(e.target.value));
    speedInput.addEventListener('change', (e) => syncSpeed(e.target.value));
    speedDown.addEventListener('click', () => syncSpeed(parseFloat(speedSlider.value) - 0.25));
    speedUp.addEventListener('click', () => syncSpeed(parseFloat(speedSlider.value) + 0.25));
    speedReset.addEventListener('click', () => {
        chrome.storage.local.get(['globalDefaultSpeed'], (data) => {
            syncSpeed(data.globalDefaultSpeed || 1.0);
        });
    });

    volumeSlider.addEventListener('input', (e) => syncVolume(e.target.value));
    volumeInput.addEventListener('change', (e) => syncVolume(e.target.value));
    volumeReset.addEventListener('click', () => {
        chrome.storage.local.get(['globalDefaultVolume'], (data) => {
            syncVolume(data.globalDefaultVolume || 100);
        });
    });

    function saveAndApply() {
        const speed = parseFloat(speedSlider.value);
        const volume = parseInt(volumeSlider.value, 10);

        chrome.storage.local.set({ speed, volume });

        sendMessageToContentScript({
            type: 'UPDATE_SETTINGS',
            speed: speed,
            volume: volume
        });
    }

    function sendMessageToContentScript(message) {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs.length === 0) return;
            const tabId = tabs[0].id;

            runWithContentScript(tabId, (success) => {
                if (!success) {
                    updateStatusDisplay("CANNOT ACCESS THIS PAGE.");
                    return;
                }
                chrome.tabs.sendMessage(tabId, message, (response) => {
                    if (chrome.runtime.lastError || !response) {
                        updateStatusDisplay("No video player found.");
                        return;
                    }
                    if (response && response.resolution) {
                        updateStatusDisplay(`Current Resolution: ${response.resolution.width}x${response.resolution.height}`);
                    } else if (response && response.error) {
                        updateStatusDisplay(response.error);
                    }
                });
            });
        });
    }

    function updateStatusDisplay(text) {
        statusDisplay.textContent = text;
    }

    function loadFallbackStorage() {
        chrome.storage.local.get(['speed', 'volume', 'globalDefaultSpeed', 'globalDefaultVolume'], (data) => {
            const fallbackSpeed = data.speed !== undefined ? data.speed : (data.globalDefaultSpeed || 1.0);
            const fallbackVol = data.volume !== undefined ? data.volume : (data.globalDefaultVolume || 100);

            speedSlider.value = fallbackSpeed;
            speedInput.value = fallbackSpeed;
            volumeSlider.value = fallbackVol;
            volumeInput.value = fallbackVol;
        });
    }

    // Initialize Popup state upon user click
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs.length === 0) return;
        const tabId = tabs[0].id;

        runWithContentScript(tabId, (success) => {
            if (!success) {
                // Completely blocked (e.g., chrome://)
                loadFallbackStorage();
                updateStatusDisplay("CANNOT ACCESS THIS PAGE.");
                return;
            }

            // Secure fetch from the single frame that holds the video!
            chrome.tabs.sendMessage(tabId, { type: 'GET_STATE' }, (response) => {
                if (chrome.runtime.lastError || !response) {
                    // No frames successfully returned a response = No video
                    loadFallbackStorage();
                    updateStatusDisplay("No video player found.");
                    return;
                }

                if (response.speed !== undefined) {
                    speedSlider.value = response.speed;
                    speedInput.value = response.speed;
                }
                if (response.volume !== undefined) {
                    volumeSlider.value = response.volume;
                    volumeInput.value = response.volume;
                }

                if (response.resolution && response.resolution.width > 0) {
                    updateStatusDisplay(`Current Resolution: ${response.resolution.width}x${response.resolution.height}`);
                } else {
                    updateStatusDisplay("Loading Resolution...");
                }
            });
        });
    });

    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.type === 'RESOLUTION_CHANGED') {
            if (request.width > 0) {
                updateStatusDisplay(`Current Resolution: ${request.width}x${request.height}`);
            }
        }
    });
});
