// content.js
(() => {
    // SECURITY SHIELD: Guarantee this script NEVER executes twice per frame
    if (window.__yeedioInjected) return;
    window.__yeedioInjected = true;

    let currentVideo = null;
    let audioCtx = null;
    let gainNode = null;
    let sourceNode = null;
    let lastVolume = 100;
    let lastSpeed = 1.0;

    // Interval for YouTube Override since YouTube likes to reset playback rate randomly.
    let speedEnforcerInterval = null;

    function findVideo() {
        const videos = Array.from(document.querySelectorAll('video'));
        if (videos.length === 0) return null;

        // Priority 1: Currently playing video
        const playingVideos = videos.filter(v => !v.paused && !v.ended && v.readyState > 2);
        if (playingVideos.length > 0) {
            return playingVideos.reduce((largest, v) => {
                return (v.clientWidth * v.clientHeight > largest.clientWidth * largest.clientHeight) ? v : largest;
            });
        }

        // Priority 2: Largest video by area
        return videos.reduce((largest, v) => {
            return (v.clientWidth * v.clientHeight > largest.clientWidth * largest.clientHeight) ? v : largest;
        });
    }

    function initAudioContext(video) {
        if (!video) return;

        // CRITICAL: Ensure createMediaElementSource is only called ONCE per video element
        if (video.dataset.yeedioAudioInitialized === "true") {
            return;
        }

        try {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            if (!AudioContext) return;

            if (!audioCtx) {
                audioCtx = new AudioContext();
            }

            gainNode = audioCtx.createGain();
            sourceNode = audioCtx.createMediaElementSource(video);

            sourceNode.connect(gainNode);
            gainNode.connect(audioCtx.destination);

            video.dataset.yeedioAudioInitialized = "true";

            video.addEventListener('play', () => {
                if (audioCtx && audioCtx.state === 'suspended') {
                    audioCtx.resume();
                }
            });
        } catch (e) {
            console.error("Yeedio: Failed to init AudioContext.", e);
        }
    }

    function applySettings(speed, volume) {
        if (!currentVideo) {
            currentVideo = findVideo();
        }

        if (currentVideo) {
            // Video Speed
            if (speed !== undefined) {
                // Strictly cap the actual HTMLMediaElement property to 16.0x to avoid buffering crashes
                speed = Math.min(Math.max(speed, 0.25), 16.0);
                lastSpeed = speed;
                currentVideo.playbackRate = speed;

                // Set up the YouTube Override interval
                if (speedEnforcerInterval) clearInterval(speedEnforcerInterval);
                speedEnforcerInterval = setInterval(() => {
                    if (currentVideo && currentVideo.playbackRate !== lastSpeed) {
                        currentVideo.playbackRate = lastSpeed;
                    }
                }, 500); // Check every 500ms to override YouTube's resets
            }

            // Volume Booster
            if (volume !== undefined) {
                lastVolume = volume;
                if (volume !== 100 || currentVideo.dataset.yeedioAudioInitialized === "true") {
                    initAudioContext(currentVideo);
                }

                if (gainNode) {
                    // Map 0-600% to gain value 0.0 to 6.0
                    gainNode.gain.value = volume / 100;
                }
            }

            watchResolution(currentVideo);
            attachVideoListeners(currentVideo);
        }
    }

    // Ensures persistence across playlist videos
    function attachVideoListeners(video) {
        if (!video || video.dataset.yeedioListenersAdded === "true") return;

        // Listen for ratechange to aggressively force our speed
        video.addEventListener('ratechange', () => {
            // If the rate was changed by something else, force it back
            if (video.playbackRate !== lastSpeed) {
                // Short timeout to avoid maximum call stack size in case of conflict loop
                setTimeout(() => {
                    if (video.playbackRate !== lastSpeed) {
                        video.playbackRate = lastSpeed;
                    }
                }, 10);
            }
        });

        // Event for when a new video loads in the same element (e.g. YouTube Playlist)
        video.addEventListener('loadeddata', () => {
            applySettings(lastSpeed, lastVolume);
        });

        video.dataset.yeedioListenersAdded = "true";
    }

    function notifyResolution(video) {
        if (!video) return;
        if (video.videoWidth > 0 && video.videoHeight > 0) {
            chrome.runtime.sendMessage({
                type: 'RESOLUTION_CHANGED',
                width: video.videoWidth,
                height: video.videoHeight
            }).catch(() => { });
        }
    }

    function watchResolution(video) {
        if (!video || video.dataset.yeedioResolutionWatcher === "true") return;

        const notify = () => notifyResolution(video);

        video.addEventListener('loadedmetadata', notify);
        video.addEventListener('resize', notify);
        video.dataset.yeedioResolutionWatcher = "true";
    }

    function getResolution(video) {
        if (video && video.videoWidth && video.videoHeight) {
            return {
                width: video.videoWidth,
                height: video.videoHeight
            };
        }
        return null;
    }

    // Auto-apply state on page load or when traversing a SPA (like YouTube)
    function autoApplyFromStorage() {
        chrome.storage.local.get(['speed', 'volume', 'globalDefaultSpeed', 'globalDefaultVolume'], (data) => {
            const speedToApply = data.speed !== undefined ? data.speed : (data.globalDefaultSpeed || 1.0);
            const volumeToApply = data.volume !== undefined ? data.volume : (data.globalDefaultVolume || 100);
            applySettings(speedToApply, volumeToApply);
        });
    }

    // ROBUST RESOLUTION FINDER: ONLY RESPOND IF WE HAVE THE VIDEO
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        currentVideo = findVideo();

        if (request.type === 'UPDATE_SETTINGS') {
            if (!currentVideo) return false; // Ignore message in frames without video to avoid collisions

            applySettings(request.speed, request.volume);
            sendResponse({
                success: true,
                resolution: getResolution(currentVideo)
            });
            return false;
        }
        else if (request.type === 'GET_STATE') {
            if (!currentVideo) return false; // Important: Return false immediately to allow the frame WITH the video to respond

            sendResponse({
                speed: lastSpeed, // return enforced speed instead of volatile playbackRate
                volume: lastVolume,
                resolution: getResolution(currentVideo)
            });
            return false;
        }
        return false;
    });

    // Run auto-apply instantly upon injection
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", autoApplyFromStorage);
    } else {
        autoApplyFromStorage();
    }

    // Set up a MutationObserver to watch for new <video> elements being added to the DOM 
    // This handles SPAs where video elements are destroyed and recreated (like navigating to a new YouTube page)
    const observer = new MutationObserver((mutations) => {
        let videoAdded = false;
        for (const mut of mutations) {
            if (mut.addedNodes.length > 0) {
                for (const node of mut.addedNodes) {
                    if (node.nodeName === 'VIDEO' || (node.querySelectorAll && node.querySelectorAll('video').length > 0)) {
                        videoAdded = true;
                        break;
                    }
                }
            }
            if (videoAdded) break;
        }
        if (videoAdded) {
            setTimeout(() => {
                currentVideo = findVideo();
                if (currentVideo) autoApplyFromStorage();
            }, 500); // Give it a moment to initialize
        }
    });

    observer.observe(document.body, { childList: true, subtree: true });

})();
