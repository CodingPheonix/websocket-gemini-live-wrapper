export function sendTextMessage(websocket: WebSocket, text: string, enableLogs: boolean = false) {
    if (websocket.readyState === WebSocket.OPEN) {
        const textMessage = {
            realtimeInput: {
                text: text
            }
        };
        websocket.send(JSON.stringify(textMessage));
        if (enableLogs) console.log('Text message sent:', text);
    } else {
        if (enableLogs) console.warn('WebSocket not open.');
    }
}

// Assuming 'chunk' is a Buffer of raw PCM audio or a base64 string
export function sendAudioChunk(websocket: WebSocket, chunk: Buffer | string | any, enableLogs: boolean = false) {
    if (websocket.readyState === WebSocket.OPEN) {
        const base64Data = typeof chunk === 'string' ? chunk : chunk.toString('base64');
        const audioMessage = {
            realtimeInput: {
                audio: {
                    data: base64Data,
                    mimeType: 'audio/pcm;rate=16000'
                }
            }
        };
        websocket.send(JSON.stringify(audioMessage));
    } else {
        if (enableLogs) console.warn('WebSocket not open.');
    }
}

// Assuming 'frame' is a Buffer of JPEG-encoded image data
export function sendVideoFrame(websocket: WebSocket, frame: Buffer | any, mimeType: string = 'image/jpeg', enableLogs: boolean = false) {
    if (websocket.readyState === WebSocket.OPEN) {
        const videoMessage = {
            realtimeInput: {
                video: {
                    data: frame.toString('base64'),
                    mimeType: mimeType
                }
            }
        };
        websocket.send(JSON.stringify(videoMessage));
    } else {
        if (enableLogs) console.warn('WebSocket not open.');
    }
}