import { GeminiLive } from '../../dist/index.js';

let geminiLive;

const apiKeyInput = document.getElementById('apiKey');
const connectBtn = document.getElementById('connectBtn');
const disconnectBtn = document.getElementById('disconnectBtn');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const statusEl = document.getElementById('status');
const volumeBar = document.getElementById('volume-bar');

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
        } else if (status === 'Disconnected' || status === 'Reconnect Failed') {
            connectBtn.disabled = false;
            disconnectBtn.disabled = true;
            startBtn.disabled = true;
            stopBtn.disabled = true;
            volumeBar.style.width = '0%';
        }
    };

    geminiLive.connect();
});

disconnectBtn.addEventListener('click', () => {
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