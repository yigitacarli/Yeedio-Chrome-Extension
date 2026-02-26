document.addEventListener('DOMContentLoaded', () => {
    const defaultSpeedInput = document.getElementById('default-speed');
    const defaultVolumeInput = document.getElementById('default-volume');
    const saveBtn = document.getElementById('save-btn');
    const statusDiv = document.getElementById('status');

    // Load saved settings
    chrome.storage.local.get(['globalDefaultSpeed', 'globalDefaultVolume'], (data) => {
        if (data.globalDefaultSpeed !== undefined) {
            defaultSpeedInput.value = data.globalDefaultSpeed;
        }
        if (data.globalDefaultVolume !== undefined) {
            defaultVolumeInput.value = data.globalDefaultVolume;
        }
    });

    saveBtn.addEventListener('click', () => {
        let speed = parseFloat(defaultSpeedInput.value);
        let volume = parseInt(defaultVolumeInput.value, 10);

        if (isNaN(speed) || speed < 0.25) speed = 0.25;
        if (speed > 16) speed = 16;

        if (isNaN(volume) || volume < 0) volume = 0;
        if (volume > 600) volume = 600;

        defaultSpeedInput.value = speed;
        defaultVolumeInput.value = volume;

        chrome.storage.local.set({
            globalDefaultSpeed: speed,
            globalDefaultVolume: volume,
            // Pre-seed current state to help initialization on new tabs
            speed: speed,
            volume: volume
        }, () => {
            statusDiv.textContent = 'Preferences saved successfully!';
            setTimeout(() => { statusDiv.textContent = ''; }, 2000);
        });
    });
});
