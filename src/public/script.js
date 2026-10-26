import { GeminiLive } from '../../dist/index.js';

let geminiLive;

const apiKeyInput = document.getElementById('apiKey');
const connectBtn = document.getElementById('connectBtn');
const disconnectBtn = document.getElementById('disconnectBtn');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const statusEl = document.getElementById('status');
const volumeBar = document.getElementById('volume-bar');

const startCameraBtn = document.getElementById('startCameraBtn');
const startScreenBtn = document.getElementById('startScreenBtn');
const stopVideoBtn = document.getElementById('stopVideoBtn');
const videoPreview = document.getElementById('videoPreview');
const videoCanvas = document.getElementById('videoCanvas');

let videoStream = null;
let videoIntervalId = null;

function stopVideoStream() {
    if (videoIntervalId) {
        clearInterval(videoIntervalId);
        videoIntervalId = null;
    }
    if (videoStream) {
        videoStream.getTracks().forEach((track) => track.stop());
        videoStream = null;
    }
    videoPreview.srcObject = null;
    videoPreview.style.display = 'none';
    if (startCameraBtn) startCameraBtn.disabled = !geminiLive || !geminiLive.isConnected;
    if (startScreenBtn) startScreenBtn.disabled = !geminiLive || !geminiLive.isConnected;
    if (stopVideoBtn) stopVideoBtn.disabled = true;
}

function startStreamingVideo(stream) {
    videoStream = stream;
    videoPreview.srcObject = stream;
    videoPreview.style.display = 'block';

    const ctx = videoCanvas.getContext('2d');

    // Stream video frames at ~1 FPS (recommended rate for Gemini Live API)
    videoIntervalId = setInterval(() => {
        if (!geminiLive || videoPreview.readyState < 2) return;

        // Resize down to 640px width max for low latency
        const scale = Math.min(1, 640 / (videoPreview.videoWidth || 640));
        videoCanvas.width = (videoPreview.videoWidth || 640) * scale;
        videoCanvas.height = (videoPreview.videoHeight || 480) * scale;

        ctx.drawImage(videoPreview, 0, 0, videoCanvas.width, videoCanvas.height);

        // Convert canvas image to JPEG base64 and send via sendVideo
        const base64DataUrl = videoCanvas.toDataURL('image/jpeg', 0.6);
        geminiLive.sendVideo(base64DataUrl, 'image/jpeg');
    }, 1000);

    // If the user stops screen sharing from browser UI
    stream.getVideoTracks()[0].addEventListener('ended', () => {
        stopVideoStream();
    });

    if (startCameraBtn) startCameraBtn.disabled = true;
    if (startScreenBtn) startScreenBtn.disabled = true;
    if (stopVideoBtn) stopVideoBtn.disabled = false;
}

connectBtn.addEventListener('click', () => {
    const apiKey = apiKeyInput.value;
    if (!apiKey) {
        alert('Please enter an API Key');
        return;
    }

    statusEl.textContent = 'Connecting...';
    // Clean and simple tool declaration:
    const getRandomTemperature = {
        name: 'getRandomTemperature',
        description: 'Returns a random temperature for a given city or location for testing.',
        parameters: {
            city: { type: 'string', description: 'The name of the city or location', required: true }
        },
        handler: (args) => {
            const city = args.city || 'your location';
            const temp = Math.floor(Math.random() * 25) + 15; // Random 15°C - 39°C
            return {
                city: city,
                temperature: `${temp}°C`,
                condition: 'Partly Cloudy'
            };
        }
    };

    geminiLive = new GeminiLive(
        apiKey,
        'gemini-3.8-live',
        false,
        '',
        'You are a helpful assistant. If the user asks about the weather or temperature, use the getRandomTemperature tool.',
        getRandomTemperature,
        true
    );

    geminiLive.onStatusChange = (status) => {
        statusEl.textContent = status;
        if (status === 'Connected') {
            connectBtn.disabled = true;
            disconnectBtn.disabled = false;
            startBtn.disabled = false;
            startCameraBtn.disabled = false;
            startScreenBtn.disabled = false;
        } else if (status === 'Disconnected' || status === 'Reconnect Failed') {
            connectBtn.disabled = false;
            disconnectBtn.disabled = true;
            startBtn.disabled = true;
            stopBtn.disabled = true;
            startCameraBtn.disabled = true;
            startScreenBtn.disabled = true;
            stopVideoBtn.disabled = true;
            volumeBar.style.width = '0%';
            stopVideoStream();
        }
    };

    geminiLive.connect();
});

disconnectBtn.addEventListener('click', () => {
    stopVideoStream();
    if (geminiLive) {
        geminiLive.disconnect();
    }
});

startBtn.addEventListener('click', async () => {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,     // Enables the browser's hardware AGC
                sampleRate: 16000,
                channelCount: 1
            }
        });

        statusEl.textContent = 'Recording and Streaming...';
        startBtn.disabled = true;
        stopBtn.disabled = false;

        await geminiLive.startRecording(stream, (volume) => {
            // Normalize volume for the bar UI
            volumeBar.style.width = Math.min(volume * 500, 100) + '%';
        });
    } catch (err) {
        console.error('Mic error:', err);
        statusEl.textContent = 'Microphone access denied';
    }
});

stopBtn.addEventListener('click', () => {
    geminiLive.stopRecording();
    statusEl.textContent = 'Connected (Not Recording)';
    startBtn.disabled = false;
    stopBtn.disabled = true;
    volumeBar.style.width = '0%';
});

startCameraBtn.addEventListener('click', async () => {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: {
                width: { ideal: 640 },
                height: { ideal: 480 },
                frameRate: { ideal: 15 }
            }
        });
        startStreamingVideo(stream);
    } catch (err) {
        console.error('Camera error:', err);
        statusEl.textContent = 'Camera access denied';
    }
});

startScreenBtn.addEventListener('click', async () => {
    try {
        const stream = await navigator.mediaDevices.getDisplayMedia({
            video: {
                cursor: 'always'
            }
        });
        startStreamingVideo(stream);
    } catch (err) {
        console.error('Screen share error:', err);
        statusEl.textContent = 'Screen share cancelled or denied';
    }
});

stopVideoBtn.addEventListener('click', () => {
    stopVideoStream();
});